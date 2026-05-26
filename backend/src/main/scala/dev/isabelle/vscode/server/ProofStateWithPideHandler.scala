package dev.isabelle.vscode.server

import java.nio.file.{Path, Paths}
import scala.jdk.CollectionConverters.MapHasAsScala

/**
 * Phase 3 JSON-RPC handler for `proofState/getWithPide`. Routes
 * cursor-driven proof-state queries through:
 *
 *   1. The snapshot cache ([[SnapshotCache]]) keyed by
 *      `(uri, version, session)`. Cache hit → reuse cached
 *      `Document.Snapshot`, no `use_theories` re-submission.
 *   2. Cache miss → acquire a `HeadlessFacade` via the registry
 *      (Phase 2a/2b infrastructure), submit `use_theories` to get
 *      a fresh `Use_Theories_Result`, reflectively extract the
 *      `Document.Snapshot` for the target theory, store in cache.
 *   3. Walk the snapshot reflectively via
 *      [[SnapshotProofStateExtractor]] to find the command at the
 *      cursor and extract its proof state text.
 *
 * Returns the same `ProofStateResult` shape `proofState/get` does
 * (status / context / goals / raw / message) so the TS panel can
 * render either source identically.
 *
 * Lazy populate (no background pre-submit on document open) per the
 * locked Phase 3 design in plan.md.
 */
object ProofStateWithPideHandler {

  def handle(
    params: Option[ujson.Value],
    documents: DocumentStore,
    registry: HeadlessSessionRegistry,
    snapshotCache: SnapshotCache,
    env: Map[String, String],
    platform: String,
    fs: IsabelleHomeFs = RealIsabelleHomeFs
  ): ujson.Value = {
    val obj = params.flatMap(_.objOpt).getOrElse(ujson.Obj().obj)
    val uri = obj.get("uri").flatMap(_.strOpt).getOrElse("")
    val versionOpt = obj.get("version").flatMap(_.numOpt.map(_.toInt))
    val position = obj.get("position").flatMap(_.objOpt)
    val line = position.flatMap(_.get("line")).flatMap(_.numOpt.map(_.toInt)).getOrElse(0)
    val character = position.flatMap(_.get("character")).flatMap(_.numOpt.map(_.toInt)).getOrElse(0)
    val theoryName = obj.get("theoryName").flatMap(_.strOpt).filter(_.nonEmpty)
      .orElse(deriveTheoryNameFromUri(uri)).getOrElse("Unknown")
    val session = obj.get("session").flatMap(_.strOpt).filter(_.nonEmpty)
    val executablePath = obj.get("isabelleExecutablePath").flatMap(_.strOpt).filter(_.nonEmpty)
    val workspaceUri = obj.get("workspaceUri").flatMap(_.strOpt).filter(_.nonEmpty).getOrElse("default")
    val sessionDirs = parseSessionDirectories(obj)
    val text = obj.get("text").flatMap(_.strOpt).orElse(documents.peekText(uri))

    text match {
      case None =>
        unavailable(uri, versionOpt, "text-missing",
          "Theory document text is not synchronized with the backend; open the file before running this command.")
      case Some(_) if session.isEmpty =>
        unavailable(uri, versionOpt, "session-not-selected",
          "Select an active Isabelle session via `Isabelle: Select Active Session` before requesting PIDE proof state.")
      case Some(theoryText) =>
        val version = versionOpt.getOrElse(documents.peekVersion(uri).getOrElse(0))
        val sessionName = session.get
        snapshotCache.get(uri, version, sessionName) match {
          case Some(snapshot) =>
            extractFromCached(uri, version, sessionName, snapshot, registry, theoryText, line, character, theoryName)
          case None =>
            buildAndExtract(
              uri, version, sessionName, theoryText, line, character, theoryName, workspaceUri,
              executablePath, env, platform, fs, registry, snapshotCache, sessionDirs
            )
        }
    }
  }

  private def extractFromCached(
    uri: String,
    version: Int,
    session: String,
    snapshot: AnyRef,
    registry: HeadlessSessionRegistry,
    theoryText: String,
    line: Int,
    character: Int,
    theoryName: String
  ): ujson.Value = {
    val loader = registry.currentFacadeLoader.getOrElse(snapshot.getClass.getClassLoader)
    SnapshotProofStateExtractor.extractAt(loader, snapshot, theoryText, line, character) match {
      case Left(reason) =>
        unavailable(uri, Some(version), "extract-failed", s"Snapshot extraction failed: $reason", Some(session))
      case Right(extracted) =>
        renderResult(uri, version, session, theoryName, extracted, fromCache = true)
    }
  }

  private def buildAndExtract(
    uri: String,
    version: Int,
    session: String,
    theoryText: String,
    line: Int,
    character: Int,
    theoryName: String,
    workspaceUri: String,
    executablePath: Option[String],
    env: Map[String, String],
    platform: String,
    fs: IsabelleHomeFs,
    registry: HeadlessSessionRegistry,
    snapshotCache: SnapshotCache,
    sessionDirs: Seq[Path]
  ): ujson.Value = {
    IsabelleHome.resolve(env, executablePath, platform, fs) match {
      case None =>
        unavailable(uri, Some(version), "home-not-found",
          "No Isabelle install resolved; set ISABELLE_HOME or configure isabelle.executablePath.", Some(session))

      case Some(home) =>
        IsabellePideClasspath.build(home, fs) match {
          case Left(error) =>
            val reason = error match {
              case IsabellePideClasspath.IsabelleJarMissing  => "isabelle-jar-missing"
              case IsabellePideClasspath.ScalaRuntimeMissing => "scala-runtime-missing"
            }
            unavailable(uri, Some(version), reason, error.message, Some(session))

          case Right(classpath) =>
            registry.acquireOrBuild(classpath, home, HeadlessBootstrap.deriveCygwinRoot(home, platform), session, sessionDirs) match {
              case Left(HeadlessFacade.CancelledBuild(_)) =>
                unavailable(uri, Some(version), "warmup-cancelled",
                  "PIDE warmup cancelled before the session was ready.", Some(session))
              case Left(HeadlessFacade.BootstrapError(step, reason, _)) =>
                unavailable(uri, Some(version), step, s"PIDE bootstrap failed at $step: $reason", Some(session))
              case Right(facade) =>
                val scratchRoot = ScratchTheoryStore.resolveScratchRoot(env)
                val scratchStore = new ScratchTheoryStore(scratchRoot, SymbolTranslator.Identity)
                try scratchStore.initialize() catch { case t: Throwable =>
                  return unavailable(uri, Some(version), "scratch-init",
                    s"Failed to initialize scratch directory at $scratchRoot: ${Option(t.getMessage).getOrElse("")}", Some(session))
                }
                val translator = SymbolTranslator.load(facade.reflectionLoader).getOrElse(SymbolTranslator.Identity)
                val translatorStore = new ScratchTheoryStore(scratchRoot, translator)

                registry.markInflight(facade)
                try {
                  facade.submitTheoryWithRaw(workspaceUri, theoryName, theoryText, translatorStore) match {
                    case Left(reason) =>
                      if (facade.isShutDown) {
                        unavailable(uri, Some(version), "warmup-cancelled",
                          "PIDE submission was cancelled.", Some(session))
                      } else {
                        unavailable(uri, Some(version), "submit-failed",
                          s"PIDE submission failed: $reason", Some(session))
                      }
                    case Right((_, rawResult)) =>
                      facade.snapshotFor(rawResult, theoryName) match {
                        case Left(reason) =>
                          unavailable(uri, Some(version), "snapshot-missing",
                            s"Snapshot extraction failed: $reason", Some(session))
                        case Right(snapshot) =>
                          snapshotCache.put(uri, version, session, snapshot)
                          SnapshotProofStateExtractor.extractAt(facade.reflectionLoader, snapshot, theoryText, line, character) match {
                            case Left(reason) =>
                              unavailable(uri, Some(version), "extract-failed",
                                s"Proof state extraction failed: $reason", Some(session))
                            case Right(extracted) =>
                              renderResult(uri, version, session, theoryName, extracted, fromCache = false)
                          }
                      }
                  }
                } finally {
                  registry.clearInflight()
                }
            }
        }
    }
  }

  private def parseSessionDirectories(obj: scala.collection.mutable.Map[String, ujson.Value]): Seq[Path] =
    obj.get("sessionDirectories")
      .flatMap(_.arrOpt)
      .map(_.flatMap(_.strOpt).filter(_.nonEmpty).map(Paths.get(_)).toSeq)
      .getOrElse(Seq.empty)

  private def renderResult(
    uri: String,
    version: Int,
    session: String,
    theoryName: String,
    extracted: SnapshotProofStateExtractor.ExtractedProofState,
    fromCache: Boolean
  ): ujson.Value = {
    val goalsArr = ujson.Arr(extracted.goals.zipWithIndex.map { case (text, idx) =>
      ujson.Obj("index" -> (idx + 1), "text" -> text)
    }*)
    val commandJson = extracted.commandRangeOffsets match {
      case Some((startOff, endOff)) =>
        ujson.Obj(
          "id" -> s"$uri:$version:${extracted.commandKind.getOrElse("?")}:$startOff",
          "kind" -> extracted.commandKind.getOrElse("unknown"),
          "name" -> extracted.commandName.map(ujson.Str(_)).getOrElse(ujson.Null),
          "status" -> "finished",
          "startOffset" -> startOff,
          "endOffset" -> endOff
        )
      case None => ujson.Null
    }
    // Phase 3b: real prover messages reach us. Update the heuristic
    // accordingly — non-empty `goals` without the placeholder marker
    // means we have actual content.
    val hasRealGoals = extracted.goals.exists(g => g.nonEmpty && !g.startsWith("[results]") && !g.startsWith("[markup]"))
    val message = {
      val cmd = extracted.commandKind.getOrElse("(no command at cursor)")
      if (hasRealGoals) s"PIDE proof state ready ($cmd, ${extracted.goals.size} goal(s))."
      else s"PIDE snapshot ready ($cmd at offset ${extracted.commandRangeOffsets.map(_._1).getOrElse(0)}). No prover messages at this command (likely already finished without state output)."
    }
    ujson.Obj(
      "uri" -> uri,
      "version" -> version,
      "session" -> session,
      "theoryName" -> theoryName,
      "status" -> "ready",
      "bridge" -> "pide-enabled",
      "fromCache" -> fromCache,
      "command" -> commandJson,
      "context" -> ujson.Arr(),
      "goals" -> goalsArr,
      "raw" -> extracted.raw,
      "notes" -> ujson.Arr(extracted.notes.map(ujson.Str(_))*),
      "message" -> message
    )
  }

  private def unavailable(
    uri: String,
    version: Option[Int],
    reason: String,
    message: String,
    session: Option[String] = None
  ): ujson.Value = {
    val obj = ujson.Obj(
      "uri" -> uri,
      "status" -> "unavailable",
      "bridge" -> "local-syntax",
      "reason" -> reason,
      "context" -> ujson.Arr(),
      "goals" -> ujson.Arr(),
      "raw" -> "",
      "message" -> message
    )
    version.foreach(v => obj("version") = v)
    session.foreach(s => obj("session") = s)
    obj
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
}
