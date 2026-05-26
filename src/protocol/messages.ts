export const PROTOCOL_VERSION = 1;

export type ServerMethod =
  | "server/health"
  | "isabelle/version"
  | "isabelle/pideVersion"
  | "session/discover"
  | "document/openTheory"
  | "document/update"
  | "document/close"
  | "document/checkWithPide"
  | "pide/cancelWarmup"
  | "pide/warmup"
  | "pide/cacheState"
  | "pide/invalidateCache"
  | "proofState/get"
  | "proofState/getWithPide"
  | "sledgehammer/run"
  | "sledgehammer/cancel";

export interface ProtocolRequest<TParams = unknown> {
  jsonrpc: "2.0";
  id: string;
  method: ServerMethod;
  protocolVersion: number;
  params?: TParams;
}

export interface ProtocolError {
  code: number;
  message: string;
  data?: unknown;
}

export interface ProtocolResponse<TResult = unknown> {
  jsonrpc: "2.0";
  id: string;
  result?: TResult;
  error?: ProtocolError;
}

export interface HealthParams {
  isabelleExecutablePath?: string;
}

export interface HealthResult {
  protocolVersion: number;
  backend: {
    status: "ok";
    implementation: "scala";
  };
  isabelle: {
    status: "ok" | "unavailable" | "unknown";
    executablePath?: string;
    version?: string;
    reason?: string;
  };
}

export interface VersionParams {
  isabelleExecutablePath?: string;
}

export interface VersionResult {
  executablePath: string;
  version: string;
  raw: string;
}

/**
 * Phase 1 PIDE classpath bridge diagnostic. Returned by the
 * `isabelle/pideVersion` JSON-RPC method. The shape mirrors the
 * Scala-side `PideRuntimeStatus` case class. The `version` string is
 * the displayed Isabelle release (or `""` when unavailable); the
 * `bridge` / `source` / `proofOfLife` / `reason` fields surface the
 * full diagnostic for the `Isabelle: Show PIDE Backend Status` UX.
 */
export interface PideVersionParams {
  isabelleExecutablePath?: string;
}

export type PideBridgeKind = "pide-enabled" | "local-syntax";

export type PideVersionSource =
  | "isabelle_system-module"
  | "etc-identifier-file"
  | "unavailable";

export type PideProofOfLife = "module-loaded" | "class-only" | "none";

export type PideVersionReason =
  | "home-not-found"
  | "isabelle-jar-missing"
  | "scala-runtime-missing"
  | "class-load-failed"
  | "module-init-failed";

export interface PideVersionResult {
  bridge: PideBridgeKind;
  version: string;
  isabelleHome?: string;
  source: PideVersionSource;
  classloaderReady: boolean;
  proofOfLife: PideProofOfLife;
  reason?: PideVersionReason;
  message: string;
}

export interface DiscoverSessionsParams {
  workspaceFolders: string[];
  roots?: string[];
  afpPath?: string;
}

export interface DiscoveredTheory {
  name: string;
  path?: string;
}

export interface DiscoveredSession {
  name: string;
  parent?: string;
  rootDirectory: string;
  sessionDirectory: string;
  theories: DiscoveredTheory[];
  importedSessions: string[];
  directories: string[];
  documentFiles: string[];
}

export interface DiscoverSessionsResult {
  sessions: DiscoveredSession[];
}

export interface ProtocolPosition {
  line: number;
  character: number;
}

export interface ProtocolRange {
  start: ProtocolPosition;
  end: ProtocolPosition;
}

export interface CommandSpan {
  id: string;
  kind: string;
  name?: string;
  range: ProtocolRange;
  status: "pending" | "running" | "finished" | "failed" | "unknown";
}

export interface OpenTheoryParams {
  uri: string;
  text: string;
  version: number;
  session?: string;
}

export interface UpdateTheoryParams {
  uri: string;
  text: string;
  version: number;
}

export interface CloseTheoryParams {
  uri: string;
}

export interface TheoryDocumentResult {
  uri: string;
  version: number;
  commandSpans: CommandSpan[];
}

export interface CloseTheoryResult {
  uri: string;
}

export interface ProofStateParams {
  uri: string;
  version: number;
  position: ProtocolPosition;
}

export interface ProofStateContextEntry {
  kind: "fixed" | "assumption" | "fact";
  name?: string;
  value: string;
}

export interface ProofStateGoal {
  index: number;
  text: string;
}

export interface ProofStateResult {
  uri: string;
  version?: number;
  status: "ready" | "unavailable";
  command?: CommandSpan;
  context: ProofStateContextEntry[];
  goals: ProofStateGoal[];
  raw: string;
  message?: string;
}

export type SledgehammerStatus = "running" | "completed" | "unavailable" | "cancelled" | "failed";

export interface SledgehammerRunParams {
  requestId: string;
  uri: string;
  version: number;
  position: ProtocolPosition;
  session?: string;
  isabelleExecutablePath?: string;
  /** Phase 5 — optional theory text override (sent when the document
   * may not be in the backend's DocumentStore). */
  text?: string;
  /** Phase 5 — optional theory name (defaults to uri's basename). */
  theoryName?: string;
  /** Phase 5 — optional workspace folder uri for scratch root keying. */
  workspaceUri?: string;
  /** Optional directories containing ROOT files for workspace sessions. */
  sessionDirectories?: string[];
  /** Phase 5 — raw `[k=v]` Sledgehammer parameters
   * (e.g. `{ minimize: "true", max_facts: "8", preplay_timeout: "10" }`). */
  sledgehammerOptions?: Record<string, string>;
  /** Phase 5 — `(fact1 fact2 ...)` fact restriction. */
  onlyFacts?: string[];
  /** Phase 5 — `(add: fact1 fact2 ...)` extra facts. */
  addFacts?: string[];
  /** Phase 5 — `(del: fact1 fact2 ...)` excluded facts. */
  delFacts?: string[];
}

export interface SledgehammerSuggestion {
  label?: string;
  method?: string;
  description?: string;
  proofText: string;
  score?: number;
}

export interface SledgehammerRunResult {
  requestId: string;
  uri: string;
  version?: number;
  /** Cursor position captured when the request was dispatched. */
  position?: ProtocolPosition;
  status: SledgehammerStatus;
  command?: CommandSpan;
  suggestions: SledgehammerSuggestion[];
  raw: string;
  message?: string;
  /** Phase 5: the verbatim `sledgehammer [...] (...)` text the
   * backend injected — useful for the minimize UX so the user can see
   * exactly which fact set was tried. */
  injectedCommand?: string;
}

export interface SledgehammerCancelParams {
  requestId?: string;
}

export interface SledgehammerCancelResult {
  requestId?: string;
  cancelled: boolean;
  message: string;
}

export class ProtocolRequestError extends Error {
  public readonly code: number;
  public readonly data: unknown;

  public constructor(error: ProtocolError) {
    super(error.message);
    this.name = "ProtocolRequestError";
    this.code = error.code;
    this.data = error.data;
  }
}

/**
 * Phase 2a `document/checkWithPide` JSON-RPC types. The bridge
 * resolves an Isabelle install, lazy-builds a long-lived
 * `Headless.Session`, stages the editor's text on disk (with Symbol
 * encoding applied), and runs `use_theories` against it.
 *
 * Use this for ad-hoc theory checks triggered by
 * `Isabelle: Show PIDE Document Status` (and future save-time
 * hooks). NOT used for per-keystroke `document/update` — that path
 * still returns local-syntax command spans for fast UI feedback.
 */
export interface CheckWithPideParams {
  uri: string;
  version: number;
  session: string;
  theoryName?: string;
  workspaceUri?: string;
  isabelleExecutablePath?: string;
  /** Optional directories containing ROOT files for workspace sessions. */
  sessionDirectories?: string[];
  /** Optional inline text. If absent, the backend uses the most
    * recent text synchronized via `document/openTheory`/`update`. */
  text?: string;
}

export type CheckWithPideStatus =
  | "pide-ok"
  | "pide-errors"
  | "pide-cancelled"
  | "pide-unavailable"
  | "pide-failed";

export type CheckWithPideReason =
  | "text-missing"
  | "session-not-selected"
  | "home-not-found"
  | "isabelle-jar-missing"
  | "scala-runtime-missing"
  | "warmup-cancelled"
  | "environment-init"
  | "options-init"
  | "resources-make"
  | "start-session"
  | string;

export interface CheckWithPideResult {
  uri: string;
  version?: number;
  theoryName: string;
  session?: string;
  status: CheckWithPideStatus;
  bridge: "pide-enabled" | "local-syntax";
  ok?: boolean;
  nodeCount?: number;
  nodeNames?: string[];
  errorCount?: number;
  errorMessages?: string[];
  elapsedMs?: number;
  bootstrapElapsedMs?: number;
  reason?: CheckWithPideReason;
  message: string;
  notes?: string[];
}

export interface CancelWarmupParams {
  // Reserved for future use; currently the backend cancels the
  // single in-flight warmup regardless of params.
}

export interface CancelWarmupResult {
  cancelled: boolean;
  message: string;
}

/**
 * Phase 2c PIDE cache lifecycle types.
 *
 * The backend exposes three new methods around the long-lived
 * `Headless.Session` cache the registry holds for the process
 * lifetime:
 *
 *   - `pide/warmup` — eagerly build the cached facade so the first
 *     user-facing PIDE call is sub-second. Honored from
 *     `isabelle.pide.prewarmOnActivation`.
 *   - `pide/cacheState` — read-only snapshot used by
 *     `Isabelle: Show PIDE Document Status` to surface why the next
 *     call might be slow.
 *   - `pide/invalidateCache` — force-evict the cached facade.
 *     Surfaced as `Isabelle: Invalidate PIDE Cache` for users who
 *     updated their Isabelle install in place.
 */
export interface WarmupParams {
  session?: string;
  isabelleExecutablePath?: string;
  /** Optional directories containing ROOT files for workspace sessions. */
  sessionDirectories?: string[];
}

export type WarmupStatus = "ready" | "skipped" | "cancelled" | "failed";

export interface WarmupResult {
  status: WarmupStatus;
  message: string;
  reason?: string;
  session?: string;
  isabelleHome?: string;
  elapsedMs?: number;
  bootstrapElapsedMs?: number;
  alreadyCached?: boolean;
  cacheState?: PideCacheStateResult;
  notes?: string[];
}

export interface PideCacheFingerprint {
  canonicalHome: string;
  sessionName: string;
  sessionDirs?: string[];
  isabelleJarSize: number;
  isabelleJarMtimeMillis: number;
}

export interface PideCacheStateResult {
  hasCachedFacade: boolean;
  fingerprint?: PideCacheFingerprint;
  hasInflightSubmission: boolean;
  lastBootstrapElapsedMs?: number;
}

export interface InvalidatePideCacheResult {
  invalidated: boolean;
  previousFingerprint: PideCacheFingerprint | null;
  message: string;
}

/**
 * Phase 3 PIDE-backed proof-state types. Routed through
 * `proofState/getWithPide`. Returns the same shape as
 * `proofState/get` (`status: "ready" | "unavailable"`, `context`,
 * `goals`, `raw`) so the existing proof-state panel can consume
 * either source identically.
 *
 * Locked design (plan.md §Phase 3):
 *   - Backend caches `Document.Snapshot` per `(uri, version, session)`
 *     (LRU-16, lazy populate). Subsequent cursor moves within the
 *     same version are sub-second.
 *   - Cursor-move debouncing is the TS panel's responsibility; the
 *     backend treats each call as independent.
 */
export interface ProofStateWithPideParams {
  uri: string;
  version?: number;
  position: ProtocolPosition;
  session: string;
  theoryName?: string;
  workspaceUri?: string;
  isabelleExecutablePath?: string;
  /** Optional directories containing ROOT files for workspace sessions. */
  sessionDirectories?: string[];
  text?: string;
}

export type ProofStateWithPideReason =
  | "text-missing"
  | "session-not-selected"
  | "home-not-found"
  | "isabelle-jar-missing"
  | "scala-runtime-missing"
  | "warmup-cancelled"
  | "submit-failed"
  | "snapshot-missing"
  | "extract-failed"
  | string;

export interface ProofStateWithPideCommand {
  id: string;
  kind: string;
  name?: string | null;
  status: string;
  startOffset?: number;
  endOffset?: number;
}

export interface ProofStateWithPideResult {
  uri: string;
  version?: number;
  session?: string;
  theoryName?: string;
  status: "ready" | "unavailable";
  bridge: "pide-enabled" | "local-syntax";
  fromCache?: boolean;
  command?: ProofStateWithPideCommand | null;
  context: ProofStateContextEntry[];
  goals: ProofStateGoal[];
  raw: string;
  notes?: string[];
  reason?: ProofStateWithPideReason;
  message?: string;
}

export function createRequest<TParams>(
  id: string,
  method: ServerMethod,
  params?: TParams
): ProtocolRequest<TParams> {
  return {
    jsonrpc: "2.0",
    id,
    method,
    protocolVersion: PROTOCOL_VERSION,
    params
  };
}

export function isProtocolResponse(value: unknown): value is ProtocolResponse {
  if (!isRecord(value)) {
    return false;
  }

  return value.jsonrpc === "2.0" && typeof value.id === "string";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
