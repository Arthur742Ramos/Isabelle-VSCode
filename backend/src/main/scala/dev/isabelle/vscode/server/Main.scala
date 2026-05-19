package dev.isabelle.vscode.server

import java.io.{BufferedInputStream, BufferedOutputStream}
import java.util.concurrent.{ExecutorService, Executors}
import scala.jdk.CollectionConverters.MapHasAsScala
import scala.sys.process.Process
import scala.util.control.NonFatal

object Main {
  private val documents = new DocumentStore(new LocalSyntaxPideBridge)
  private val headlessRegistry = new HeadlessSessionRegistry()

  /** Single worker thread for the long-running PIDE warmup +
    * use_theories call. Keeps the main dispatcher loop free to
    * process `pide/cancelWarmup` mid-warmup. */
  private val pideWorker: ExecutorService = Executors.newSingleThreadExecutor(r => {
    val t = new Thread(r, "pide-worker")
    t.setDaemon(true)
    t
  })

  /** Phase 3 snapshot cache: per-(uri, version, session) lazy
    * populate. Invalidates on document/update for the uri. */
  private val snapshotCache = new SnapshotCache()

  def main(args: Array[String]): Unit = {
    val in = new BufferedInputStream(System.in)
    val out = new BufferedOutputStream(System.out)
    val framing = new ContentLengthFraming(in, out)
    val writeLock = new Object

    def writeResponse(response: Protocol.Response): Unit = writeLock.synchronized {
      framing.write(response.json)
    }

    Runtime.getRuntime.addShutdownHook(new Thread(new Runnable {
      override def run(): Unit = {
        try headlessRegistry.shutdown() catch { case _: Throwable => () }
        try pideWorker.shutdownNow() catch { case _: Throwable => () }
      }
    }))

    Iterator.continually(framing.read()).takeWhile(_.isDefined).flatten.foreach { request =>
      try {
        request.method match {
          // Heavy method — dispatch to worker so cancelWarmup can interrupt mid-call.
          case "document/checkWithPide" =>
            pideWorker.submit(new Runnable {
              override def run(): Unit = {
                val response =
                  try {
                    val env = System.getenv().asScala.toMap
                    val platform = Option(System.getProperty("os.name")).getOrElse("")
                    Protocol.success(request.id, CheckWithPideHandler.handle(
                      params = request.params,
                      documents = documents,
                      registry = headlessRegistry,
                      env = env,
                      platform = platform
                    ))
                  } catch {
                    case t: Throwable =>
                      Protocol.error(request.id, -32000, Option(t.getMessage).getOrElse(t.getClass.getSimpleName))
                  }
                writeResponse(response)
              }
            })

          // Phase 2c: heavy method — dispatch to worker so the dispatcher
          // stays free for pide/cancelWarmup mid-warmup.
          case "pide/warmup" =>
            pideWorker.submit(new Runnable {
              override def run(): Unit = {
                val response =
                  try {
                    Protocol.success(request.id, PideCacheHandlers.warmupWithSystemEnv(request.params, headlessRegistry))
                  } catch {
                    case t: Throwable =>
                      Protocol.error(request.id, -32000, Option(t.getMessage).getOrElse(t.getClass.getSimpleName))
                  }
                writeResponse(response)
              }
            })

          // Phase 3: heavy method — dispatch to worker so cancelWarmup
          // can interrupt mid-call. Snapshot cache makes the second+
          // call against the same (uri, version) sub-second.
          case "proofState/getWithPide" =>
            pideWorker.submit(new Runnable {
              override def run(): Unit = {
                val response =
                  try {
                    val env = System.getenv().asScala.toMap
                    val platform = Option(System.getProperty("os.name")).getOrElse("")
                    Protocol.success(request.id, ProofStateWithPideHandler.handle(
                      params = request.params,
                      documents = documents,
                      registry = headlessRegistry,
                      snapshotCache = snapshotCache,
                      env = env,
                      platform = platform
                    ))
                  } catch {
                    case t: Throwable =>
                      Protocol.error(request.id, -32000, Option(t.getMessage).getOrElse(t.getClass.getSimpleName))
                  }
                writeResponse(response)
              }
            })

          // Phase 3: fast diagnostic on main thread.
          case "pide/cacheState" =>
            writeResponse(Protocol.success(request.id, PideCacheHandlers.cacheState(headlessRegistry)))

          // Phase 2c: fast invalidation on main thread.
          case "pide/invalidateCache" =>
            writeResponse(Protocol.success(request.id, PideCacheHandlers.invalidateCache(headlessRegistry)))

          // Synchronous on main thread — must NOT be queued behind the worker.
          case "pide/cancelWarmup" =>
            headlessRegistry.cancelInflightWarmup()
            writeResponse(Protocol.success(request.id, ujson.Obj(
              "cancelled" -> true,
              "message" -> "Warmup cancellation signaled; the in-flight bootstrap will exit at the next safe boundary."
            )))

          case _ =>
            val response =
              try handle(request)
              catch {
                case NonFatal(error) =>
                  Protocol.error(request.id, -32000, error.getMessage)
              }
            writeResponse(response)
        }
      } catch {
        case NonFatal(error) =>
          writeResponse(Protocol.error(request.id, -32000, error.getMessage))
      }
    }
  }

  private def handle(request: Protocol.Request): Protocol.Response =
    if (request.protocolVersion != Protocol.ProtocolVersion) {
      Protocol.error(
        request.id,
        -32600,
        s"Unsupported protocol version ${request.protocolVersion}; expected ${Protocol.ProtocolVersion}"
      )
    } else {
    request.method match {
      case "server/health" =>
        val executable = request.params.flatMap(_.objOpt.flatMap(_.get("isabelleExecutablePath"))).map(_.str).getOrElse("isabelle")
        Protocol.success(request.id, ujson.Obj(
          "protocolVersion" -> Protocol.ProtocolVersion,
          "backend" -> ujson.Obj(
            "status" -> "ok",
            "implementation" -> "scala"
          ),
          "isabelle" -> healthFor(executable)
        ))

      case "isabelle/version" =>
        val executable = request.params.flatMap(_.objOpt.flatMap(_.get("isabelleExecutablePath"))).map(_.str).getOrElse("isabelle")
        val version = IsabelleCli.version(executable)
        Protocol.success(request.id, ujson.Obj(
          "executablePath" -> executable,
          "version" -> version.summary,
          "raw" -> version.raw
        ))

      case "isabelle/pideVersion" =>
        Protocol.success(request.id, PideVersionHandler.handleWithSystemEnv(request.params))

      case "session/discover" =>
        val params = request.params.flatMap(_.objOpt)
        val workspaceFolders = params.flatMap(_.get("workspaceFolders"))
          .flatMap(_.arrOpt)
          .map(_.flatMap(_.strOpt).toSeq)
          .getOrElse(Seq.empty)
        val roots = params.flatMap(_.get("roots"))
          .flatMap(_.arrOpt)
          .map(_.flatMap(_.strOpt).toSeq)
          .getOrElse(Seq.empty)
        val afpPath = params.flatMap(_.get("afpPath")).flatMap(_.strOpt).filter(_.nonEmpty)
        Protocol.success(
          request.id,
          SessionDiscovery.discover(SessionDiscoveryOptions(workspaceFolders, roots, afpPath))
        )

      case "document/openTheory" =>
        val params = request.requiredParams
        Protocol.success(request.id, documents.open(
          uri = params("uri").str,
          text = params("text").str,
          version = params("version").num.toInt,
          session = params.get("session").flatMap(_.strOpt)
        ))

      case "document/update" =>
        val params = request.requiredParams
        val uri = params("uri").str
        // Phase 3: any version bump invalidates the cached snapshot
        // so the next proofState/getWithPide call re-submits cleanly.
        snapshotCache.evictForUri(uri)
        Protocol.success(request.id, documents.update(
          uri = uri,
          text = params("text").str,
          version = params("version").num.toInt
        ))

      case "document/close" =>
        val params = request.requiredParams
        val uri = params("uri").str
        snapshotCache.evictForUri(uri)
        Protocol.success(request.id, documents.close(uri))

      case "proofState/get" =>
        val params = request.requiredParams
        val position = params("position").obj
        Protocol.success(request.id, documents.proofState(
          uri = params("uri").str,
          line = position("line").num.toInt,
          character = position("character").num.toInt
        ))

      case "sledgehammer/run" =>
        val params = request.requiredParams
        val position = params("position").obj
        Protocol.success(request.id, documents.sledgehammer(
          requestId = params("requestId").str,
          uri = params("uri").str,
          line = position("line").num.toInt,
          character = position("character").num.toInt,
          session = params.get("session").flatMap(_.strOpt),
          isabelleExecutablePath = params.get("isabelleExecutablePath").flatMap(_.strOpt)
        ))

      case "sledgehammer/cancel" =>
        val params = request.params.flatMap(_.objOpt)
        val requestId = params.flatMap(_.get("requestId")).flatMap(_.strOpt)
        Protocol.success(request.id, ujson.Obj(
          "requestId" -> requestId.map(ujson.Str(_)).getOrElse(ujson.Null),
          "cancelled" -> false,
          "message" -> "No active Sledgehammer job is running; PIDE-backed Sledgehammer jobs are not implemented in this backend yet."
        ))

      case other =>
        Protocol.error(request.id, -32601, s"Unsupported method: $other")
    }
    }

  private def healthFor(executable: String): ujson.Value =
    try {
      val version = IsabelleCli.version(executable)
      ujson.Obj(
        "status" -> "ok",
        "executablePath" -> executable,
        "version" -> version.summary
      )
    } catch {
      case NonFatal(error) =>
        val reason = Option(error.getMessage).filter(_.nonEmpty).getOrElse(error.getClass.getSimpleName)
        ujson.Obj(
          "status" -> "unavailable",
          "executablePath" -> executable,
          "reason" -> reason
        )
    }
}

final case class IsabelleVersion(raw: String, summary: String)

object IsabelleCli {
  def version(executable: String): IsabelleVersion = {
    val output = Process(Seq(executable, "version")).!!
    val raw = output.trim
    val summary = raw.linesIterator.find(_.trim.nonEmpty).getOrElse(raw)
    IsabelleVersion(raw, summary)
  }
}
