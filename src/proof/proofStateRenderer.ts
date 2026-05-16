import { ProofStateResult } from "../protocol/messages";

export function renderProofStateHtml(state: ProofStateResult | undefined): string {
  const body = state ? renderState(state) : renderEmpty();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
  <style>
    body { color: var(--vscode-foreground); font-family: var(--vscode-font-family); padding: 0 12px; }
    h2, h3 { margin-bottom: 6px; }
    .muted { color: var(--vscode-descriptionForeground); }
    .section { border-top: 1px solid var(--vscode-panel-border); margin-top: 14px; padding-top: 10px; }
    pre { background: var(--vscode-textCodeBlock-background); padding: 8px; white-space: pre-wrap; }
    code { font-family: var(--vscode-editor-font-family); }
  </style>
</head>
<body>${body}</body>
</html>`;
}

function renderState(state: ProofStateResult): string {
  const command = state.command
    ? `<p><strong>Current command:</strong> <code>${escapeHtml(state.command.kind)}${state.command.name ? ` ${escapeHtml(state.command.name)}` : ""}</code></p>`
    : `<p class="muted">No command span at the current cursor position.</p>`;

  return `
    <h2>Proof State</h2>
    ${state.message ? `<p class="muted">${escapeHtml(state.message)}</p>` : ""}
    ${command}
    ${renderContext(state)}
    ${renderGoals(state)}
    <div class="section">
      <h3>Raw</h3>
      <pre>${escapeHtml(state.raw || "No raw proof state available yet.")}</pre>
    </div>`;
}

function renderContext(state: ProofStateResult): string {
  if (state.context.length === 0) {
    return `<div class="section"><h3>Context</h3><p class="muted">No structured context available yet.</p></div>`;
  }

  return `<div class="section"><h3>Context</h3>${state.context
    .map((entry) => `<p><strong>${escapeHtml(entry.kind)}</strong> ${entry.name ? `${escapeHtml(entry.name)}: ` : ""}<code>${escapeHtml(entry.value)}</code></p>`)
    .join("")}</div>`;
}

function renderGoals(state: ProofStateResult): string {
  if (state.goals.length === 0) {
    return `<div class="section"><h3>Goals</h3><p class="muted">No structured goals available yet.</p></div>`;
  }

  return `<div class="section"><h3>Goals</h3>${state.goals
    .map((goal) => `<h4>Goal ${goal.index}</h4><pre>${escapeHtml(goal.text)}</pre>`)
    .join("")}</div>`;
}

function renderEmpty(): string {
  return `
    <h2>Proof State</h2>
    <p class="muted">Open an Isabelle theory and move the cursor inside a command.</p>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
