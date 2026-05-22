import { SledgehammerRunResult, SledgehammerSuggestion } from "../protocol/messages";
import { PideOutputNode, renderPideOutputHtml } from "./pideSledgehammerOutput";
import { SledgehammerHistoryEntry } from "./sledgehammerHistory";

const MAX_RECENT_HISTORY_ENTRIES = 10;

export function renderSledgehammerHtml(
  result: SledgehammerRunResult | undefined,
  history: readonly SledgehammerHistoryEntry[] = [],
  outputNodes: readonly PideOutputNode[] = []
): string {
  const main = result ? renderResult(result, outputNodes) : renderEmpty();
  const body = `${main}${renderHistory(history)}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
  <style>
    body { color: var(--vscode-foreground); font-family: var(--vscode-font-family); padding: 0 12px; }
    h2, h3, h4 { margin-bottom: 6px; }
    .muted { color: var(--vscode-descriptionForeground); }
    .section { border-top: 1px solid var(--vscode-panel-border); margin-top: 14px; padding-top: 10px; }
    .status { border-radius: 999px; display: inline-block; font-size: 0.85em; padding: 2px 8px; }
    .status.completed { background: var(--vscode-testing-iconPassed); color: var(--vscode-editor-background); }
    .status.running { background: var(--vscode-testing-iconQueued); color: var(--vscode-editor-background); }
    .status.failed, .status.unavailable, .status.cancelled { background: var(--vscode-testing-iconFailed); color: var(--vscode-editor-background); }
    pre { background: var(--vscode-textCodeBlock-background); padding: 8px; white-space: pre-wrap; }
    code { font-family: var(--vscode-editor-font-family); }
    ul.history { list-style: none; padding-left: 0; }
    ul.history li { margin-bottom: 6px; }
    ul.history li .meta { margin-left: 6px; }
    .pide-sledgehammer-message { padding: 6px 8px; margin: 6px 0; border-left: 3px solid var(--vscode-panel-border); background: var(--vscode-textBlockQuote-background); }
    .pide-sledgehammer-error { border-left-color: var(--vscode-editorError-foreground); }
    .pide-sledgehammer-warning { border-left-color: var(--vscode-editorWarning-foreground); }
    .pide-sledgehammer-information { border-left-color: var(--vscode-editorInfo-foreground); }
    .pide-sledgehammer-sendback { background: var(--vscode-textCodeBlock-background); padding: 1px 4px; border-radius: 2px; }
    .pide-sledgehammer-text { white-space: pre-wrap; }
  </style>
</head>
<body>${body}</body>
</html>`;
}

function renderResult(
  result: SledgehammerRunResult,
  outputNodes: readonly PideOutputNode[]
): string {
  const command = result.command
    ? `<p><strong>Current command:</strong> <code>${escapeHtml(result.command.kind)}${result.command.name ? ` ${escapeHtml(result.command.name)}` : ""}</code></p>`
    : `<p class="muted">No command span at the current cursor position.</p>`;

  return `
    <h2>Sledgehammer</h2>
    <p><span class="status ${escapeHtml(result.status)}">${escapeHtml(result.status)}</span></p>
    ${result.message ? `<p class="muted">${escapeHtml(result.message)}</p>` : ""}
    <p><strong>Request:</strong> <code>${escapeHtml(result.requestId || "not started")}</code></p>
    ${renderRunProvenance(result)}
    ${command}
    ${renderSuggestions(result.suggestions)}
    ${renderBackendBoundary(result, outputNodes)}`;
}

function renderRunProvenance(result: SledgehammerRunResult): string {
  const parts: string[] = [];
  if (result.position) {
    parts.push(`cursor line ${result.position.line + 1}, column ${result.position.character + 1}`);
  }
  if (result.version !== undefined) {
    parts.push(`document version ${result.version}`);
  }
  if (parts.length === 0) {
    return "";
  }
  return `<p class="muted"><strong>Provenance:</strong> ${escapeHtml(parts.join("; "))}.</p>`;
}

function renderBackendBoundary(
  result: SledgehammerRunResult,
  outputNodes: readonly PideOutputNode[]
): string {
  if (outputNodes.length > 0) {
    // LSP-mode: render the parsed Isabelle XML markup using stable CSS
    // classes from `pideSledgehammerOutput.ts`. The raw status message
    // is shown as a small caption above so users can still see the
    // upstream PIDE/sledgehammer_status text.
    const status = result.raw ? `<p class="muted">${escapeHtml(result.raw)}</p>` : "";
    return `
      <div class="section">
        <h3>Prover output</h3>
        ${status}
        ${renderPideOutputHtml(outputNodes)}
      </div>`;
  }
  return `
    <div class="section">
      <h3>Backend boundary</h3>
      <pre>${escapeHtml(result.raw || "No Sledgehammer backend details available yet.")}</pre>
    </div>`;
}

function renderHistory(history: readonly SledgehammerHistoryEntry[]): string {
  if (history.length === 0) {
    return "";
  }

  const recent = history.slice(0, MAX_RECENT_HISTORY_ENTRIES);
  const items = recent
    .map((entry) => {
      const summary = entry.commandSummary
        ? ` <code>${escapeHtml(entry.commandSummary)}</code>`
        : "";
      const message = entry.message
        ? ` <span class="muted meta">${escapeHtml(entry.message)}</span>`
        : "";
      const suggestionLabel = entry.suggestionCount === 1 ? "1 suggestion" : `${entry.suggestionCount} suggestions`;
      return `
        <li>
          <code class="muted">${escapeHtml(entry.startedAt)}</code>${summary}
          <span class="status ${escapeHtml(entry.status)} meta">${escapeHtml(entry.status)}</span>
          <span class="muted meta">${escapeHtml(suggestionLabel)}</span>
          <span class="muted meta">request <code>${escapeHtml(entry.requestId)}</code></span>${message}
        </li>`;
    })
    .join("");

  return `
    <div class="section">
      <h3>Recent runs</h3>
      <p class="muted">Local-only history of Sledgehammer requests. PIDE-backed proof search remains future work.</p>
      <ul class="history">${items}</ul>
    </div>`;
}

function renderSuggestions(suggestions: SledgehammerSuggestion[]): string {
  if (suggestions.length === 0) {
    return `<div class="section"><h3>Suggested proofs</h3><p class="muted">No proof suggestions are available yet.</p></div>`;
  }

  return `<div class="section"><h3>Suggested proofs</h3>${suggestions
    .map((suggestion, index) => `
      <h4>${escapeHtml(suggestion.label ?? `Suggestion ${index + 1}`)}</h4>
      ${suggestion.method ? `<p><strong>Method:</strong> <code>${escapeHtml(suggestion.method)}</code></p>` : ""}
      ${suggestion.description ? `<p class="muted">${escapeHtml(suggestion.description)}</p>` : ""}
      <pre>${escapeHtml(suggestion.proofText)}</pre>`)
    .join("")}</div>`;
}

function renderEmpty(): string {
  return `
    <h2>Sledgehammer</h2>
    <p class="muted">Open an Isabelle theory and run <strong>Isabelle: Run Sledgehammer</strong> from a proof command.</p>
    <p class="muted">This milestone wires the workflow surface and protocol boundary; live proof search still requires Isabelle/PIDE backend integration.</p>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
