import { PideOutputNode, renderPideOutputHtml } from "../sledgehammer/pideSledgehammerOutput";
import { ProofStateResult } from "../protocol/messages";

export interface PideProofStateView {
  /** Parsed Isabelle XML markup nodes from the latest PIDE/state_output snapshot. */
  readonly outputNodes: readonly PideOutputNode[];
  /** Whether the upstream State_Panel's auto-update is currently enabled. */
  readonly autoUpdate: boolean;
  /** Wall-clock timestamp for the last accepted PIDE/state_output payload. */
  readonly lastOutputReceivedAtMs?: number;
  /** Wall-clock timestamp for the latest client-requested refresh. */
  readonly refreshRequestedAtMs?: number;
  /** Testable current wall-clock timestamp used for freshness rendering. */
  readonly nowMs?: number;
  /** Age after which a received snapshot is called out as old. */
  readonly staleAfterMs?: number;
  /** Optional human-readable status caption. */
  readonly status?: string;
  /** Optional error message; rendered as a warning section. */
  readonly errorMessage?: string;
  /**
   * Optional secondary `PIDE/dynamic_output` snapshot. When supplied,
   * the renderer adds a "Dynamic output (caret-driven)" section under
   * the main proof state. Empty / undefined hides the section.
   */
  readonly dynamicOutputNodes?: readonly PideOutputNode[];
}

export const DEFAULT_PROOF_STATE_STALE_AFTER_MS = 10_000;

export type ProofStateFreshnessTone = "info" | "warning";

export interface ProofStateFreshnessSnapshot {
  readonly lastOutputReceivedAtMs?: number;
  readonly refreshRequestedAtMs?: number;
  readonly nowMs: number;
  readonly staleAfterMs?: number;
}

export interface ProofStateFreshness {
  readonly tone: ProofStateFreshnessTone;
  readonly message: string;
}

export function renderProofStateHtml(
  state: ProofStateResult | undefined,
  pideView?: PideProofStateView
): string {
  const body = pideView
    ? renderPideState(pideView, state)
    : state
      ? renderState(state)
      : renderEmpty();
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
    .pide-sledgehammer-message { padding: 6px 8px; margin: 6px 0; border-left: 3px solid var(--vscode-panel-border); background: var(--vscode-textBlockQuote-background); }
    .pide-sledgehammer-error { border-left-color: var(--vscode-editorError-foreground); }
    .pide-sledgehammer-warning { border-left-color: var(--vscode-editorWarning-foreground); }
    .pide-sledgehammer-information { border-left-color: var(--vscode-editorInfo-foreground); }
    .pide-sledgehammer-sendback { background: var(--vscode-textCodeBlock-background); padding: 1px 4px; border-radius: 2px; }
    .pide-sledgehammer-text { white-space: pre-wrap; }
    .lsp-banner { background: var(--vscode-editorInfo-background); border-left: 3px solid var(--vscode-editorInfo-foreground); padding: 6px 8px; margin-bottom: 10px; }
    .freshness { border-left: 3px solid var(--vscode-editorInfo-foreground); padding: 4px 8px; margin: 8px 0; }
    .freshness-warning { border-left-color: var(--vscode-editorWarning-foreground); background: var(--vscode-inputValidation-warningBackground); }
    .freshness-info { background: var(--vscode-textBlockQuote-background); }
    .auto-update-on { color: var(--vscode-testing-iconPassed); }
    .auto-update-off { color: var(--vscode-testing-iconQueued); }
  </style>
</head>
<body>${body}</body>
</html>`;
}

function renderPideState(view: PideProofStateView, state: ProofStateResult | undefined): string {
  const autoClass = view.autoUpdate ? "auto-update-on" : "auto-update-off";
  const autoLabel = view.autoUpdate ? "auto-update on" : "auto-update off";
  const banner = `<div class="lsp-banner">Live proof state from <code>isabelle vscode_server</code> (PIDE state panel) — <span class="${autoClass}">${autoLabel}</span>.</div>`;
  const freshness = renderFreshness(view);

  const command = state?.command
    ? `<p><strong>Current command:</strong> <code>${escapeHtml(state.command.kind)}${state.command.name ? ` ${escapeHtml(state.command.name)}` : ""}</code></p>`
    : "";

  const status = view.status
    ? `<p class="muted">${escapeHtml(view.status)}</p>`
    : "";

  const error = view.errorMessage
    ? `<div class="section"><h3>Error</h3><pre>${escapeHtml(view.errorMessage)}</pre></div>`
    : "";

  const pideBody = view.outputNodes.length > 0
    ? `<div class="section"><h3>Proof state</h3>${renderPideOutputHtml(view.outputNodes)}</div>`
    : `<div class="section"><h3>Proof state</h3><p class="muted">Waiting for isabelle vscode_server to publish state for the current caret position.</p></div>`;

  const dynamicBody =
    view.dynamicOutputNodes && view.dynamicOutputNodes.length > 0
      ? `<div class="section"><h3>Dynamic output (caret-driven)</h3>${renderPideOutputHtml(view.dynamicOutputNodes)}</div>`
      : "";

  return `<h2>Proof State</h2>${banner}${freshness}${status}${command}${pideBody}${dynamicBody}${error}`;
}

export function formatProofStateFreshness(
  snapshot: ProofStateFreshnessSnapshot
): ProofStateFreshness {
  const staleAfterMs = snapshot.staleAfterMs ?? DEFAULT_PROOF_STATE_STALE_AFTER_MS;
  const lastOutput = snapshot.lastOutputReceivedAtMs;
  const refreshRequested = snapshot.refreshRequestedAtMs;
  if (lastOutput === undefined) {
    if (refreshRequested !== undefined) {
      return {
        tone: "warning",
        message: `No PIDE proof-state snapshot has arrived yet; refresh requested ${formatElapsed(snapshot.nowMs - refreshRequested)}.`
      };
    }
    return {
      tone: "warning",
      message: "No PIDE proof-state snapshot has arrived yet."
    };
  }

  const outputAgeMs = Math.max(0, snapshot.nowMs - lastOutput);
  if (refreshRequested !== undefined && refreshRequested > lastOutput) {
    const refreshAgeMs = Math.max(0, snapshot.nowMs - refreshRequested);
    return {
      tone: "warning",
      message: `Refresh pending for ${formatDuration(refreshAgeMs)}: showing previous PIDE state from ${formatElapsed(outputAgeMs)} until isabelle vscode_server publishes the current caret state.`
    };
  }

  if (outputAgeMs >= staleAfterMs) {
    return {
      tone: "warning",
      message: `Latest PIDE state received ${formatElapsed(outputAgeMs)}; re-anchor if this no longer matches the cursor.`
    };
  }

  return {
    tone: "info",
    message: `Latest PIDE state received ${formatElapsed(outputAgeMs)}.`
  };
}

function renderFreshness(view: PideProofStateView): string {
  const freshness = formatProofStateFreshness({
    lastOutputReceivedAtMs: view.lastOutputReceivedAtMs,
    refreshRequestedAtMs: view.refreshRequestedAtMs,
    nowMs: view.nowMs ?? Date.now(),
    staleAfterMs: view.staleAfterMs
  });
  return `<p class="freshness freshness-${freshness.tone}">${escapeHtml(freshness.message)}</p>`;
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

function formatElapsed(elapsedMs: number): string {
  const safeMs = Math.max(0, elapsedMs);
  if (safeMs < 1_000) {
    return "just now";
  }
  if (safeMs < 60_000) {
    return `${Math.floor(safeMs / 1_000)}s ago`;
  }
  if (safeMs < 3_600_000) {
    return `${Math.floor(safeMs / 60_000)}m ago`;
  }
  return `${Math.floor(safeMs / 3_600_000)}h ago`;
}

function formatDuration(elapsedMs: number): string {
  const safeMs = Math.max(0, elapsedMs);
  if (safeMs < 1_000) {
    return "less than 1s";
  }
  if (safeMs < 60_000) {
    return `${Math.floor(safeMs / 1_000)}s`;
  }
  if (safeMs < 3_600_000) {
    return `${Math.floor(safeMs / 60_000)}m`;
  }
  return `${Math.floor(safeMs / 3_600_000)}h`;
}
