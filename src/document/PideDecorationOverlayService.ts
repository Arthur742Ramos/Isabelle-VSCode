// Apply layer for the `PIDE/decoration` LSP notification.
//
// Pure parsing + style mapping lives in `pideDecorations.ts`. This
// module owns the vscode-side wiring: subscribing to the notification
// from `IsabelleLanguageClient`, lazily creating one
// `TextEditorDecorationType` per upstream `text_<color>` style,
// painting visible editors, and clearing everything when the language
// client leaves the `running` state.
//
// Lifecycle (mirrors `CommandSpanDecorationsService`):
//   - `start()` registers visibility listeners and the LSP-status
//     listener. If the LSP is already `running`, it subscribes and
//     requests an initial paint for every visible Isabelle editor.
//   - On `PIDE/decoration` arrival, replaces the cached entries for
//     the notification's URI and repaints all visible editors for it.
//   - On editor visibility changes, repaints with the latest cache
//     and (if the URI is newly visible) sends a
//     `PIDE/decoration_request` so the server re-emits.
//   - On LSP state change away from `running`, clears the cache and
//     drops all decorations.
//   - `dispose()` clears the cache, disposes per-type decoration
//     types, and tears down listeners.

import * as vscode from "vscode";
import { IsabelleLanguageServerStatus } from "../lsp/lspTypes";
import {
  PideDecorationContentForPaint,
  PideDecorationEntry,
  PideDecorationPayload,
  PideDecorationRange,
  PideDecorationStyle,
  PIDE_DECORATION_METHOD,
  PIDE_DECORATION_REQUEST_METHOD,
  groupDecorationEntriesByKnownType,
  parsePideDecorationPayload,
  planDecorationRequests,
  resolvePideDecorationStyle
} from "./pideDecorations";

export interface PideDecorationOverlayDisposable {
  dispose(): void;
}

/**
 * Minimal LSP-client subset the overlay service uses. The production
 * `IsabelleLanguageClient` satisfies this structurally — no adapter
 * required.
 */
export interface PideDecorationLspClient {
  getStatus(): IsabelleLanguageServerStatus;
  readonly onStatusChange: (
    listener: (status: IsabelleLanguageServerStatus) => void
  ) => PideDecorationOverlayDisposable;
  sendNotification(method: string, params?: unknown): void;
  onNotification(
    method: string,
    handler: (params: unknown) => void
  ): PideDecorationOverlayDisposable;
}

export interface PideDecorationOverlayLogger {
  appendLine(message: string): void;
}

interface DecorationTypeBucket {
  readonly style: PideDecorationStyle;
  readonly decorationType: vscode.TextEditorDecorationType;
}

export class PideDecorationOverlayService implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly decorationTypes = new Map<string, DecorationTypeBucket>();
  /** Latest parsed entries per URI string. */
  private readonly entriesByUri = new Map<string, readonly PideDecorationEntry[]>();
  private notificationSubscription: PideDecorationOverlayDisposable | undefined;
  private statusSubscription: PideDecorationOverlayDisposable | undefined;
  /** URIs we've already requested in the current LSP session. */
  private requested = new Set<string>();
  private started = false;
  private disposed = false;
  private lastLspState: IsabelleLanguageServerStatus["state"];

  public constructor(
    private readonly client: PideDecorationLspClient,
    private readonly logger: PideDecorationOverlayLogger
  ) {
    this.lastLspState = client.getStatus().state;
  }

  public start(): void {
    if (this.started || this.disposed) return;
    this.started = true;

    this.disposables.push(
      vscode.window.onDidChangeVisibleTextEditors(() => this.handleVisibilityChange())
    );

    // Status subscription handles transitions in and out of `running`.
    this.statusSubscription = this.client.onStatusChange((status) =>
      this.handleStatusChange(status)
    );

    if (this.lastLspState === "running") {
      this.subscribeAndPrime();
    }
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.notificationSubscription?.dispose();
    this.notificationSubscription = undefined;
    this.statusSubscription?.dispose();
    this.statusSubscription = undefined;

    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;

    this.clearAllPaintedDecorations();
    for (const bucket of this.decorationTypes.values()) {
      bucket.decorationType.dispose();
    }
    this.decorationTypes.clear();
    this.entriesByUri.clear();
    this.requested.clear();
  }

  /**
   * Visible for tests. Snapshot of the painted style keys for a URI.
   */
  public getCachedTypesForUri(uri: string): readonly string[] {
    const entries = this.entriesByUri.get(uri);
    return entries ? entries.map((e) => e.type) : [];
  }

  private handleStatusChange(status: IsabelleLanguageServerStatus): void {
    if (this.disposed) return;
    const previousState = this.lastLspState;
    this.lastLspState = status.state;
    if (previousState === status.state) return;
    if (status.state === "running") {
      this.subscribeAndPrime();
    } else {
      this.tearDownLspSession();
    }
  }

  private subscribeAndPrime(): void {
    if (this.disposed) return;
    if (!this.notificationSubscription) {
      this.notificationSubscription = this.client.onNotification(
        PIDE_DECORATION_METHOD,
        (params) => this.handleNotification(params)
      );
    }
    // Ask the server to (re-)emit decorations for every currently
    // visible Isabelle theory.
    const visibleUris = collectVisibleTheoryUris();
    const plan = planDecorationRequests(visibleUris, new Set(), "running");
    for (const uri of plan.toRequest) {
      this.sendDecorationRequest(uri);
    }
    this.requested = new Set(plan.nextRequested);
  }

  private tearDownLspSession(): void {
    if (this.disposed) return;
    this.notificationSubscription?.dispose();
    this.notificationSubscription = undefined;
    this.clearAllPaintedDecorations();
    this.entriesByUri.clear();
    this.requested.clear();
  }

  private handleVisibilityChange(): void {
    if (this.disposed) return;
    if (this.lastLspState !== "running") return;
    const visibleUris = collectVisibleTheoryUris();
    // Repaint every visible theory URI with its latest cache. Pass an
    // empty entries array when there is no cache so a re-shown editor
    // surface does not retain stale overlays from a prior pass that
    // the cache no longer covers.
    for (const editor of vscode.window.visibleTextEditors) {
      if (!isTheoryDocument(editor.document)) continue;
      const entries = this.entriesByUri.get(editor.document.uri.toString()) ?? [];
      this.paintEditor(editor, entries);
    }
    const plan = planDecorationRequests(visibleUris, this.requested, "running");
    for (const uri of plan.toRequest) {
      this.sendDecorationRequest(uri);
    }
    this.requested = new Set(plan.nextRequested);
    // Evict cache entries for URIs that are neither visible nor open
    // anywhere, so a long session opening many theories does not
    // accumulate stale per-URI entries indefinitely.
    this.evictUnreachableCache(visibleUris);
  }

  private evictUnreachableCache(visibleUris: readonly string[]): void {
    if (this.entriesByUri.size === 0) return;
    const reachable = new Set<string>(visibleUris);
    for (const doc of vscode.workspace.textDocuments) {
      // workspace.textDocuments enumerates all open documents (visible
      // or not). We keep the cache live for any open theory so that a
      // re-show after switching tabs paints with the same cache that
      // was used before the tab switch.
      if (doc.languageId === "isabelle" || doc.uri.fsPath.endsWith(".thy")) {
        reachable.add(doc.uri.toString());
      }
    }
    for (const cachedUri of Array.from(this.entriesByUri.keys())) {
      if (!reachable.has(cachedUri)) {
        this.entriesByUri.delete(cachedUri);
      }
    }
  }

  private handleNotification(params: unknown): void {
    if (this.disposed) return;
    if (this.lastLspState !== "running") {
      // Late notification after we left running state; ignore.
      return;
    }
    const parsed = parsePideDecorationPayload(params);
    if (!parsed) {
      this.logger.appendLine(
        `PIDE decoration: ignored malformed ${PIDE_DECORATION_METHOD} payload`
      );
      return;
    }
    this.entriesByUri.set(parsed.uri, parsed.entries);
    this.paintAllVisibleEditorsForUri(parsed);
  }

  private sendDecorationRequest(uri: string): void {
    try {
      this.client.sendNotification(PIDE_DECORATION_REQUEST_METHOD, { uri });
    } catch (error) {
      this.logger.appendLine(
        `PIDE decoration: ${PIDE_DECORATION_REQUEST_METHOD} for ${uri} failed: ${errorMessage(error)}`
      );
    }
  }

  private paintAllVisibleEditorsForUri(payload: PideDecorationPayload): void {
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.toString() === payload.uri) {
        this.paintEditor(editor, payload.entries);
      }
    }
  }

  private paintEditor(
    editor: vscode.TextEditor,
    entries: readonly PideDecorationEntry[]
  ): void {
    if (this.disposed) return;
    const groups = groupDecorationEntriesByKnownType(entries);
    // Ensure a bucket per known type encountered this pass.
    for (const type of groups.keys()) {
      const style = resolvePideDecorationStyle(type);
      if (style) this.ensureBucket(type, style);
    }
    // Apply painted groups.
    for (const [type, items] of groups.entries()) {
      const bucket = this.decorationTypes.get(type);
      if (!bucket) continue;
      editor.setDecorations(bucket.decorationType, items.map(toDecorationOption));
    }
    // Clear previously-painted types that have no entries this pass so
    // an old decoration does not linger after the server stops emitting
    // for that type.
    for (const [type, bucket] of this.decorationTypes.entries()) {
      if (!groups.has(type)) {
        editor.setDecorations(bucket.decorationType, []);
      }
    }
  }

  private clearAllPaintedDecorations(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      if (!isTheoryDocument(editor.document)) continue;
      for (const bucket of this.decorationTypes.values()) {
        editor.setDecorations(bucket.decorationType, []);
      }
    }
  }

  private ensureBucket(type: string, style: PideDecorationStyle): DecorationTypeBucket {
    const existing = this.decorationTypes.get(type);
    if (existing) return existing;
    const decorationType = createDecorationTypeForStyle(style);
    const bucket: DecorationTypeBucket = { style, decorationType };
    this.decorationTypes.set(type, bucket);
    return bucket;
  }
}

function isTheoryDocument(document: vscode.TextDocument): boolean {
  return document.languageId === "isabelle" || document.uri.fsPath.endsWith(".thy");
}

function collectVisibleTheoryUris(): string[] {
  const out: string[] = [];
  for (const editor of vscode.window.visibleTextEditors) {
    if (isTheoryDocument(editor.document)) {
      out.push(editor.document.uri.toString());
    }
  }
  return out;
}

function toDecorationOption(item: PideDecorationContentForPaint): vscode.DecorationOptions {
  return {
    range: toVsCodeRange(item.range),
    hoverMessage: toHoverMessage(item.hoverMessages)
  };
}

function toVsCodeRange(range: PideDecorationRange): vscode.Range {
  return new vscode.Range(
    range.start.line,
    range.start.character,
    range.end.line,
    range.end.character
  );
}

function toHoverMessage(
  hovers: readonly { language: string; value: string }[]
): vscode.MarkdownString | vscode.MarkdownString[] | undefined {
  if (hovers.length === 0) return undefined;
  const rendered = hovers.map((hover) => {
    const md = new vscode.MarkdownString();
    md.isTrusted = false;
    md.appendCodeblock(hover.value, hover.language);
    return md;
  });
  return rendered.length === 1 ? rendered[0] : rendered;
}

function createDecorationTypeForStyle(
  style: PideDecorationStyle
): vscode.TextEditorDecorationType {
  const themeColor = new vscode.ThemeColor(style.themeColorId);
  switch (style.presentation) {
    case "color":
      return vscode.window.createTextEditorDecorationType({
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
        color: themeColor
      });
    case "underline":
      return vscode.window.createTextEditorDecorationType({
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
        textDecoration: `underline wavy ${style.kind === "error" ? "red" : "orange"}`,
        overviewRulerLane:
          style.kind === "error"
            ? vscode.OverviewRulerLane.Right
            : vscode.OverviewRulerLane.Center,
        overviewRulerColor: themeColor
      });
    case "background":
      return vscode.window.createTextEditorDecorationType({
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
        backgroundColor: themeColor
      });
    case "border":
      return vscode.window.createTextEditorDecorationType({
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
        borderStyle: "solid",
        borderWidth: "1px",
        borderColor: themeColor
      });
    default: {
      const exhaustive: never = style.presentation;
      void exhaustive;
      return vscode.window.createTextEditorDecorationType({
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
      });
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
