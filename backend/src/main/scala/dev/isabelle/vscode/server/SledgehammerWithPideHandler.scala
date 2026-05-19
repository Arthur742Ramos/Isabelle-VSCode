package dev.isabelle.vscode.server

/**
 * Phase 4 JSON-RPC handler for `sledgehammer/run` over the PIDE
 * (Headless) backend. Strategy:
 *
 *   1. Take the user's cursor position and the live document text.
 *   2. Inject `sledgehammer` as a new line in the source text before
 *      the cursor's line via [[SledgehammerSourceInjector]].
 *   3. Submit the injected text via `Headless.Session.use_theories`
 *      (Phase 2a/3b infrastructure reused intact).
 *   4. Walk `snapshot.messages` reflectively via
 *      [[SnapshotProofStateExtractor]] to harvest the prover output.
 *   5. Parse the "Try this: ..." lines via
 *      [[SledgehammerSuggestionParser]] into a structured
 *      [[Seq[SledgehammerSuggestionParser.Suggestion]]].
 *
 * Returns the existing `SledgehammerRunResult` wire shape so the
 * `SledgehammerPanel` renders Headless-mode suggestions identically
 * to the LSP path.
 *
 * Cancellation: reuses the Phase 2b `Session.stop()` teardown via
 * `registry.cancelInflightWarmup`, surfaced from the
 * `sledgehammer/cancel` JSON-RPC method in `Main.scala`.
 *
 * Important: we deliberately do NOT cache injected snapshots in
 * [[SnapshotCache]] — the cache key (uri, version, session) refers
 * to the user's actual source. A sledgehammer submission has a
 * DIFFERENT source (we mutated it). If we cached it, a follow-up
 * `proofState/get` would see stale state. We DO evict any existing
 * cache entry for the URI after running because the live snapshot
 * inside the Session has been re-evaluated against the mutated text.
 */
object SledgehammerWithPideHandler {

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
    val requestId = obj.get("requestId").flatMap(_.strOpt).getOrElse("")
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
    val text = obj.get("text").flatMap(_.strOpt).orElse(documents.peekText(uri))

    text match {
      case None =>
        unavailable(requestId, uri, versionOpt, "text-missing",
          "Theory document text is not synchronized with the backend; open the file before running Sledgehammer.")
      case Some(_) if session.isEmpty =>
        unavailable(requestId, uri, versionOpt, "session-not-selected",
          "Select an active Isabelle session via `Isabelle: Select Active Session` before running PIDE Sledgehammer.")
      case Some(theoryText) =>
        val version = versionOpt.getOrElse(documents.peekVersion(uri).getOrElse(0))
        val sessionName = session.get
        val options = parseOptions(obj)
        runInjectedSubmission(
          requestId, uri, version, sessionName, theoryText, line, character, theoryName, workspaceUri,
          executablePath, env, platform, fs, registry, snapshotCache, options
        )
    }
  }

  /**
   * Parse the optional Phase 5 fields from the request:
   *
   *   - `sledgehammerOptions`: object → `Options.params`
   *   - `onlyFacts`: array of strings → `Options.onlyFacts`
   *   - `addFacts`: array of strings → `Options.addFacts`
   *   - `delFacts`: array of strings → `Options.delFacts`
   */
  private[server] def parseOptions(obj: scala.collection.mutable.Map[String, ujson.Value]): SledgehammerSourceInjector.Options = {
    val params = obj.get("sledgehammerOptions")
      .flatMap(_.objOpt)
      .map(o => o.iterator.collect { case (k, v) if v.strOpt.isDefined => k -> v.str }.toMap)
      .getOrElse(Map.empty[String, String])
    def strArr(field: String): Seq[String] =
      obj.get(field).flatMap(_.arrOpt)
        .map(_.flatMap(_.strOpt).filter(_.nonEmpty).toSeq)
        .getOrElse(Seq.empty)
    SledgehammerSourceInjector.Options(
      params = params,
      onlyFacts = strArr("onlyFacts"),
      addFacts = strArr("addFacts"),
      delFacts = strArr("delFacts")
    )
  }

  private def runInjectedSubmission(
    requestId: String,
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
    options: SledgehammerSourceInjector.Options
  ): ujson.Value = {
    IsabelleHome.resolve(env, executablePath, platform, fs) match {
      case None =>
        unavailable(requestId, uri, Some(version), "home-not-found",
          "No Isabelle install resolved; set ISABELLE_HOME or configure isabelle.executablePath.", Some(session))

      case Some(home) =>
        IsabellePideClasspath.build(home, fs) match {
          case Left(error) =>
            val reason = error match {
              case IsabellePideClasspath.IsabelleJarMissing  => "isabelle-jar-missing"
              case IsabellePideClasspath.ScalaRuntimeMissing => "scala-runtime-missing"
            }
            unavailable(requestId, uri, Some(version), reason, error.message, Some(session))

          case Right(classpath) =>
            registry.acquireOrBuild(classpath, home, HeadlessBootstrap.deriveCygwinRoot(home, platform), session) match {
              case Left(HeadlessFacade.CancelledBuild(_)) =>
                cancelled(requestId, uri, Some(version), Some(session),
                  "Sledgehammer cancelled before the PIDE session was ready.")
              case Left(HeadlessFacade.BootstrapError(step, reason, _)) =>
                unavailable(requestId, uri, Some(version), step,
                  s"PIDE bootstrap failed at $step: $reason", Some(session))
              case Right(facade) =>
                val scratchRoot = ScratchTheoryStore.resolveScratchRoot(env)
                val scratchStore = new ScratchTheoryStore(scratchRoot, SymbolTranslator.Identity)
                try scratchStore.initialize() catch { case t: Throwable =>
                  return unavailable(requestId, uri, Some(version), "scratch-init",
                    s"Failed to initialize scratch directory at $scratchRoot: ${Option(t.getMessage).getOrElse("")}", Some(session))
                }
                val translator = SymbolTranslator.load(facade.reflectionLoader).getOrElse(SymbolTranslator.Identity)
                val translatorStore = new ScratchTheoryStore(scratchRoot, translator)

                // Inject `sledgehammer` at the cursor's line, with
                // any Phase 5 fact-override / params attached.
                val injection = SledgehammerSourceInjector.injectWithOptions(theoryText, line, character, options)

                registry.markInflight(facade)
                try {
                  facade.submitTheoryWithRaw(workspaceUri, theoryName, injection.text, translatorStore) match {
                    case Left(reason) =>
                      if (facade.isShutDown) {
                        cancelled(requestId, uri, Some(version), Some(session),
                          "Sledgehammer was cancelled mid-run; the PIDE session will rebuild on the next request.")
                      } else {
                        failed(requestId, uri, Some(version), Some(session),
                          s"PIDE submission failed: $reason")
                      }
                    case Right((_, rawResult)) =>
                      facade.snapshotFor(rawResult, theoryName) match {
                        case Left(reason) =>
                          failed(requestId, uri, Some(version), Some(session),
                            s"Snapshot extraction failed: $reason")
                        case Right(snapshot) =>
                          // Evict any pre-existing cached snapshot for this URI;
                          // it's now stale because Session re-evaluated against
                          // mutated source.
                          snapshotCache.evictForUri(uri)
                          SnapshotProofStateExtractor.extractAt(
                            facade.reflectionLoader, snapshot, injection.text,
                            injection.injectionLine, injection.injectionCharacter,
                            // Phase 3c: Sledgehammer needs whole-file output so the
                            // "Try this:" lines emitted during the injected
                            // sledgehammer command's elaboration are not dropped by
                            // the proof-state panel's per-cursor focus filter.
                            // See SnapshotProofStateExtractor.MessageFilterMode.
                            filterMode = SnapshotProofStateExtractor.MessageFilterMode.WholeSnapshot
                          ) match {
                            case Left(reason) =>
                              failed(requestId, uri, Some(version), Some(session),
                                s"Sledgehammer message extraction failed: $reason")
                            case Right(extracted) =>
                              renderResult(requestId, uri, version, session, theoryName, extracted, injection.commandSyntax)
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

  private def renderResult(
    requestId: String,
    uri: String,
    version: Int,
    session: String,
    theoryName: String,
    extracted: SnapshotProofStateExtractor.ExtractedProofState,
    commandSyntax: String
  ): ujson.Value = {
    val raw = extracted.raw
    val suggestions = SledgehammerSuggestionParser.parse(raw)
    val suggestionsArr = ujson.Arr(suggestions.map { s =>
      val obj = ujson.Obj(
        "label" -> s.method,
        "method" -> s.method,
        "proofText" -> s.proofText
      )
      s.description.foreach(d => obj("description") = d)
      obj
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
    val message =
      if (suggestions.nonEmpty) s"Sledgehammer found ${suggestions.size} proof suggestion(s)."
      else "Sledgehammer ran but produced no proof suggestions (try a different cursor position or expand the prover timeout)."
    ujson.Obj(
      "requestId" -> requestId,
      "uri" -> uri,
      "version" -> version,
      "session" -> session,
      "theoryName" -> theoryName,
      "status" -> "completed",
      "bridge" -> "pide-enabled",
      "command" -> commandJson,
      "injectedCommand" -> commandSyntax,
      "suggestions" -> suggestionsArr,
      "raw" -> raw,
      "notes" -> ujson.Arr(extracted.notes.map(ujson.Str(_))*),
      "message" -> message
    )
  }

  private def unavailable(
    requestId: String,
    uri: String,
    version: Option[Int],
    reason: String,
    message: String,
    session: Option[String] = None
  ): ujson.Value = {
    val obj = ujson.Obj(
      "requestId" -> requestId,
      "uri" -> uri,
      "status" -> "unavailable",
      "bridge" -> "local-syntax",
      "reason" -> reason,
      "suggestions" -> ujson.Arr(),
      "raw" -> "",
      "message" -> message
    )
    version.foreach(v => obj("version") = v)
    session.foreach(s => obj("session") = s)
    obj
  }

  private def cancelled(
    requestId: String,
    uri: String,
    version: Option[Int],
    session: Option[String],
    message: String
  ): ujson.Value = {
    val obj = ujson.Obj(
      "requestId" -> requestId,
      "uri" -> uri,
      "status" -> "cancelled",
      "bridge" -> "pide-enabled",
      "suggestions" -> ujson.Arr(),
      "raw" -> "",
      "message" -> message
    )
    version.foreach(v => obj("version") = v)
    session.foreach(s => obj("session") = s)
    obj
  }

  private def failed(
    requestId: String,
    uri: String,
    version: Option[Int],
    session: Option[String],
    message: String
  ): ujson.Value = {
    val obj = ujson.Obj(
      "requestId" -> requestId,
      "uri" -> uri,
      "status" -> "failed",
      "bridge" -> "pide-enabled",
      "suggestions" -> ujson.Arr(),
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
