export const PROTOCOL_VERSION = 1;

export type ServerMethod =
  | "server/health"
  | "isabelle/version"
  | "session/discover"
  | "document/openTheory"
  | "document/update"
  | "document/close"
  | "proofState/get";

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
