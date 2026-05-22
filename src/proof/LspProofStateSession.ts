// LSP-mode proof state session built on the upstream PIDE state-panel
// surface. See docs/proof_state_and_minimization_lsp_research.md for the
// verbatim message shapes and lifecycle. In short:
//
//   client -> server: PIDE/state_init                  (request)
//   server -> client:                                  -> { state_id }
//
//   server -> client: PIDE/state_output                (notification)
//                     { id, content, auto_update, decorations? }
//
//   client -> server: PIDE/state_update    { id }
//                     PIDE/state_locate    { id }
//                     PIDE/state_auto_update { id, enabled }
//                     PIDE/state_set_margin  { id, margin }
//                     PIDE/state_exit      { id }      (notifications)
//
// `content` is the same Isabelle XML markup envelope
// `PIDE/sledgehammer_output.content` uses, so the parser in
// `src/sledgehammer/pideSledgehammerOutput.ts` (PR #32) is reused
// verbatim and the rendered nodes share styling.
//
// The session is a one-shot lifecycle owner — one instance corresponds
// to one upstream State_Panel instance on the server. The consumer
// (`ProofStatePanel`) is responsible for serialising init/exit cycles
// and for disposing before re-initialising.

import {
  PideOutputNode,
  parsePideSledgehammerOutput
} from "../sledgehammer/pideSledgehammerOutput";

export const PIDE_STATE_INIT_METHOD = "PIDE/state_init";
export const PIDE_STATE_EXIT_METHOD = "PIDE/state_exit";
export const PIDE_STATE_LOCATE_METHOD = "PIDE/state_locate";
export const PIDE_STATE_UPDATE_METHOD = "PIDE/state_update";
export const PIDE_STATE_AUTO_UPDATE_METHOD = "PIDE/state_auto_update";
export const PIDE_STATE_SET_MARGIN_METHOD = "PIDE/state_set_margin";
export const PIDE_STATE_OUTPUT_METHOD = "PIDE/state_output";

export interface ProofStateDisposable {
  dispose(): void;
}

export interface ProofStateLogger {
  appendLine(message: string): void;
}

/**
 * Minimal language-client subset the session uses. The production
 * `IsabelleLanguageClient` satisfies this structurally (sendRequest
 * landed alongside this PR; sendNotification + onNotification are
 * from PR #31).
 */
export interface ProofStateLspClient {
  sendRequest<T>(method: string, params?: unknown): Promise<T>;
  sendNotification(method: string, params?: unknown): void;
  onNotification(
    method: string,
    handler: (params: unknown) => void
  ): ProofStateDisposable;
}

export type ProofStateSessionStatus =
  | "initializing"
  | "active"
  | "stopping"
  | "stopped"
  | "errored";

export interface ProofStateUpdate {
  readonly status: ProofStateSessionStatus;
  /** Latest cumulative parsed Isabelle XML markup; empty until first emission. */
  readonly outputNodes: readonly PideOutputNode[];
  /** Most recent value of `auto_update` from the server, defaults to true. */
  readonly autoUpdate: boolean;
  /** Wall-clock timestamp for the last accepted PIDE/state_output payload. */
  readonly lastOutputReceivedAtMs?: number;
  /** Last error message if `status === 'errored'`, undefined otherwise. */
  readonly errorMessage?: string;
}

export type ProofStateUpdateHandler = (update: ProofStateUpdate) => void;

/**
 * One-shot session owning a single upstream State_Panel instance.
 *
 * Lifecycle:
 *   - Constructor sends `PIDE/state_init`, captures the returned
 *     `state_id`, subscribes to `PIDE/state_output` filtered by that
 *     id, and emits an initial `initializing` update synchronously.
 *   - When the init reply arrives, the session transitions to
 *     `active` and the subscription begins delivering parsed output.
 *   - `requestUpdate()` sends `PIDE/state_update` to force a refresh.
 *   - `setAutoUpdate(enabled)` sends `PIDE/state_auto_update` and
 *     reflects the new value into the next emitted update.
 *   - `dispose()` sends `PIDE/state_exit`, releases the subscription,
 *     and emits a terminal `stopped` update. Idempotent.
 *
 * The session does NOT auto-restart on language-client restarts.
 * Callers re-create the session in response to language-client
 * `running` transitions.
 */
export class LspProofStateSession implements ProofStateDisposable {
  private currentStatus: ProofStateSessionStatus = "initializing";
  private accumulatedOutputNodes: readonly PideOutputNode[] = [];
  private currentAutoUpdate = true;
  private errorMessage: string | undefined;
  private lastOutputReceivedAtMs: number | undefined;
  private outputSubscription: ProofStateDisposable | undefined;
  private stateId: number | undefined;
  private disposed = false;

  public constructor(
    private readonly client: ProofStateLspClient,
    private readonly logger: ProofStateLogger,
    private readonly onUpdate: ProofStateUpdateHandler,
    private readonly now: () => number = Date.now
  ) {
    // Subscribe early; the server can start pushing output as soon as
    // it processes the init request, and the underlying registry
    // (PR #31) tolerates a subscription that briefly accepts events
    // before the state_id is known — we filter by id on each delivery.
    this.outputSubscription = client.onNotification(
      PIDE_STATE_OUTPUT_METHOD,
      (params) => this.handleOutput(params)
    );
    this.emit();
    void this.initialise();
  }

  public getStatus(): ProofStateSessionStatus {
    return this.currentStatus;
  }

  public getStateId(): number | undefined {
    return this.stateId;
  }

  public getAutoUpdate(): boolean {
    return this.currentAutoUpdate;
  }

  /** Force the server to recompute and re-emit the state for the active caret. */
  public requestUpdate(): void {
    if (!this.canSend()) return;
    this.sendStateNotification(PIDE_STATE_UPDATE_METHOD);
  }

  /** Re-anchor the state to the current caret position. */
  public requestLocate(): void {
    if (!this.canSend()) return;
    this.sendStateNotification(PIDE_STATE_LOCATE_METHOD);
  }

  /**
   * Toggle whether `Session.Commands_Changed` / `Session.Caret_Focus`
   * server-side events drive the panel (`true` is upstream default).
   */
  public setAutoUpdate(enabled: boolean): void {
    if (!this.canSend()) return;
    try {
      this.client.sendNotification(PIDE_STATE_AUTO_UPDATE_METHOD, {
        id: this.stateId,
        enabled
      });
      this.currentAutoUpdate = enabled;
      this.emit();
    } catch (error) {
      this.logger.appendLine(
        `Proof state LSP: setAutoUpdate failed: ${errorMessage(error)}`
      );
    }
  }

  /** Pretty-printer margin hint. */
  public setMargin(margin: number): void {
    if (!this.canSend()) return;
    if (!Number.isFinite(margin) || margin <= 0) {
      return;
    }
    try {
      this.client.sendNotification(PIDE_STATE_SET_MARGIN_METHOD, {
        id: this.stateId,
        margin
      });
    } catch (error) {
      this.logger.appendLine(
        `Proof state LSP: setMargin failed: ${errorMessage(error)}`
      );
    }
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // Best-effort exit notification; ignore failures — the server
    // garbage-collects on its side and the panel may simply have
    // lost its connection.
    if (this.stateId !== undefined) {
      try {
        this.client.sendNotification(PIDE_STATE_EXIT_METHOD, {
          id: this.stateId
        });
      } catch (error) {
        this.logger.appendLine(
          `Proof state LSP: exit notification failed: ${errorMessage(error)}`
        );
      }
    }
    this.outputSubscription?.dispose();
    this.outputSubscription = undefined;
    if (this.currentStatus !== "errored") {
      this.currentStatus = "stopped";
    }
    this.emit();
  }

  private async initialise(): Promise<void> {
    try {
      const reply = await this.client.sendRequest<unknown>(PIDE_STATE_INIT_METHOD);
      if (this.disposed) {
        return;
      }
      const id = extractStateId(reply);
      if (id === undefined) {
        throw new Error(
          `Malformed ${PIDE_STATE_INIT_METHOD} reply: ${stringifyForLog(reply)}`
        );
      }
      this.stateId = id;
      this.currentStatus = "active";
      this.emit();
    } catch (error) {
      if (this.disposed) {
        return;
      }
      const message = errorMessage(error);
      this.currentStatus = "errored";
      this.errorMessage = message;
      this.logger.appendLine(
        `Proof state LSP: ${PIDE_STATE_INIT_METHOD} failed: ${message}`
      );
      this.emit();
    }
  }

  private handleOutput(params: unknown): void {
    if (this.disposed) return;
    if (!isStateOutputPayload(params)) {
      this.logger.appendLine(
        `Proof state LSP: ignored malformed ${PIDE_STATE_OUTPUT_METHOD} payload`
      );
      return;
    }
    if (this.stateId !== undefined && params.id !== this.stateId) {
      // Notification for a different State_Panel instance; ignore.
      return;
    }
    // Same snapshot-replacement semantics as PIDE/sledgehammer_output.
    this.accumulatedOutputNodes = parsePideSledgehammerOutput(params.content);
    this.currentAutoUpdate = params.auto_update;
    this.lastOutputReceivedAtMs = this.now();
    this.emit();
  }

  private canSend(): boolean {
    return !this.disposed && this.stateId !== undefined && this.currentStatus === "active";
  }

  private sendStateNotification(method: string): void {
    try {
      this.client.sendNotification(method, { id: this.stateId });
    } catch (error) {
      this.logger.appendLine(
        `Proof state LSP: ${method} failed: ${errorMessage(error)}`
      );
    }
  }

  private emit(): void {
    try {
      this.onUpdate({
        status: this.currentStatus,
        outputNodes: this.accumulatedOutputNodes,
        autoUpdate: this.currentAutoUpdate,
        lastOutputReceivedAtMs: this.lastOutputReceivedAtMs,
        errorMessage: this.errorMessage
      });
    } catch (error) {
      this.logger.appendLine(
        `Proof state LSP: onUpdate handler threw: ${errorMessage(error)}`
      );
    }
  }
}

interface StateOutputPayload {
  readonly id: number;
  readonly content: string;
  readonly auto_update: boolean;
}

function isStateOutputPayload(value: unknown): value is StateOutputPayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "number" &&
    typeof candidate.content === "string" &&
    typeof candidate.auto_update === "boolean"
  );
}

function extractStateId(reply: unknown): number | undefined {
  if (typeof reply !== "object" || reply === null) return undefined;
  const candidate = reply as Record<string, unknown>;
  const raw = candidate.state_id;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  return undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stringifyForLog(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
