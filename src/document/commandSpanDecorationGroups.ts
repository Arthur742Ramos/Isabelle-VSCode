import { CommandSpan, ProtocolRange } from "../protocol/messages";
import { IsabelleLanguageServerState } from "../lsp/lspTypes";
import { DocumentCommandStatus } from "./documentStatus";

export const STATUS_DECORATION_KEYS = [
  "pending",
  "running",
  "finished",
  "failed",
  "unknown"
] as const satisfies readonly DocumentCommandStatus[];

const STATUS_DECORATION_KEY_SET: ReadonlySet<string> = new Set(STATUS_DECORATION_KEYS);

export function emptyStatusRangeGroups(): Record<DocumentCommandStatus, ProtocolRange[]> {
  const groups = {
    pending: [],
    running: [],
    finished: [],
    failed: [],
    unknown: []
  } satisfies Record<DocumentCommandStatus, ProtocolRange[]>;

  return groups;
}

export function groupCommandSpanRangesByStatus(
  spans: readonly CommandSpan[]
): Record<DocumentCommandStatus, ProtocolRange[]> {
  const groups = emptyStatusRangeGroups();

  for (const span of spans) {
    const status: string = span.status;
    const key: DocumentCommandStatus = STATUS_DECORATION_KEY_SET.has(status)
      ? (status as DocumentCommandStatus)
      : "unknown";
    groups[key].push(span.range);
  }

  return groups;
}

/**
 * Policy: decide whether the local-syntax command-span decorations
 * should be suppressed for the current Isabelle language server state.
 *
 * Background: every span produced by the local `commandSpans.ts`
 * extraction carries `status: "pending"` because it is a syntactic
 * placeholder, not real PIDE processing state. When the Isabelle
 * language server is running, its own published diagnostics are the
 * authoritative source of per-command processing/error information,
 * and showing the local dashed-border "pending" gutter would mislead
 * the user into thinking the extension was tracking PIDE state when
 * it is not.
 *
 * The current policy is binary: when the LSP is `running`, suppress
 * all local decorations; otherwise (disabled, starting, stopping,
 * failed, or no LSP at all), keep the existing local-only behavior.
 * Once `isabelle vscode_server` exposes a per-command status surface
 * (it does not today — see docs/sledgehammer_lsp_research.md), this
 * policy will be extended to swap the source rather than suppress
 * entirely.
 */
export function shouldSuppressLocalCommandSpanDecorations(
  state: IsabelleLanguageServerState | undefined
): boolean {
  return state === "running";
}

/**
 * Convenience wrapper that returns either the suppressed (all-empty)
 * groups or the result of `groupCommandSpanRangesByStatus` depending
 * on the current LSP state. Kept pure so the decoration service can
 * delegate the policy decision and remain a thin VS Code adapter.
 */
export function computeDecorationGroupsForLspState(
  spans: readonly CommandSpan[],
  lspState: IsabelleLanguageServerState | undefined
): Record<DocumentCommandStatus, ProtocolRange[]> {
  if (shouldSuppressLocalCommandSpanDecorations(lspState)) {
    return emptyStatusRangeGroups();
  }
  return groupCommandSpanRangesByStatus(spans);
}
