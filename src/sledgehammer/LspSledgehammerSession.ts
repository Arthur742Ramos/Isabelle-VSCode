// Orchestrator for a single Sledgehammer run over Isabelle's bundled
// `isabelle vscode_server` LSP. Encapsulates the message dance documented
// in docs/sledgehammer_lsp_research.md ("Findings → Custom notifications"):
//
//   client -> server:
//     PIDE/caret_update         { uri, line, character, focus }
//     PIDE/sledgehammer_request { provers, isar, try0 }
//     PIDE/sledgehammer_cancel  (no params)
//
//   server -> client:
//     PIDE/sledgehammer_output  { content: <Isabelle XML markup> }
//     PIDE/sledgehammer_status  { message: <status string> }
//
// The session subscribes to the two server notifications for its
// lifetime, sends the request pair, accumulates the parsed output, and
// surfaces a typed `SessionUpdate` to the caller-provided handler on
// every state change. It owns no vscode types — the production
// `IsabelleLanguageClient` plus a `vscode.OutputChannel` satisfy the
// host interfaces structurally so tests can pass in-memory stubs.
//
// Important caveat from the research note: none of the
// `PIDE/sledgehammer_*` notifications carry a correlation id. There is
// no way to associate a specific `_output` notification with a specific
// prior `_request`. The upstream `Query_Operation` is single-slot for
// the same reason. The session enforces this single-slot contract on
// the client side by being a one-shot object: one `LspSledgehammerSession`
// instance corresponds to one upstream Query_Operation slot. Concurrent
// runs must be serialized by the caller (typically by disabling the Run
// action while a session is in flight or by disposing the previous
// session before constructing a new one).

import {
  PideOutputNode,
  collectSendbackTexts,
  parsePideSledgehammerOutput
} from "./pideSledgehammerOutput";
import {
  SledgehammerSettings,
  buildPideSledgehammerRequestParams
} from "./sledgehammerSettings";

export const PIDE_CARET_UPDATE_METHOD = "PIDE/caret_update";
export const PIDE_SLEDGEHAMMER_REQUEST_METHOD = "PIDE/sledgehammer_request";
export const PIDE_SLEDGEHAMMER_CANCEL_METHOD = "PIDE/sledgehammer_cancel";
export const PIDE_SLEDGEHAMMER_STATUS_METHOD = "PIDE/sledgehammer_status";
export const PIDE_SLEDGEHAMMER_OUTPUT_METHOD = "PIDE/sledgehammer_output";

/** The verbatim upstream status string that signals "this run is done". */
export const PIDE_FINISHED_STATUS_MESSAGE = "Finished";

/** Minimal logger contract — same shape as vscode.OutputChannel.appendLine. */
export interface SessionLogger {
  appendLine(message: string): void;
}

/** Minimal disposable contract — same shape as vscode.Disposable. */
export interface SessionDisposable {
  dispose(): void;
}

/** Minimal language-client subset this session needs. The production
 * `IsabelleLanguageClient` satisfies it structurally — its
 * sendNotification + onNotification shapes from PR #31 are exactly
 * what this interface declares.
 */
export interface SessionClient {
  sendNotification(method: string, params?: unknown): void;
  onNotification(
    method: string,
    handler: (params: unknown) => void
  ): SessionDisposable;
}

/** Position used in the precondition PIDE/caret_update notification. */
export interface SessionPosition {
  readonly line: number;
  readonly character: number;
}

/** Caller-supplied inputs for a single run. */
export interface SessionInputs {
  readonly uri: string;
  readonly position: SessionPosition;
  /** Defaults to true; matches upstream Isabelle 2025-2 default. */
  readonly focus?: boolean;
  readonly settings: SledgehammerSettings;
  /**
   * Fallback prover list when `settings.provers` is empty — typically
   * supplied by `PideSledgehammerProversCache.getProvers()`.
   */
  readonly fallbackProvers: string;
}

/**
 * Logical session lifecycle. `dispatching` covers the synchronous
 * window between construction and the first status notification
 * (during which the two outgoing notifications are sent). `running`
 * means the server has acknowledged with at least one non-finished
 * status. `finished`, `cancelled`, and `errored` are terminal.
 */
export type SessionStatus =
  | "dispatching"
  | "running"
  | "finished"
  | "cancelled"
  | "errored";

/** Snapshot fired to the consumer-supplied handler on every transition. */
export interface SessionUpdate {
  readonly status: SessionStatus;
  /** Last `PIDE/sledgehammer_status.message` observed, or undefined. */
  readonly statusMessage?: string;
  /** Parsed segments accumulated from the latest output snapshot. */
  readonly outputNodes: readonly PideOutputNode[];
  /** Trimmed sendback proof strings in document order. */
  readonly sendbacks: readonly string[];
}

export type SessionUpdateHandler = (update: SessionUpdate) => void;

const TERMINAL_STATES: ReadonlySet<SessionStatus> = new Set([
  "finished",
  "cancelled",
  "errored"
]);

/**
 * Single-slot Sledgehammer run over LSP. See module-level comment for
 * the message dance and the upstream single-slot contract.
 */
export class LspSledgehammerSession implements SessionDisposable {
  private statusSubscription: SessionDisposable | undefined;
  private outputSubscription: SessionDisposable | undefined;
  private accumulatedOutputNodes: readonly PideOutputNode[] = [];
  private currentStatus: SessionStatus = "dispatching";
  private currentStatusMessage: string | undefined;
  private cancelRequested = false;
  private disposed = false;

  public constructor(
    private readonly client: SessionClient,
    private readonly logger: SessionLogger,
    private readonly inputs: SessionInputs,
    private readonly onUpdate: SessionUpdateHandler
  ) {
    // Subscribe BEFORE dispatching so we don't miss an immediate
    // server reply. The notification stream is serial so there's no
    // race with the dispatch itself, but defence-in-depth.
    this.statusSubscription = client.onNotification(
      PIDE_SLEDGEHAMMER_STATUS_METHOD,
      (params) => this.handleStatus(params)
    );
    this.outputSubscription = client.onNotification(
      PIDE_SLEDGEHAMMER_OUTPUT_METHOD,
      (params) => this.handleOutput(params)
    );

    this.dispatchRequest();
  }

  /** Best-effort cancellation. The terminal state is reached when the
   * server next reports `status: "Finished"` (or immediately if the
   * session is already terminal). */
  public cancel(): void {
    if (this.disposed) {
      return;
    }
    if (TERMINAL_STATES.has(this.currentStatus)) {
      return;
    }
    this.cancelRequested = true;
    try {
      this.client.sendNotification(PIDE_SLEDGEHAMMER_CANCEL_METHOD);
    } catch (error) {
      this.logger.appendLine(
        `Sledgehammer LSP cancel failed: ${errorMessage(error)}`
      );
    }
    // Surface the cancel-requested state to the consumer immediately
    // even if the server hasn't replied yet, so the panel can grey out
    // its Cancel button without waiting for the next status notification.
    this.emit();
  }

  /** Returns the current session status without forcing a re-emit. */
  public getStatus(): SessionStatus {
    return this.currentStatus;
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.statusSubscription?.dispose();
    this.statusSubscription = undefined;
    this.outputSubscription?.dispose();
    this.outputSubscription = undefined;
  }

  private dispatchRequest(): void {
    try {
      this.client.sendNotification(PIDE_CARET_UPDATE_METHOD, {
        uri: this.inputs.uri,
        line: this.inputs.position.line,
        character: this.inputs.position.character,
        focus: this.inputs.focus ?? true
      });

      const requestParams = buildPideSledgehammerRequestParams(
        this.inputs.settings,
        this.inputs.fallbackProvers
      );
      this.client.sendNotification(PIDE_SLEDGEHAMMER_REQUEST_METHOD, requestParams);

      // The state stays `dispatching` until the server replies with at
      // least one status, at which point handleStatus advances it to
      // `running` (or directly to a terminal state if the first status
      // message is `Finished`).
      this.emit();
    } catch (error) {
      this.currentStatus = "errored";
      this.currentStatusMessage = errorMessage(error);
      this.logger.appendLine(
        `Sledgehammer LSP dispatch failed: ${errorMessage(error)}`
      );
      this.emit();
    }
  }

  private handleStatus(params: unknown): void {
    if (this.disposed) {
      return;
    }
    if (!isStatusPayload(params)) {
      this.logger.appendLine(
        `Sledgehammer LSP session: ignored malformed ${PIDE_SLEDGEHAMMER_STATUS_METHOD} payload`
      );
      return;
    }

    this.currentStatusMessage = params.message;
    if (params.message === PIDE_FINISHED_STATUS_MESSAGE) {
      this.currentStatus = this.cancelRequested ? "cancelled" : "finished";
    } else if (!TERMINAL_STATES.has(this.currentStatus)) {
      this.currentStatus = "running";
    }
    this.emit();
  }

  private handleOutput(params: unknown): void {
    if (this.disposed) {
      return;
    }
    if (!isOutputPayload(params)) {
      this.logger.appendLine(
        `Sledgehammer LSP session: ignored malformed ${PIDE_SLEDGEHAMMER_OUTPUT_METHOD} payload`
      );
      return;
    }
    // Upstream emits each PIDE/sledgehammer_output as the latest
    // cumulative snapshot of the prover output (driven by
    // Isabelle's Query_Operation consume_output). Each notification
    // therefore replaces, not appends to, the prior content.
    this.accumulatedOutputNodes = parsePideSledgehammerOutput(params.content);
    this.emit();
  }

  private emit(): void {
    try {
      this.onUpdate({
        status: this.currentStatus,
        statusMessage: this.currentStatusMessage,
        outputNodes: this.accumulatedOutputNodes,
        sendbacks: collectSendbackTexts(this.accumulatedOutputNodes)
      });
    } catch (error) {
      this.logger.appendLine(
        `Sledgehammer LSP session: onUpdate handler threw: ${errorMessage(error)}`
      );
    }
  }
}

function isStatusPayload(value: unknown): value is { message: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "message" in value &&
    typeof (value as { message: unknown }).message === "string"
  );
}

function isOutputPayload(value: unknown): value is { content: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "content" in value &&
    typeof (value as { content: unknown }).content === "string"
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
