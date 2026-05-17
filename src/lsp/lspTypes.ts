export type IsabelleLanguageServerState =
  | "disabled"
  | "starting"
  | "running"
  | "stopping"
  | "failed";

export interface IsabelleLanguageServerStatus {
  state: IsabelleLanguageServerState;
  pid?: number;
  commandLine?: string;
  isabelleVersion?: string;
  lastError?: string;
  lastStartedAt?: string;
  lastStoppedAt?: string;
}
