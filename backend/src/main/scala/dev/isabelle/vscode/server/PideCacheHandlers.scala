package dev.isabelle.vscode.server

import scala.jdk.CollectionConverters.MapHasAsScala

/**
 * Phase 2c pure handlers for the three new diagnostic + lifecycle
 * JSON-RPC methods that surface the [[HeadlessSessionRegistry]]
 * cache to the TS side:
 *
 *   - `pide/warmup` — eagerly build the cached [[HeadlessFacade]]
 *     so the first user-facing PIDE call is sub-second instead of
 *     paying ~20 s of bootstrap. Honors `isabelle.pide.prewarmOnActivation`
 *     when set at activation; also exposed as a command for power
 *     users.
 *   - `pide/cacheState` — read-only snapshot of the cache + inflight
 *     state, surfaced in `Isabelle: Show PIDE Document Status` so
 *     users can see why their next call might be slow.
 *   - `pide/invalidateCache` — force-evict the cached facade, useful
 *     when the user has updated their Isabelle install in place or
 *     wants to clear stuck state without restarting the backend.
 */
object PideCacheHandlers {

  def warmup(
    params: Option[ujson.Value],
    registry: HeadlessSessionRegistry,
    env: Map[String, String],
    platform: String,
    fs: IsabelleHomeFs = RealIsabelleHomeFs
  ): ujson.Value = {
    val obj = params.flatMap(_.objOpt).getOrElse(ujson.Obj().obj)
    val session = obj.get("session").flatMap(_.strOpt).filter(_.nonEmpty)
    val executablePath = obj.get("isabelleExecutablePath").flatMap(_.strOpt).filter(_.nonEmpty)

    val sessionName = session.getOrElse {
      return ujson.Obj(
        "status" -> "skipped",
        "reason" -> "session-not-selected",
        "message" -> "Warmup skipped: no session was provided. Pass `session` in params or set `isabelle.session.active`."
      )
    }

    IsabelleHome.resolve(env, executablePath, platform, fs) match {
      case None =>
        ujson.Obj(
          "status" -> "skipped",
          "reason" -> "home-not-found",
          "message" -> "Warmup skipped: no Isabelle install resolved."
        )

      case Some(home) =>
        IsabellePideClasspath.build(home, fs) match {
          case Left(error) =>
            ujson.Obj(
              "status" -> "failed",
              "reason" -> (error match {
                case IsabellePideClasspath.IsabelleJarMissing  => "isabelle-jar-missing"
                case IsabellePideClasspath.ScalaRuntimeMissing => "scala-runtime-missing"
              }),
              "message" -> error.message
            )
          case Right(classpath) =>
            val startedAt = System.currentTimeMillis()
            registry.acquireOrBuild(classpath, home, HeadlessBootstrap.deriveCygwinRoot(home, platform), sessionName) match {
              case Left(HeadlessFacade.CancelledBuild(notes)) =>
                ujson.Obj(
                  "status" -> "cancelled",
                  "reason" -> "warmup-cancelled",
                  "message" -> "Warmup was cancelled before the session was ready.",
                  "notes" -> ujson.Arr(notes.map(ujson.Str(_))*)
                )
              case Left(HeadlessFacade.BootstrapError(step, reason, notes)) =>
                ujson.Obj(
                  "status" -> "failed",
                  "reason" -> step,
                  "message" -> reason,
                  "notes" -> ujson.Arr(notes.map(ujson.Str(_))*)
                )
              case Right(facade) =>
                val elapsed = System.currentTimeMillis() - startedAt
                ujson.Obj(
                  "status" -> "ready",
                  "session" -> sessionName,
                  "isabelleHome" -> home.toString,
                  "elapsedMs" -> elapsed,
                  "bootstrapElapsedMs" -> facade.bootstrapElapsedMs,
                  "alreadyCached" -> (elapsed < 100),
                  "cacheState" -> registry.cacheStateSnapshot.toJson,
                  "message" -> (if (elapsed < 100) s"Session '$sessionName' already cached."
                                else s"Session '$sessionName' warmed in ${facade.bootstrapElapsedMs} ms.")
                )
            }
        }
    }
  }

  def cacheState(registry: HeadlessSessionRegistry): ujson.Value =
    registry.cacheStateSnapshot.toJson

  def invalidateCache(registry: HeadlessSessionRegistry): ujson.Value = {
    val priorFp = registry.currentFingerprint
    registry.invalidateCache()
    ujson.Obj(
      "invalidated" -> priorFp.isDefined,
      "previousFingerprint" -> priorFp.map(_.toJson).getOrElse(ujson.Null),
      "message" -> priorFp.map(_ => "Cached PIDE session evicted. Next call will re-bootstrap.")
        .getOrElse("No cached PIDE session to invalidate.")
    )
  }

  def warmupWithSystemEnv(
    params: Option[ujson.Value],
    registry: HeadlessSessionRegistry
  ): ujson.Value =
    warmup(
      params = params,
      registry = registry,
      env = System.getenv().asScala.toMap,
      platform = Option(System.getProperty("os.name")).getOrElse("")
    )
}
