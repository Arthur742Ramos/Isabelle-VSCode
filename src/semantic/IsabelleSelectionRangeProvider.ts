import * as vscode from "vscode";
import { selectionRangesAt } from "./selectionRanges";

/**
 * Offline smart-selection provider ("Expand / Shrink Selection",
 * Alt+Shift+Arrow). For each cursor it returns a nested chain — identifier
 * token ⊂ quoted term / cartouche ⊂ command span ⊂ enclosing block / proof ⊂
 * whole document — built purely lexically by {@link selectionRangesAt}, so it
 * works with no prover or language server.
 */
export class IsabelleSelectionRangeProvider implements vscode.SelectionRangeProvider {
  public provideSelectionRanges(
    document: vscode.TextDocument,
    positions: vscode.Position[]
  ): vscode.ProviderResult<vscode.SelectionRange[]> {
    const text = document.getText();
    return positions.map((position) => buildChain(document, text, document.offsetAt(position)));
  }
}

function buildChain(document: vscode.TextDocument, text: string, offset: number): vscode.SelectionRange {
  const ranges = selectionRangesAt(text, offset);
  // VS Code wants outermost-as-parent: build from the largest range inward so
  // each SelectionRange's `parent` is the next-larger one.
  let parent: vscode.SelectionRange | undefined;
  for (let i = ranges.length - 1; i >= 0; i--) {
    const range = ranges[i];
    const vsRange = new vscode.Range(
      document.positionAt(range.start),
      document.positionAt(range.end)
    );
    parent = new vscode.SelectionRange(vsRange, parent);
  }
  // Always provide at least a degenerate range at the cursor so the provider
  // never returns undefined for a valid position.
  return parent ?? new vscode.SelectionRange(new vscode.Range(document.positionAt(offset), document.positionAt(offset)));
}
