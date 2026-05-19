package dev.isabelle.vscode.server

// PideBridge is the seam where a future PIDE-backed bridge will plug
// real Isabelle/PIDE status, entities, proof state, and proof search into
// the Scala backend. Today the only implementation is
// LocalSyntaxPideBridge, which keeps the conservative command-span and
// "unavailable" behavior the rest of the foundation already expects.
// The JSON-RPC layer (Main.scala) and the TypeScript extension stay
// unaware of which bridge is wired in, so milestones 4 (PIDE document
// connection), 5 (semantic markup with entity metadata), and 7
// (Sledgehammer proof search) can swap in a real PIDE-backed bridge
// without touching the protocol or the extension.

/**
 * Contract between [[DocumentStore]] and any document/proof-aware
 * engine implementation. Each method must return JSON shapes that match
 * the protocol declared in `src/protocol/messages.ts` on the extension
 * side; today those are [[LocalSyntaxPideBridge]]'s responses, and a
 * future PIDE-backed bridge must produce structurally identical
 * responses so the TypeScript client does not need to change.
 *
 * [[DocumentStore]] only invokes these methods for documents it has
 * already synchronized in its in-memory store, so implementations may
 * assume the supplied [[TheoryDocument]] reflects the latest text and
 * version known to the backend.
 */
trait PideBridge {
  /** Build the response for `document/openTheory` and `document/update`. */
  def documentResult(document: TheoryDocument): ujson.Value

  /** Build the response for `proofState/get` for a synchronized document. */
  def proofState(document: TheoryDocument, line: Int, character: Int): ujson.Value

  /** Build the response for `sledgehammer/run` for a synchronized document. */
  def sledgehammer(request: SledgehammerRequest): ujson.Value

  /**
   * Phase 1 proof-of-life: the resolved Isabelle version string, or the
   * empty string when the bridge cannot reach a real Isabelle install.
   * The JSON-RPC dispatcher does NOT use this method directly — it
   * builds a richer [[PideRuntimeStatus]] via [[PideBridgeSelector]] —
   * but the trait method lets future phases query the version without
   * going through the selector each time.
   */
  def isabelleVersion(): String
}

/**
 * Parameters for a Sledgehammer run on a synchronized theory document.
 * [[DocumentStore]] resolves the document from its in-memory map and
 * forwards the request to the active [[PideBridge]] implementation.
 */
final case class SledgehammerRequest(
  requestId: String,
  document: TheoryDocument,
  line: Int,
  character: Int,
  session: Option[String],
  isabelleExecutablePath: Option[String]
)

/**
 * Default [[PideBridge]] implementation: command spans come from
 * [[CommandSpanParser]] applied to the raw theory text, and proof-state
 * / Sledgehammer responses are reported as explicitly unavailable. This
 * preserves the behavior the rest of the milestone-3/5/7 foundation
 * already depends on while a real PIDE-backed bridge is built out.
 */
final class LocalSyntaxPideBridge extends PideBridge {
  override def documentResult(document: TheoryDocument): ujson.Value =
    ujson.Obj(
      "uri" -> document.uri,
      "version" -> document.version,
      "commandSpans" -> CommandSpanParser.parse(document).map(_.json)
    )

  override def isabelleVersion(): String = ""

  override def proofState(document: TheoryDocument, line: Int, character: Int): ujson.Value = {
    val spans = CommandSpanParser.parse(document)
    val command = spans.find(_.contains(line, character))
      .orElse(spans.reverse.find(_.startsBeforeOrAt(line, character)))

    ujson.Obj(
      "uri" -> document.uri,
      "version" -> document.version,
      "status" -> "unavailable",
      "command" -> command.map(_.json).getOrElse(ujson.Null),
      "context" -> ujson.Arr(),
      "goals" -> ujson.Arr(
        ujson.Obj(
          "index" -> 1,
          "text" -> "Live proof goals require Isabelle/PIDE proof-state integration."
        )
      ),
      "raw" -> ujson.Str(command
        .map(span => s"Current command: ${span.kind}${span.name.map(name => s" $name").getOrElse("")}")
        .getOrElse("No Isabelle command span at the current cursor position.")),
      "message" -> "Proof-state panel is connected; semantic goals/context are pending PIDE integration."
    )
  }

  override def sledgehammer(request: SledgehammerRequest): ujson.Value = {
    val document = request.document
    val spans = CommandSpanParser.parse(document)
    val command = spans.find(_.contains(request.line, request.character))
      .orElse(spans.reverse.find(_.startsBeforeOrAt(request.line, request.character)))
    val commandText = command
      .map(span => s"Current command: ${span.kind}${span.name.map(name => s" $name").getOrElse("")}")
      .getOrElse("No Isabelle command span at the current cursor position.")
    val sessionText = request.session.orElse(document.session)
      .map(value => s"Session: $value")
      .getOrElse("No active Isabelle session was provided.")
    val executableText = request.isabelleExecutablePath
      .filter(_.nonEmpty)
      .map(value => s"Isabelle executable: $value")
      .getOrElse("No Isabelle executable path was provided.")

    ujson.Obj(
      "requestId" -> request.requestId,
      "uri" -> document.uri,
      "version" -> document.version,
      "status" -> "unavailable",
      "command" -> command.map(_.json).getOrElse(ujson.Null),
      "suggestions" -> ujson.Arr(),
      "raw" -> Vector(
        commandText,
        sessionText,
        executableText,
        "Sledgehammer proof search requires live Isabelle/PIDE proof context; this backend currently exposes only the typed workflow boundary."
      ).mkString("\n"),
      "message" -> "Sledgehammer workflow is wired, but proof search is unavailable until the Scala backend integrates with Isabelle/PIDE."
    )
  }
}

/**
 * Phase 1 bridge that delegates the document / proof-state /
 * Sledgehammer methods to a wrapped [[LocalSyntaxPideBridge]] (Phase 2
 * and onward will replace each method with real PIDE-backed
 * implementations) but reports a non-empty [[isabelleVersion]] so the
 * `Isabelle: Show PIDE Backend Status` command can show the user a
 * resolved Isabelle version pulled from the runtime classpath.
 *
 * The version string is supplied at construction time by
 * [[PideBridgeSelector]], which already had to load the Isabelle
 * runtime classpath to construct this bridge in the first place.
 */
final class PideEnabledBridge(version: String) extends PideBridge {
  private val fallback = new LocalSyntaxPideBridge

  override def documentResult(document: TheoryDocument): ujson.Value =
    fallback.documentResult(document)

  override def proofState(document: TheoryDocument, line: Int, character: Int): ujson.Value =
    fallback.proofState(document, line, character)

  override def sledgehammer(request: SledgehammerRequest): ujson.Value =
    fallback.sledgehammer(request)

  override def isabelleVersion(): String = version
}
