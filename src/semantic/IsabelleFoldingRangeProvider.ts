import * as vscode from "vscode";
import { computeIsabelleFoldingRanges, IsabelleFoldingKind, IsabelleFoldingRange } from "./foldingRanges";

/**
 * Adapts the pure {@link computeIsabelleFoldingRanges} computation to VS Code's
 * {@link vscode.FoldingRangeProvider} contract.
 *
 * Folding is derived from the document text alone, so it is available for every
 * `.thy` file without a running Isabelle process. When the optional language
 * server is `running`, VS Code aggregates these ranges with any the LSP
 * provides — consistent with the other always-on local providers.
 */
export class IsabelleFoldingRangeProvider implements vscode.FoldingRangeProvider {
  public provideFoldingRanges(
    document: vscode.TextDocument,
    _context: vscode.FoldingContext,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.FoldingRange[]> {
    return computeIsabelleFoldingRanges(document.getText()).map(toVscodeFoldingRange);
  }
}

function toVscodeFoldingRange(range: IsabelleFoldingRange): vscode.FoldingRange {
  return new vscode.FoldingRange(range.start, range.end, toVscodeFoldingKind(range.kind));
}

function toVscodeFoldingKind(kind: IsabelleFoldingKind): vscode.FoldingRangeKind {
  switch (kind) {
    case "comment":
      return vscode.FoldingRangeKind.Comment;
    case "imports":
      return vscode.FoldingRangeKind.Imports;
    case "region":
    default:
      return vscode.FoldingRangeKind.Region;
  }
}
