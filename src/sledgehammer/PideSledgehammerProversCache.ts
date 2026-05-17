// Cache for the prover list reported by Isabelle's bundled
// `isabelle vscode_server` over the `PIDE/sledgehammer_provers_response`
// LSP notification.
//
// Background (see docs/sledgehammer_lsp_research.md):
//
//   - `PIDE/sledgehammer_provers_request` is a parameter-less LSP
//     notification the client sends to ask the server what provers it
//     knows about today.
//   - `PIDE/sledgehammer_provers_response` is the server's reply,
//     carrying a `{ provers: string }` payload — a single
//     space-separated list of prover names (live response on Isabelle
//     2025-2: `"cvc5 verit z3 e spass vampire zipperposition"`).
//   - Neither message is advertised in `initialize.capabilities`.
//   - Neither message carries a correlation id.
//
// This cache acts as the always-on subscriber that lets the rest of
// the extension consult the prover list synchronously, without each
// caller having to round-trip the LSP. It activates on the language
// client's `running` transition, drops the cache when the client stops
// / fails / disables (so callers never surface stale data), and
// persists its response handler across language-client restart cycles
// via the notification registry shipped in PR #31.
//
// The module is intentionally `vscode`-free: it takes an injectable
// `ProversCacheClient` interface that the production
// `IsabelleLanguageClient` already satisfies structurally and a
// `ProversCacheLogger` that the production output channel matches.
// Tests pass small in-memory stubs.

import {
  IsabelleLanguageServerState,
  IsabelleLanguageServerStatus
} from "../lsp/lspTypes";

export const PIDE_PROVERS_REQUEST_METHOD = "PIDE/sledgehammer_provers_request";
export const PIDE_PROVERS_RESPONSE_METHOD = "PIDE/sledgehammer_provers_response";

/** Minimal disposable contract — identical shape to vscode.Disposable. */
export interface ProversCacheDisposable {
  dispose(): void;
}

/** Minimal logger contract — identical shape to vscode.OutputChannel.appendLine. */
export interface ProversCacheLogger {
  appendLine(message: string): void;
}

/**
 * Minimal language-client surface this cache needs. The production
 * `IsabelleLanguageClient` satisfies this structurally — the cache
 * never reaches for any other method, so the host can be swapped for
 * a stub in tests without mocking the vscode namespace.
 */
export interface ProversCacheClient {
  sendNotification(method: string, params?: unknown): void;
  onNotification(
    method: string,
    handler: (params: unknown) => void
  ): ProversCacheDisposable;
  onStatusChange(
    handler: (status: IsabelleLanguageServerStatus) => void
  ): ProversCacheDisposable;
  getStatus(): IsabelleLanguageServerStatus;
}

interface ProversResponse {
  readonly provers: string;
}

/**
 * Subscribes to `PIDE/sledgehammer_provers_response` and dispatches
 * `PIDE/sledgehammer_provers_request` whenever the language client
 * transitions into the `running` state. Exposes the most recent
 * response synchronously via {@link getProvers}.
 *
 * Threading: every method runs on the extension host thread (V8 event
 * loop); there is no concurrency control because the LSP notification
 * stream is itself serial.
 */
export class PideSledgehammerProversCache implements ProversCacheDisposable {
  private cachedProvers = "";
  private lastUpdatedAt: string | undefined;
  private lastObservedState: IsabelleLanguageServerState | undefined;
  private disposed = false;

  private readonly responseSubscription: ProversCacheDisposable;
  private readonly statusSubscription: ProversCacheDisposable;

  public constructor(
    private readonly client: ProversCacheClient,
    private readonly logger: ProversCacheLogger,
    private readonly clock: () => Date = () => new Date()
  ) {
    // Persistent handler — the underlying registry replays it across
    // language-client restarts.
    this.responseSubscription = client.onNotification(
      PIDE_PROVERS_RESPONSE_METHOD,
      (params) => this.handleResponse(params)
    );

    this.statusSubscription = client.onStatusChange((status) =>
      this.handleStatusChange(status)
    );

    const initial = client.getStatus();
    this.lastObservedState = initial.state;
    if (initial.state === "running") {
      // Late wiring case: the LSP was already running at construction time,
      // so the `onStatusChange` listener won't fire a transition. Kick the
      // request manually so the cache populates promptly.
      this.dispatchRequest();
    }
  }

  /** The most recent prover list, or `""` if none is cached. */
  public getProvers(): string {
    return this.cachedProvers;
  }

  /** ISO timestamp of the most recent successful response, or undefined. */
  public getLastUpdatedAt(): string | undefined {
    return this.lastUpdatedAt;
  }

  /** True if a non-empty prover list has been received and is still valid. */
  public hasCachedProvers(): boolean {
    return this.cachedProvers.length > 0;
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.responseSubscription.dispose();
    this.statusSubscription.dispose();
  }

  private handleStatusChange(status: IsabelleLanguageServerStatus): void {
    if (this.disposed) {
      return;
    }
    const previous = this.lastObservedState;
    this.lastObservedState = status.state;

    if (status.state === "running" && previous !== "running") {
      this.dispatchRequest();
      return;
    }

    if (
      status.state === "stopping" ||
      status.state === "failed" ||
      status.state === "disabled"
    ) {
      // Drop the cache so callers don't surface stale provers from a
      // no-longer-running server. A fresh `running` transition will
      // re-populate via dispatchRequest above.
      if (this.cachedProvers !== "" || this.lastUpdatedAt !== undefined) {
        this.cachedProvers = "";
        this.lastUpdatedAt = undefined;
      }
    }
  }

  private dispatchRequest(): void {
    if (this.disposed) {
      return;
    }
    try {
      this.client.sendNotification(PIDE_PROVERS_REQUEST_METHOD);
    } catch (error) {
      this.logger.appendLine(
        `Sledgehammer provers cache: failed to send ${PIDE_PROVERS_REQUEST_METHOD}: ${errorMessage(error)}`
      );
    }
  }

  private handleResponse(params: unknown): void {
    if (this.disposed) {
      return;
    }
    if (!isProversResponse(params)) {
      this.logger.appendLine(
        `Sledgehammer provers cache: ignored malformed ${PIDE_PROVERS_RESPONSE_METHOD} payload`
      );
      return;
    }
    const trimmed = params.provers.trim().split(/\s+/).filter((token) => token.length > 0).join(" ");
    this.cachedProvers = trimmed;
    this.lastUpdatedAt = this.clock().toISOString();
    if (trimmed.length === 0) {
      this.logger.appendLine(
        `Sledgehammer provers cache: server reported an empty prover list`
      );
    } else {
      const count = trimmed.split(/\s+/).length;
      this.logger.appendLine(
        `Sledgehammer provers cache: received ${count} prover(s) from ${PIDE_PROVERS_RESPONSE_METHOD}`
      );
    }
  }
}

function isProversResponse(value: unknown): value is ProversResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "provers" in value &&
    typeof (value as { provers: unknown }).provers === "string"
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
