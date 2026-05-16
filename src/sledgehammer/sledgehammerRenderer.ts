import { SledgehammerRunResult, SledgehammerSuggestion } from "../protocol/messages";

export function renderSledgehammerHtml(result: SledgehammerRunResult | undefined): string {
  const body = result ? renderResult(result) : renderEmpty();
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
    .status.failed, .status.unavailable { background: var(--vscode-testing-iconFailed); color: var(--vscode-editor-background); }
    pre { background: var(--vscode-textCodeBlock-background); padding: 8px; white-space: pre-wrap; }
    code { font-family: var(--vscode-editor-font-family); }
  </style>
</head>
<body>${body}</body>
</html>`;
}

function renderResult(result: SledgehammerRunResult): string {
  const command = result.command
    ? `<p><strong>Current command:</strong> <code>${escapeHtml(result.command.kind)}${result.command.name ? ` ${escapeHtml(result.command.name)}` : ""}</code></p>`
    : `<p class="muted">No command span at the current cursor position.</p>`;

  return `
    <h2>Sledgehammer</h2>
    <p><span class="status ${escapeHtml(result.status)}">${escapeHtml(result.status)}</span></p>
    ${result.message ? `<p class="muted">${escapeHtml(result.message)}</p>` : ""}
    <p><strong>Request:</strong> <code>${escapeHtml(result.requestId || "not started")}</code></p>
    ${command}
    ${renderSuggestions(result.suggestions)}
    <div class="section">
      <h3>Backend boundary</h3>
      <pre>${escapeHtml(result.raw || "No Sledgehammer backend details available yet.")}</pre>
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
