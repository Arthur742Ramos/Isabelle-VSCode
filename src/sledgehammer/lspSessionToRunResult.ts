// Pure conversion helpers that translate an `LspSledgehammerSession`
// update stream into the existing `SledgehammerRunResult` shape used by
// `SledgehammerPanel`'s renderer, history, and insert-first-suggestion
// command. Keeping this layer pure means the panel-side branching stays
// a thin VS Code adapter, and the LSP-mode plumbing is exercised by
// vitest without spinning up the webview.
//
// Design notes:
//   - Each upstream `<sendback>...</sendback>` element becomes a
//     `SledgehammerSuggestion` with the proof text in both `method`
//     (for renderer display) and `proofText` (so the existing
//     `Isabelle: Insert Sledgehammer Proof` command keeps working
//     unchanged). The label is a 1-based "Suggestion N" so the UI
//     mirrors the backend-mode rendering.
//   - The session's typed `SessionStatus` collapses to the existing
//     wire `SledgehammerStatus` enum:
//       dispatching | running -> "running"
//       finished                -> "completed"
//       cancelled               -> "cancelled"
//       errored                 -> "failed"
//   - `raw` carries the last upstream `PIDE/sledgehammer_status.message`
//     for display in the existing "Backend boundary" section. The
//     parsed output tree is surfaced separately via the renderer's
//     optional `outputNodes` parameter — see `sledgehammerRenderer.ts`.
//   - `message` is a user-friendly one-liner per status. It mirrors the
//     phrasing the backend path already produces so the panel reads
//     consistently across both modes.

import {
  ProtocolPosition,
  SledgehammerRunResult,
  SledgehammerStatus,
  SledgehammerSuggestion
} from "../protocol/messages";
import { SessionStatus, SessionUpdate } from "./LspSledgehammerSession";

export interface ConvertSessionUpdateOptions {
  /** Stable identifier for this run; usually `sledgehammer-lsp-<n>`. */
  readonly requestId: string;
  /** URI of the theory document the run is attached to. */
  readonly uri: string;
  /** TextDocument.version captured at dispatch time. */
  readonly documentVersion?: number;
  /** Cursor position captured at dispatch time. */
  readonly position?: ProtocolPosition;
}

/**
 * Translate one `SessionUpdate` snapshot into a
 * `SledgehammerRunResult` consumable by the existing renderer + history
 * + insert-suggestion code paths.
 */
export function convertSessionUpdateToRunResult(
  update: SessionUpdate,
  options: ConvertSessionUpdateOptions
): SledgehammerRunResult {
  const status = mapSessionStatusToSledgehammerStatus(update.status);
  const suggestions = sendbacksToSuggestions(update.sendbacks);
  return {
    requestId: options.requestId,
    uri: options.uri,
    version: options.documentVersion,
    position: options.position,
    status,
    suggestions,
    raw: update.statusMessage ?? "",
    message: deriveResultMessage(update, suggestions.length)
  };
}

export function mapSessionStatusToSledgehammerStatus(
  status: SessionStatus
): SledgehammerStatus {
  switch (status) {
    case "dispatching":
    case "running":
      return "running";
    case "finished":
      return "completed";
    case "cancelled":
      return "cancelled";
    case "errored":
      return "failed";
  }
}

/**
 * Map sendback proof strings (as collected by the parser's
 * `collectSendbackTexts`) into the legacy `SledgehammerSuggestion`
 * shape. Empty / whitespace-only sendbacks are dropped at the parser
 * level, so this helper trusts its input.
 */
export function sendbacksToSuggestions(
  sendbacks: readonly string[]
): SledgehammerSuggestion[] {
  return sendbacks.map((text, index) => ({
    label: `Suggestion ${index + 1}`,
    method: text,
    proofText: text
  }));
}

/**
 * Surface a stable one-liner per session state so the existing
 * `vscode.window.showInformationMessage` call sites in
 * `SledgehammerPanel` produce sensible LSP-mode notifications.
 */
function deriveResultMessage(
  update: SessionUpdate,
  suggestionCount: number
): string {
  switch (update.status) {
    case "dispatching":
      return "Sledgehammer request dispatched to isabelle vscode_server.";
    case "running":
      return update.statusMessage ?? "Sledgehammer is searching for a proof.";
    case "finished":
      if (suggestionCount > 0) {
        return suggestionCount === 1
          ? "Sledgehammer found 1 proof suggestion."
          : `Sledgehammer found ${suggestionCount} proof suggestions.`;
      }
      return update.statusMessage
        ? `Sledgehammer finished: ${update.statusMessage}`
        : "Sledgehammer finished with no proof suggestions.";
    case "cancelled":
      return update.statusMessage
        ? `Sledgehammer cancelled: ${update.statusMessage}`
        : "Sledgehammer cancelled.";
    case "errored":
      return update.statusMessage
        ? `Sledgehammer LSP error: ${update.statusMessage}`
        : "Sledgehammer LSP error.";
  }
}

/** Convenience: is this session status terminal? */
export function isTerminalSessionStatus(status: SessionStatus): boolean {
  return status === "finished" || status === "cancelled" || status === "errored";
}
