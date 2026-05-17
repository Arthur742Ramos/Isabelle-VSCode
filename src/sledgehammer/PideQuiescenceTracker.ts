// Per-theory quiescence tracker for LSP-mode Sledgehammer dispatch.
//
// Background (docs/sledgehammer_lsp_research.md, Implications #7):
// the live probe against Isabelle 2025-2 reproducibly returned
// `<error_message>Unknown proof context</error_message>` when a
// `PIDE/sledgehammer_request` fired before the prover had finished
// evaluating the active theory. The recommended mitigation is a
// quiescence gate: wait for a short window of inactivity after the
// theory was last edited before dispatching the request, so the
// language server has time to reprocess.
//
// This module owns the timing logic only:
//   - it records the wall-clock timestamp of the most recent theory
//     edit per URI (driven by VS Code's text-change events);
//   - it exposes `waitForQuiescence(uri, settingsDelayMs)` which
//     resolves either immediately (no recent edit, or delay disabled)
//     or after `max(0, settingsDelayMs - timeSinceLastEdit)` ms.
//
// The tracker is `vscode`-free and uses the same injectable Disposable
// + event contracts as the other sledgehammer/* helpers, so the
// production wiring passes the real `vscode.workspace` events and
// `vscode.workspace.onDidChangeTextDocument` without an adapter while
// tests pass in-memory stubs.

export interface QuiescenceDisposable {
  dispose(): void;
}

export interface TextDocumentLike {
  readonly uri: { toString(): string };
  readonly languageId: string;
  readonly fileName?: string;
}

export interface TextDocumentChangeEventLike {
  readonly document: TextDocumentLike;
}

/** Subset of `vscode.workspace` the tracker needs. */
export interface QuiescenceWorkspace {
  onDidChangeTextDocument: (
    listener: (event: TextDocumentChangeEventLike) => void
  ) => QuiescenceDisposable;
}

export interface QuiescenceTrackerOptions {
  /** Time source for tests. Defaults to `Date.now`. */
  readonly now?: () => number;
  /** Timer scheduler for tests. Defaults to `setTimeout`. */
  readonly scheduleTimeout?: (callback: () => void, ms: number) => unknown;
  /** Clear-timer scheduler for tests. Defaults to `clearTimeout`. */
  readonly cancelTimeout?: (handle: unknown) => void;
}

/**
 * Returns true for Isabelle theory documents. Mirrors the same
 * predicate used by `SledgehammerPanel.isTheoryDocument` so the
 * tracker does not record timestamps for unrelated documents.
 */
function isTheoryDocument(document: TextDocumentLike): boolean {
  return document.languageId === "isabelle" || (document.fileName?.endsWith(".thy") ?? false);
}

export class PideQuiescenceTracker implements QuiescenceDisposable {
  private readonly lastEditAtByUri = new Map<string, number>();
  private readonly subscription: QuiescenceDisposable;
  private readonly now: () => number;
  private readonly scheduleTimeout: (callback: () => void, ms: number) => unknown;
  private readonly cancelTimeout: (handle: unknown) => void;
  private disposed = false;

  public constructor(
    workspace: QuiescenceWorkspace,
    options: QuiescenceTrackerOptions = {}
  ) {
    this.now = options.now ?? (() => Date.now());
    this.scheduleTimeout =
      options.scheduleTimeout ?? ((cb, ms) => setTimeout(cb, ms));
    this.cancelTimeout =
      options.cancelTimeout ??
      ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    this.subscription = workspace.onDidChangeTextDocument((event) =>
      this.handleChange(event)
    );
  }

  /**
   * Record an edit for the given URI. Exposed for tests that want to
   * drive the tracker without going through the workspace event.
   */
  public recordEdit(uri: string, at?: number): void {
    if (this.disposed) return;
    this.lastEditAtByUri.set(uri, at ?? this.now());
  }

  /**
   * Timestamp of the most recent recorded edit for `uri`, or
   * `undefined` if none has been seen.
   */
  public getLastEditAt(uri: string): number | undefined {
    return this.lastEditAtByUri.get(uri);
  }

  /**
   * Return a promise that resolves once `uri` is considered quiescent
   * for the given `settingsDelayMs`. The promise resolves immediately
   * when no recent edit has been recorded or when `settingsDelayMs`
   * is `0`. Otherwise it resolves after at most `settingsDelayMs`
   * milliseconds.
   *
   * The promise NEVER rejects; callers can race or await it directly.
   */
  public waitForQuiescence(uri: string, settingsDelayMs: number): Promise<void> {
    if (this.disposed) {
      return Promise.resolve();
    }
    const requiredDelay = this.computeRequiredDelay(uri, settingsDelayMs);
    if (requiredDelay <= 0) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      const handle = this.scheduleTimeout(() => resolve(), requiredDelay);
      // Hint to the test scheduler that this timer can be unref-able
      // when running on Node — production unref is a no-op when the
      // injected scheduler is a real setTimeout.
      if (handle && typeof (handle as { unref?: () => void }).unref === "function") {
        (handle as { unref: () => void }).unref();
      }
    });
  }

  /**
   * Public helper used by both `waitForQuiescence` and the panel-side
   * status indicator: returns the remaining required delay (in ms) to
   * be quiescent for the given URI under the given settings. Returns
   * `0` when there is no wait.
   */
  public computeRequiredDelay(uri: string, settingsDelayMs: number): number {
    if (this.disposed) return 0;
    if (!Number.isFinite(settingsDelayMs) || settingsDelayMs <= 0) {
      return 0;
    }
    const lastEditAt = this.lastEditAtByUri.get(uri);
    if (lastEditAt === undefined) {
      return 0;
    }
    const elapsed = this.now() - lastEditAt;
    if (!Number.isFinite(elapsed) || elapsed >= settingsDelayMs) {
      return 0;
    }
    return Math.max(0, Math.round(settingsDelayMs - elapsed));
  }

  /** Drop the recorded edit timestamp for `uri`. Idempotent. */
  public forget(uri: string): void {
    this.lastEditAtByUri.delete(uri);
  }

  /** Drop every recorded edit timestamp. */
  public clear(): void {
    this.lastEditAtByUri.clear();
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.subscription.dispose();
    this.lastEditAtByUri.clear();
  }

  private handleChange(event: TextDocumentChangeEventLike): void {
    if (this.disposed) return;
    if (!isTheoryDocument(event.document)) return;
    this.lastEditAtByUri.set(event.document.uri.toString(), this.now());
  }
}
