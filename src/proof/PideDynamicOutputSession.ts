// Subscriber for the upstream `PIDE/dynamic_output` LSP notification.
//
// Background (docs/proof_state_and_minimization_lsp_research.md): the
// upstream `isabelle vscode_server` emits a single-instance,
// caret-driven message stream alongside the per-instance State Panel.
// The notification shape (`lsp.scala:599-604`):
//
//   PIDE/dynamic_output { content: string, decorations?: ... }
//
// Unlike `PIDE/state_output` it carries **no id** — there is one
// upstream `Dynamic_Output` instance per server. The content is the
// same `XML.string_of_body(Pretty.unbreakable(...))` envelope, so the
// PIDE-XML parser shipped in PR #32 is reused.
//
// The session is intentionally light: it subscribes once, parses each
// snapshot via `parsePideSledgehammerOutput`, and pushes a typed
// update to the consumer. No init/exit handshake on the wire; the
// server starts emitting from `Language_Server.init`. Dispose just
// releases the subscription.
//
// `vscode`-free; injectable client + logger contracts.

import {
  PideOutputNode,
  parsePideSledgehammerOutput
} from "../sledgehammer/pideSledgehammerOutput";

export const PIDE_DYNAMIC_OUTPUT_METHOD = "PIDE/dynamic_output";

export interface DynamicOutputDisposable {
  dispose(): void;
}

export interface DynamicOutputLogger {
  appendLine(message: string): void;
}

/**
 * Minimal language-client subset the subscriber uses. The production
 * `IsabelleLanguageClient.onNotification` (PR #31) satisfies this
 * shape structurally — no adapter required.
 */
export interface DynamicOutputClient {
  onNotification(
    method: string,
    handler: (params: unknown) => void
  ): DynamicOutputDisposable;
}

export interface DynamicOutputUpdate {
  /** Latest cumulative parsed Isabelle XML markup; empty until the first emission. */
  readonly outputNodes: readonly PideOutputNode[];
  /** ISO timestamp of the latest received notification, or undefined. */
  readonly lastReceivedAt?: string;
}

export type DynamicOutputUpdateHandler = (update: DynamicOutputUpdate) => void;

/**
 * Single-subscription owner for the `PIDE/dynamic_output` stream.
 * Construct one per consumer (typically the proof state panel);
 * dispose on tear-down.
 */
export class PideDynamicOutputSession implements DynamicOutputDisposable {
  private accumulatedOutputNodes: readonly PideOutputNode[] = [];
  private lastReceivedAt: string | undefined;
  private subscription: DynamicOutputDisposable | undefined;
  private disposed = false;

  public constructor(
    client: DynamicOutputClient,
    private readonly logger: DynamicOutputLogger,
    private readonly onUpdate: DynamicOutputUpdateHandler,
    private readonly clock: () => Date = () => new Date()
  ) {
    this.subscription = client.onNotification(
      PIDE_DYNAMIC_OUTPUT_METHOD,
      (params) => this.handleNotification(params)
    );
    // Emit the initial (empty) snapshot synchronously so the consumer
    // can render a "waiting" placeholder without a special case.
    this.emit();
  }

  /** Latest parsed snapshot; empty array until the first valid emission. */
  public getOutputNodes(): readonly PideOutputNode[] {
    return this.accumulatedOutputNodes;
  }

  public getLastReceivedAt(): string | undefined {
    return this.lastReceivedAt;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.subscription?.dispose();
    this.subscription = undefined;
  }

  private handleNotification(params: unknown): void {
    if (this.disposed) return;
    if (!isDynamicOutputPayload(params)) {
      this.logger.appendLine(
        `Dynamic output: ignored malformed ${PIDE_DYNAMIC_OUTPUT_METHOD} payload`
      );
      return;
    }
    // Snapshot-replacement semantics, matching state_output and
    // sledgehammer_output: each notification carries the latest
    // cumulative content for the current caret focus.
    this.accumulatedOutputNodes = parsePideSledgehammerOutput(params.content);
    this.lastReceivedAt = this.clock().toISOString();
    this.emit();
  }

  private emit(): void {
    try {
      this.onUpdate({
        outputNodes: this.accumulatedOutputNodes,
        lastReceivedAt: this.lastReceivedAt
      });
    } catch (error) {
      this.logger.appendLine(
        `Dynamic output: onUpdate handler threw: ${errorMessage(error)}`
      );
    }
  }
}

interface DynamicOutputPayload {
  readonly content: string;
}

function isDynamicOutputPayload(value: unknown): value is DynamicOutputPayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.content === "string";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
