// Command + webview wiring for `Isabelle: Preview Theory`.
//
// The command sends a `PIDE/preview_request { uri, column }` for the
// active Isabelle theory editor; the `PidePreviewSubscriber` listens
// for the matching `PIDE/preview_response { uri, column, label,
// content }` and re-uses the same webview panel for subsequent
// previews. The webview's `column` matches what the request asked for
// so the user can split the preview into an adjacent editor group.
//
// The module is `vscode`-free: it accepts an injectable
// `PreviewTheoryUi` shape that the extension wires to the real
// `vscode.window.{showInformationMessage,showWarningMessage,
// createWebviewPanel}` triple. Tests pass small fakes.

import {
  PidePreviewSnapshot,
  PidePreviewSubscriber,
  isEmptyPreviewSnapshot
} from "./PidePreviewSubscriber";
import { IsabelleLanguageServerStatus } from "../lsp/lspTypes";

export const PREVIEW_THEORY_COMMAND_ID = "isabelle.previewTheory";
export const PREVIEW_THEORY_SPLIT_COMMAND_ID = "isabelle.previewTheoryInSplit";

export interface PreviewTheoryLspStatusReader {
  getStatus(): IsabelleLanguageServerStatus;
}

export interface PreviewTheoryLogger {
  appendLine(message: string): void;
}

/**
 * Minimal webview-panel shape the command uses. The extension wires
 * this to `vscode.window.createWebviewPanel`; tests pass a fake.
 */
export interface PreviewTheoryPanel {
  setContent(title: string, html: string): void;
  reveal(column: number): void;
  dispose(): void;
}

export interface PreviewTheoryActiveEditor {
  readonly uri: string;
  readonly isTheoryDocument: boolean;
  /** ViewColumn the editor currently lives in (or 1 if none). */
  readonly viewColumn: number;
}

export interface PreviewTheoryUi {
  getActiveEditor(): PreviewTheoryActiveEditor | undefined;
  /** Compute the column to put the preview in (current column, or the next group). */
  resolvePreviewColumn(editor: PreviewTheoryActiveEditor, split: boolean): number;
  /** Lazily create or return the single shared preview panel. */
  ensurePanel(initialColumn: number): PreviewTheoryPanel;
  showInformationMessage(message: string): Promise<unknown>;
  showWarningMessage(message: string): Promise<unknown>;
}

/**
 * Implementation of `Isabelle: Preview Theory`. Returns true when a
 * request was actually dispatched.
 *
 * Order of guards:
 *   1. LSP not running → info message, no-op.
 *   2. No active editor → info message, no-op.
 *   3. Active editor is not an Isabelle theory → info message, no-op.
 *   4. Send request, ensure panel exists, reveal it. The actual HTML
 *      arrives asynchronously via the subscriber's snapshot listener
 *      (wired by `wirePreviewSnapshotsToPanel`).
 */
export async function previewActiveTheory(
  subscriber: PidePreviewSubscriber,
  lspStatus: PreviewTheoryLspStatusReader,
  ui: PreviewTheoryUi,
  options: { split?: boolean } = {}
): Promise<boolean> {
  const state = lspStatus.getStatus().state;
  if (state !== "running") {
    await ui.showInformationMessage(
      "Isabelle theory preview is only available when the Isabelle language server is running. Enable it via `isabelle.languageServer.enabled` or run `Isabelle: Start Language Server`."
    );
    return false;
  }
  const editor = ui.getActiveEditor();
  if (!editor) {
    await ui.showInformationMessage(
      "Open an Isabelle theory (`.thy` file) before running the preview command."
    );
    return false;
  }
  if (!editor.isTheoryDocument) {
    await ui.showInformationMessage(
      "Isabelle theory preview only applies to `.thy` files."
    );
    return false;
  }
  const previewColumn = ui.resolvePreviewColumn(editor, options.split === true);
  const panel = ui.ensurePanel(previewColumn);
  panel.reveal(previewColumn);
  const sent = subscriber.requestPreview(editor.uri, previewColumn);
  if (!sent) {
    await ui.showWarningMessage(
      "Could not dispatch the Isabelle theory preview request (the language server may have left the `running` state)."
    );
    return false;
  }
  // If we already have a cached snapshot for this URI, paint it
  // immediately so the user does not stare at an empty panel while
  // waiting for the server to re-render.
  const latest = subscriber.getLatest();
  if (latest && latest.uri === editor.uri && !isEmptyPreviewSnapshot(latest)) {
    panel.setContent(latest.label, wrapPreviewHtml(latest));
  } else {
    panel.setContent(
      `Loading preview…`,
      wrapPreviewPlaceholderHtml(editor.uri)
    );
  }
  return true;
}

/**
 * Bridge: subscribe to the subscriber's snapshot stream so that
 * server-pushed responses repaint the panel automatically when the
 * source theory changes. Returns a disposable that tears down the
 * subscription.
 */
export function wirePreviewSnapshotsToPanel(
  subscriber: PidePreviewSubscriber,
  ui: PreviewTheoryUi
): { dispose(): void } {
  const sub = subscriber.onSnapshot((snapshot) => {
    if (isEmptyPreviewSnapshot(snapshot)) return;
    const panel = ui.ensurePanel(snapshot.column);
    panel.setContent(snapshot.label, wrapPreviewHtml(snapshot));
  });
  return sub;
}

/**
 * Wrap the server-provided HTML body in a minimal webview document
 * with a strict Content-Security-Policy. The server's `content`
 * field is an HTML body fragment (not a full document). The CSP
 * disallows scripts entirely; preview content is intentionally
 * read-only.
 *
 * Pure helper exposed for tests.
 */
export function wrapPreviewHtml(snapshot: PidePreviewSnapshot): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
  <title>${escapeHtml(snapshot.label)}</title>
  <style>
    body { color: var(--vscode-foreground); font-family: var(--vscode-font-family); padding: 12px 18px; }
    h1, h2, h3 { margin-top: 18px; }
    pre, code { font-family: var(--vscode-editor-font-family); }
    pre { background: var(--vscode-textCodeBlock-background); padding: 8px; white-space: pre-wrap; }
    .pide-preview-meta { color: var(--vscode-descriptionForeground); font-size: 0.85em; margin-bottom: 16px; }
  </style>
</head>
<body>
  <div class="pide-preview-meta">
    Live theory preview from <code>isabelle vscode_server</code> · received ${escapeHtml(snapshot.receivedAt)}
  </div>
  ${snapshot.content}
</body>
</html>`;
}

/**
 * Placeholder rendered while the request is in flight.
 */
export function wrapPreviewPlaceholderHtml(uri: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
  <style>
    body { color: var(--vscode-descriptionForeground); font-family: var(--vscode-font-family); padding: 12px 18px; }
  </style>
</head>
<body>
  <p>Loading Isabelle preview for <code>${escapeHtml(uri)}</code>…</p>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
