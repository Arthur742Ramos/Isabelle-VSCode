// Subscriber for the upstream `PIDE/preview_response` LSP notification.
//
// Background (`mirror-isabelle@ce22e9ea` `src/Tools/VSCode/src/lsp.scala:672-692`
// + `src/Tools/VSCode/extension/src/preview_panel.ts` for the upstream client
// reference):
//
//   client -> server: PIDE/preview_request    { uri, column: int }
//   server -> client: PIDE/preview_response   { uri, column: int, label, content }
//
// `content` is an HTML rendering of the requested Isabelle theory at
// reasonable fidelity (header, command spans, formatted markup) suitable
// for an in-editor webview. The `column` field round-trips the
// `ViewColumn` the client originally sent so the consumer can place the
// preview panel in the right editor group.
//
// This module is intentionally `vscode`-free: it takes an injectable
// client + logger contract that the production `IsabelleLanguageClient`
// already satisfies structurally. Tests pass small in-memory stubs.

import {
  IsabelleLanguageServerState,
  IsabelleLanguageServerStatus
} from "../lsp/lspTypes";

export const PIDE_PREVIEW_REQUEST_METHOD = "PIDE/preview_request";
export const PIDE_PREVIEW_RESPONSE_METHOD = "PIDE/preview_response";

export interface PidePreviewDisposable {
  dispose(): void;
}

export interface PidePreviewLogger {
  appendLine(message: string): void;
}

export interface PidePreviewClient {
  sendNotification(method: string, params?: unknown): void;
  onNotification(
    method: string,
    handler: (params: unknown) => void
  ): PidePreviewDisposable;
  onStatusChange(
    handler: (status: IsabelleLanguageServerStatus) => void
  ): PidePreviewDisposable;
  getStatus(): IsabelleLanguageServerStatus;
}

export interface PidePreviewSnapshot {
  /** Source theory URI the server rendered. */
  readonly uri: string;
  /** ViewColumn the client originally requested; round-tripped by the server. */
  readonly column: number;
  /** Human-readable title (typically the theory leaf name). */
  readonly label: string;
  /** HTML body. */
  readonly content: string;
  /** ISO timestamp of when this snapshot arrived. */
  readonly receivedAt: string;
}

export type PidePreviewListener = (snapshot: PidePreviewSnapshot) => void;

/**
 * Single-instance subscriber for `PIDE/preview_response`. Holds the
 * latest snapshot (so a late consumer can render without waiting for
 * the next response) and lets multiple consumers subscribe via
 * {@link onSnapshot}. The subscriber does NOT own the request dispatch
 * — callers send `PIDE/preview_request` themselves so the request
 * surface (active editor, split or not, etc.) stays at the call site.
 */
export class PidePreviewSubscriber implements PidePreviewDisposable {
  private latest: PidePreviewSnapshot | undefined;
  private lastObservedState: IsabelleLanguageServerState | undefined;
  private disposed = false;
  private readonly listeners = new Set<PidePreviewListener>();
  private readonly responseSubscription: PidePreviewDisposable;
  private readonly statusSubscription: PidePreviewDisposable;

  public constructor(
    private readonly client: PidePreviewClient,
    private readonly logger: PidePreviewLogger,
    private readonly clock: () => Date = () => new Date()
  ) {
    this.responseSubscription = client.onNotification(
      PIDE_PREVIEW_RESPONSE_METHOD,
      (params) => this.handleResponse(params)
    );
    this.statusSubscription = client.onStatusChange((status) =>
      this.handleStatusChange(status)
    );
    this.lastObservedState = client.getStatus().state;
  }

  public getLatest(): PidePreviewSnapshot | undefined {
    return this.latest;
  }

  /**
   * Subscribe to fresh snapshot notifications. The listener is NOT
   * called retroactively with the cached latest snapshot — callers
   * that want both behaviors can consume {@link getLatest} themselves.
   */
  public onSnapshot(listener: PidePreviewListener): PidePreviewDisposable {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      }
    };
  }

  /**
   * Send a `PIDE/preview_request` for the given URI + view column.
   * No-op when the LSP is not `running` (the request cannot be
   * answered). Returns true if the request was actually sent.
   */
  public requestPreview(uri: string, column: number): boolean {
    if (this.disposed) return false;
    if (this.lastObservedState !== "running") return false;
    try {
      this.client.sendNotification(PIDE_PREVIEW_REQUEST_METHOD, { uri, column });
      return true;
    } catch (error) {
      this.logger.appendLine(
        `PIDE preview: failed to send ${PIDE_PREVIEW_REQUEST_METHOD}: ${errorMessage(error)}`
      );
      return false;
    }
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.responseSubscription.dispose();
    this.statusSubscription.dispose();
    this.listeners.clear();
  }

  private handleStatusChange(status: IsabelleLanguageServerStatus): void {
    if (this.disposed) return;
    this.lastObservedState = status.state;
    if (
      status.state === "stopping" ||
      status.state === "failed" ||
      status.state === "disabled"
    ) {
      // Drop the cached snapshot so consumers that re-poll see an
      // empty state rather than a stale render from a no-longer-
      // running server.
      this.latest = undefined;
    }
  }

  private handleResponse(params: unknown): void {
    if (this.disposed) return;
    const parsed = parsePidePreviewResponse(params, this.clock());
    if (!parsed) {
      this.logger.appendLine(
        `PIDE preview: ignored malformed ${PIDE_PREVIEW_RESPONSE_METHOD} payload`
      );
      return;
    }
    this.latest = parsed;
    for (const listener of this.listeners) {
      try {
        listener(parsed);
      } catch (error) {
        this.logger.appendLine(
          `PIDE preview: snapshot listener threw: ${errorMessage(error)}`
        );
      }
    }
  }
}

/**
 * Parse a `PIDE/preview_response` payload into a typed snapshot.
 * Returns `undefined` if any required field is missing or wrong-typed.
 * Pure helper exposed for tests.
 */
export function parsePidePreviewResponse(
  value: unknown,
  receivedAt: Date
): PidePreviewSnapshot | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  const uri = candidate.uri;
  const column = candidate.column;
  const label = candidate.label;
  const content = candidate.content;
  if (typeof uri !== "string" || uri.length === 0) return undefined;
  if (typeof column !== "number" || !Number.isFinite(column) || !Number.isInteger(column)) {
    return undefined;
  }
  if (typeof label !== "string") return undefined;
  if (typeof content !== "string") return undefined;
  return {
    uri,
    column,
    label,
    content,
    receivedAt: receivedAt.toISOString()
  };
}

/**
 * Determine whether the snapshot's HTML body is one of the well-known
 * empty / placeholder shapes the server emits when the theory hasn't
 * yet been processed. Pure helper.
 */
export function isEmptyPreviewSnapshot(snapshot: PidePreviewSnapshot): boolean {
  // The server sometimes emits an empty <body /> when there's no
  // content yet. Strip whitespace and check for the empty body tag.
  const stripped = snapshot.content.replace(/<\!\-\-[\s\S]*?\-\->/g, "").trim();
  if (stripped.length === 0) return true;
  if (/^<body[^>]*\/\s*>$/i.test(stripped)) return true;
  if (/^<body[^>]*>\s*<\/body>$/i.test(stripped)) return true;
  return false;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
