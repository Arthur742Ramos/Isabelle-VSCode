package dev.isabelle.vscode.server

import java.nio.file.{Path, Paths}
import scala.collection.mutable
import scala.jdk.CollectionConverters.MapHasAsScala

/**
 * Pure JSON-RPC handler for `document/checkWithPide`. Separate from
 * the per-keystroke `document/openTheory` / `document/update` path
 * because PIDE submission is heavy (5-30 s first call, sub-second
 * subsequent) and must NOT block fast document sync.
 *
 * Lifecycle:
 *
 *   - Resolve `IsabelleHome` from env + per-request executablePath.
 *   - Resolve scratch dir from `BACKEND_SCRATCH_DIR` env var
 *     (populated by `BackendManager.spawn` from VS Code's
 *     `context.globalStorageUri.fsPath`).
 *   - Get-or-build the long-lived [[HeadlessFacade]] via the shared
 *     [[HeadlessSessionRegistry]] singleton in [[Main]].
 *   - Stage the document text through [[ScratchTheoryStore]] (with
 *     `Symbol.encode` round-trip applied).
 *   - Invoke [[HeadlessFacade.submitTheory]] and serialize the
 *     [[HeadlessFacade.SubmissionResult]] to JSON.
 *
 * On any failure, returns `status: "pide-failed"` (or
 * `"pide-unavailable"` when no Isabelle install resolves) with a
 * structured `reason` and human-friendly `message` so the TS side
 * can surface the right toast.
 */
object CheckWithPideHandler {

  def handle(
    params: Option[ujson.Value],
    documents: DocumentStore,
    registry: HeadlessSessionRegistry,
    env: Map[String, String],
    platform: String,
    fs: IsabelleHomeFs = RealIsabelleHomeFs
  ): ujson.Value = {
    val obj = params.flatMap(_.objOpt).getOrElse(ujson.Obj().obj)
    val uri = obj.get("uri").flatMap(_.strOpt).getOrElse("")
    val version = obj.get("version").flatMap(_.numOpt.map(_.toInt))
    val theoryName = obj.get("theoryName").flatMap(_.strOpt).filter(_.nonEmpty)
      .orElse(deriveTheoryNameFromUri(uri))
      .getOrElse("Unknown")
    val session = obj.get("session").flatMap(_.strOpt).filter(_.nonEmpty)
    val executablePath = obj.get("isabelleExecutablePath").flatMap(_.strOpt).filter(_.nonEmpty)
    val workspaceUri = obj.get("workspaceUri").flatMap(_.strOpt).filter(_.nonEmpty).getOrElse("default")
    val sessionDirs = parseSessionDirectories(obj)
    val text = obj.get("text").flatMap(_.strOpt)
      .orElse(documents.peekText(uri))

    text match {
      case None =>
        unavailable(
          uri = uri,
          version = version,
          theoryName = theoryName,
          session = session,
          reason = "text-missing",
          message = "Theory document text is not synchronized with the backend; open the file before running this command."
        )
      case Some(_) if session.isEmpty =>
        unavailable(
          uri = uri,
          version = version,
          theoryName = theoryName,
          session = session,
          reason = "session-not-selected",
          message = "Select an active Isabelle session via `Isabelle: Select Active Session` before submitting a theory to PIDE."
        )
      case Some(theoryText) =>
        IsabelleHome.resolve(env, executablePath, platform, fs) match {
          case None =>
            unavailable(
              uri = uri,
              version = version,
              theoryName = theoryName,
              session = session,
              reason = "home-not-found",
              message = "No Isabelle install resolved; set ISABELLE_HOME or configure isabelle.executablePath."
            )

          case Some(home) =>
            IsabellePideClasspath.build(home, fs) match {
              case Left(classpathError) =>
                unavailable(
                  uri = uri,
                  version = version,
                  theoryName = theoryName,
                  session = session,
                  reason = classpathError match {
                    case IsabellePideClasspath.IsabelleJarMissing  => "isabelle-jar-missing"
                    case IsabellePideClasspath.ScalaRuntimeMissing => "scala-runtime-missing"
                  },
                  message = classpathError.message
                )

              case Right(classpath) =>
                runSubmission(
                  uri = uri,
                  version = version,
                  theoryName = theoryName,
                  session = session.get,
                  theoryText = theoryText,
                  workspaceUri = workspaceUri,
                  home = home,
                  cygwinRoot = HeadlessBootstrap.deriveCygwinRoot(home, platform),
                  classpath = classpath,
                  registry = registry,
                  env = env,
                  sessionDirs = sessionDirs
                )
            }
        }
    }
  }

  private def runSubmission(
    uri: String,
    version: Option[Int],
    theoryName: String,
    session: String,
    theoryText: String,
    workspaceUri: String,
    home: Path,
    cygwinRoot: String,
    classpath: IsabellePideClasspath.Resolved,
    registry: HeadlessSessionRegistry,
    env: Map[String, String],
    sessionDirs: Seq[Path]
  ): ujson.Value = {
    registry.acquireOrBuild(classpath, home, cygwinRoot, session, sessionDirs) match {
      case Left(HeadlessFacade.CancelledBuild(notes)) =>
        Status.cancelled(uri, version, theoryName, session, notes)
      case Left(HeadlessFacade.BootstrapError(step, reason, notes)) =>
        Status.failed(uri, version, theoryName, session, reason, s"PIDE bootstrap failed at $step: $reason", notes)
      case Right(facade) =>
        val scratchRoot = ScratchTheoryStore.resolveScratchRoot(env)
        val scratchStore = new ScratchTheoryStore(scratchRoot, SymbolTranslator.Identity)
        try scratchStore.initialize() catch { case t: Throwable =>
          return Status.failed(uri, version, theoryName, session, s"scratch-init: ${t.getClass.getSimpleName}", s"Failed to initialize scratch directory at $scratchRoot: ${Option(t.getMessage).getOrElse("")}", Seq.empty)
        }

        // Re-stage with the facade's translator (encoded on disk via
        // Symbol.encode reflectively). The scratchStore above used
        // Identity for the initial mkdirs; rebuild with the right
        // translator for the actual stage call.
        val translator = SymbolTranslator.load(facade.getClass.getClassLoader.getParent).getOrElse(SymbolTranslator.Identity)
        val translatorStore = new ScratchTheoryStore(scratchRoot, translator)

        // Phase 2b: mark the facade as in-flight so a concurrent
        // `pide/cancelWarmup` request from the main dispatcher
        // thread can interrupt the blocking `use_theories` JNI call
        // via `Session.stop()`. Always cleared in the `finally`
        // below, even on Throwable, so a panicking submission never
        // leaves the registry pointing at a stale facade.
        registry.markInflight(facade)
        try {
          facade.submitTheory(workspaceUri, theoryName, theoryText, translatorStore) match {
          case Left(reason) =>
            // Phase 2b: if the facade was torn down by an in-flight
            // cancel signal, surface as `pide-cancelled` rather than
            // generic `pide-failed`. The registry's
            // `cancelInflightWarmup()` calls `facade.shutdown()`,
            // which makes the subsequent `use_theories` JNI return
            // throw an Interrupt-class exception that submitTheory
            // catches and reports as a Left.
            if (facade.isShutDown) {
              Status.cancelled(uri, version, theoryName, session, facade.bootstrapNotes :+ s"use_theories failed after cancel: $reason")
            } else {
              Status.failed(uri, version, theoryName, session, reason, s"PIDE submission failed: $reason", facade.bootstrapNotes)
            }
          case Right(result) =>
            Status.success(uri, version, theoryName, session, facade, result)
        }
      } finally {
        registry.clearInflight()
      }
    }
  }

  private def deriveTheoryNameFromUri(uri: String): Option[String] = {
    if (uri.isEmpty) None
    else {
      val withoutQuery = uri.takeWhile(c => c != '?' && c != '#')
      val basename = withoutQuery.split('/').lastOption.getOrElse("")
      val withoutExt = if (basename.endsWith(".thy")) basename.dropRight(4) else basename
      if (withoutExt.nonEmpty) Some(withoutExt) else None
    }
  }

  private def parseSessionDirectories(obj: mutable.Map[String, ujson.Value]): Seq[Path] =
    obj.get("sessionDirectories")
      .flatMap(_.arrOpt)
      .map(_.flatMap(_.strOpt).filter(_.nonEmpty).map(Paths.get(_)).toSeq)
      .getOrElse(Seq.empty)

  private def unavailable(
    uri: String,
    version: Option[Int],
    theoryName: String,
    session: Option[String],
    reason: String,
    message: String
  ): ujson.Value = {
    val obj = ujson.Obj(
      "uri" -> uri,
      "theoryName" -> theoryName,
      "status" -> "pide-unavailable",
      "bridge" -> "local-syntax",
      "reason" -> reason,
      "message" -> message
    )
    version.foreach(v => obj("version") = v)
    session.foreach(s => obj("session") = s)
    obj
  }

  private object Status {
    def success(
      uri: String,
      version: Option[Int],
      theoryName: String,
      session: String,
      facade: HeadlessFacade,
      result: HeadlessFacade.SubmissionResult
    ): ujson.Value = {
      val statusStr = if (result.ok) "pide-ok" else "pide-errors"
      val obj = ujson.Obj(
        "uri" -> uri,
        "theoryName" -> theoryName,
        "session" -> session,
        "status" -> statusStr,
        "bridge" -> "pide-enabled",
        "ok" -> result.ok,
        "nodeCount" -> result.nodeCount,
        "errorCount" -> result.errorCount,
        "errorMessages" -> ujson.Arr(result.errorMessages.map(ujson.Str(_))*),
        "nodeNames" -> ujson.Arr(result.nodeNames.map(ujson.Str(_))*),
        "elapsedMs" -> result.elapsedMs,
        "bootstrapElapsedMs" -> facade.bootstrapElapsedMs,
        "message" ->
          (if (result.ok) s"PIDE check OK (${result.nodeCount} node(s), ${result.elapsedMs} ms)"
           else s"PIDE check found ${result.errorCount} error(s) across ${result.nodeCount} node(s)")
      )
      version.foreach(v => obj("version") = v)
      obj
    }

    def failed(
      uri: String,
      version: Option[Int],
      theoryName: String,
      session: String,
      reason: String,
      message: String,
      notes: Seq[String]
    ): ujson.Value = {
      val obj = ujson.Obj(
        "uri" -> uri,
        "theoryName" -> theoryName,
        "session" -> session,
        "status" -> "pide-failed",
        "bridge" -> "local-syntax",
        "reason" -> reason,
        "message" -> message,
        "notes" -> ujson.Arr(notes.map(ujson.Str(_))*)
      )
      version.foreach(v => obj("version") = v)
      obj
    }

    def cancelled(
      uri: String,
      version: Option[Int],
      theoryName: String,
      session: String,
      notes: Seq[String]
    ): ujson.Value = {
      val obj = ujson.Obj(
        "uri" -> uri,
        "theoryName" -> theoryName,
        "session" -> session,
        "status" -> "pide-cancelled",
        "bridge" -> "local-syntax",
        "reason" -> "warmup-cancelled",
        "message" -> "PIDE warmup cancelled before the session was ready.",
        "notes" -> ujson.Arr(notes.map(ujson.Str(_))*)
      )
      version.foreach(v => obj("version") = v)
      obj
    }
  }
}
