// Pure helper to convert Sledgehammer suggestions into VS Code
// QuickPick item shape, so the `Isabelle: Pick Sledgehammer Suggestion`
// command can present the available proofs without bespoke layout
// code in the panel. Keeping this layer pure means the picker
// behaviour stays unit-testable without spinning up vscode.

import { SledgehammerSuggestion } from "../protocol/messages";

/**
 * QuickPick item shape: matches `vscode.QuickPickItem` structurally
 * (label / description / detail) plus a back-reference `index` into
 * the suggestions array so the caller can map the chosen item back to
 * its `SledgehammerSuggestion` without rebuilding a side index.
 */
export interface SledgehammerQuickPickItem {
  readonly label: string;
  readonly description?: string;
  readonly detail?: string;
  /** Position of the originating suggestion in the input array (0-based). */
  readonly index: number;
}

/**
 * Build QuickPick items for the panel's "pick a suggestion to insert"
 * flow. Falls back to `Suggestion N` when the suggestion has no
 * label, prefers `method` for the description column when it adds
 * information beyond the proof text, and surfaces the trimmed proof
 * text as the detail column so the user sees what would be inserted.
 *
 * Suggestions whose proof text is empty / whitespace-only are still
 * included with `detail` left undefined; the panel-side insert path
 * will reject the choice with the existing "did not contain proof
 * text" warning, matching the pre-existing behaviour for
 * `insertFirstSuggestion`.
 */
export function buildSledgehammerQuickPickItems(
  suggestions: readonly SledgehammerSuggestion[]
): SledgehammerQuickPickItem[] {
  return suggestions.map((suggestion, index) => {
    const proofText = suggestion.proofText.trim();
    const label = suggestion.label ?? `Suggestion ${index + 1}`;
    const method = suggestion.method?.trim() ?? "";
    return {
      label,
      description:
        method.length > 0 && method !== proofText ? method : undefined,
      detail: proofText.length > 0 ? proofText : undefined,
      index
    };
  });
}
