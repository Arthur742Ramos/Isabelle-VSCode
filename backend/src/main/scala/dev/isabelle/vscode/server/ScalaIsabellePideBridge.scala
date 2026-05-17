package dev.isabelle.vscode.server

/**
 * Configuration needed to launch an Isabelle session through the
 * scala-isabelle library. None of the fields are validated by the
 * bridge itself; the future live implementation will resolve and
 * verify them when it actually starts an Isabelle process.
 *
 * @param isabelleHome    Path to an Isabelle installation directory
 *                        (the `Isabelle202x` folder on Linux/macOS).
 * @param userDir         Optional path used as Isabelle's user
 *                        directory; falls back to the upstream
 *                        default when [[None]].
 * @param sessionName     Optional human-readable label for the
 *                        session. Useful in logs once live calls are
 *                        wired in.
 * @param logicSession    Optional Isabelle logic session to load
 *                        (e.g. `"HOL"`).
 * @param workingDirectory Optional working directory for the
 *                        Isabelle process.
 */
final case class ScalaIsabelleConfig(
  isabelleHome: String,
  userDir: Option[String],
  sessionName: Option[String],
  logicSession: Option[String],
  workingDirectory: Option[String]
)

/**
 * Lifecycle state of a [[ScalaIsabellePideBridge]]. The scaffold in
 * this PR starts directly in [[ScalaIsabelleBridgeState.Unavailable]]
 * because it does not yet attempt to start an Isabelle process. The
 * future live implementation is expected to introduce real transitions
 * such as `Uninitialized -> Initializing -> Ready` (or
 * `Initializing -> Unavailable` on failure); the `Uninitialized` and
 * `Initializing` cases are declared now so the state surface does not
 * have to change shape when that lands.
 */
sealed trait ScalaIsabelleBridgeState

object ScalaIsabelleBridgeState {
  case object Uninitialized extends ScalaIsabelleBridgeState
  case object Initializing extends ScalaIsabelleBridgeState
  final case class Ready(detail: String) extends ScalaIsabelleBridgeState
  final case class Unavailable(reason: String) extends ScalaIsabelleBridgeState
}

/**
 * Scaffold for a future PIDE-backed [[PideBridge]] implementation that
 * talks to Isabelle through the
 * [[https://github.com/dominique-unruh/scala-isabelle scala-isabelle]]
 * library.
 *
 * '''This implementation does not start an Isabelle process and does
 * not perform any live PIDE calls.''' It exists so that the
 * `de.unruh:scala-isabelle` dependency is wired into the backend and
 * the bridge surface is in place; the live PIDE invocations are
 * intentionally deferred to a follow-up PR once the TypeScript-side
 * configuration plumbing exists. See `docs/PIDE_INTEGRATION.md` (to be
 * added by that follow-up) for the staged plan.
 *
 * Runtime constraints once live PIDE is wired in:
 *
 *   - Linux or macOS. scala-isabelle does not support Windows at
 *     runtime, so this bridge will refuse to enter a `Ready` state on
 *     Windows even when the dependency is on the classpath.
 *   - Java 11+.
 *   - A local Isabelle installation (Isabelle 2019 or newer) reachable
 *     at the configured [[ScalaIsabelleConfig.isabelleHome]].
 *
 * Because nothing is live yet, all proof-aware methods report
 * `status = "unavailable"` with an honest message that points at the
 * follow-up work, while [[documentResult]] delegates to the supplied
 * [[fallback]] so that document synchronization keeps producing the
 * exact response shape every keystroke-time TypeScript consumer
 * (e.g. `DocumentSyncService`) already depends on.
 *
 * @param config   The configuration the live bridge will eventually
 *                 use to start an Isabelle process.
 * @param fallback The [[PideBridge]] implementation that backs every
 *                 response while live PIDE calls are not yet wired in
 *                 (typically a [[LocalSyntaxPideBridge]]).
 */
final class ScalaIsabellePideBridge(
  config: ScalaIsabelleConfig,
  fallback: PideBridge
) extends PideBridge {

  private val state: ScalaIsabelleBridgeState =
    ScalaIsabelleBridgeState.Unavailable(
      "ScalaIsabellePideBridge: live PIDE calls are not yet wired; see docs/PIDE_INTEGRATION.md."
    )

  /**
   * Snapshot of the current bridge state. Exposed primarily for tests
   * and for future diagnostic surfaces; the JSON-RPC protocol does not
   * depend on this method.
   */
  def stateSnapshot: ScalaIsabelleBridgeState = state

  /** Snapshot of the configuration this bridge was constructed with. */
  def configSnapshot: ScalaIsabelleConfig = config

  /**
   * Delegate to the [[fallback]] bridge so that every document
   * synchronization (open/update) keeps producing the response shape
   * that `src/document/DocumentSyncService.ts` already expects on the
   * critical keystroke path. Diverging from the fallback shape here
   * would risk breaking command-span rendering, decorations, document
   * status, and the proof outline view at once, so the stub stays
   * exactly equal to the fallback's output.
   *
   * Once live PIDE document processing is wired in, this method will
   * grow extra fields in a backwards-compatible way (and the
   * TypeScript protocol declarations will be updated to match).
   */
  override def documentResult(document: TheoryDocument): ujson.Value =
    fallback.documentResult(document)

  /**
   * Honest proof-state stub: copy the fallback's response shape so the
   * existing TypeScript renderer keeps working, override `message`
   * with a scaffold-specific explanation, and keep `status` at
   * `"unavailable"` (mirroring the contract `LocalSyntaxPideBridge`
   * already follows).
   */
  override def proofState(
    document: TheoryDocument,
    line: Int,
    character: Int
  ): ujson.Value = {
    val base = fallback.proofState(document, line, character)
    overrideStubMessage(base, scaffoldMessage(
      "ScalaIsabellePideBridge stub: real Isabelle/PIDE proof state is not wired yet; " +
        "see docs/PIDE_INTEGRATION.md."
    ))
  }

  /**
   * Honest Sledgehammer stub: copy the fallback's response shape and
   * override `message` so the surface is transparent about being a
   * scaffold without live proof search.
   */
  override def sledgehammer(request: SledgehammerRequest): ujson.Value = {
    val base = fallback.sledgehammer(request)
    overrideStubMessage(base, scaffoldMessage(
      "ScalaIsabellePideBridge stub: real Isabelle/PIDE Sledgehammer proof search is " +
        "not wired yet; see docs/PIDE_INTEGRATION.md."
    ))
  }

  private def scaffoldMessage(base: String): String = state match {
    case ScalaIsabelleBridgeState.Unavailable(reason) => s"$base ($reason)"
    case _                                            => base
  }

  /**
   * Returns a copy of [[base]] with the `message` field overridden.
   * `base` is expected to be a JSON object produced by the fallback
   * bridge; if it is not, the value is returned unchanged so the
   * caller still sees the fallback's shape verbatim.
   */
  private def overrideStubMessage(base: ujson.Value, message: String): ujson.Value =
    base.objOpt match {
      case Some(fields) =>
        val updated = scala.collection.mutable.LinkedHashMap.empty[String, ujson.Value]
        fields.foreach { case (key, value) => updated.update(key, value) }
        updated.update("message", ujson.Str(message))
        ujson.Obj.from(updated)
      case None =>
        base
    }
}
