import * as vscode from "vscode";
import { findOccurrences } from "./occurrences";

/**
 * Offline document-highlight provider: highlights every occurrence of the
 * identifier under the cursor in a `.thy` file. Pure-lexical (via
 * {@link findOccurrences}), so it works with no prover or language server.
 *
 * The declaring occurrence (the name after `definition`, `lemma`, …) is reported
 * as a `Write` highlight; every use is a `Text` highlight, so VS Code can render
 * the definition distinctly.
 */
export class IsabelleDocumentHighlightProvider implements vscode.DocumentHighlightProvider {
  public provideDocumentHighlights(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.ProviderResult<vscode.DocumentHighlight[]> {
    const offset = document.offsetAt(position);
    const occurrences = findOccurrences(document.getText(), offset);
    if (occurrences.length === 0) {
      return undefined;
    }
    return occurrences.map(
      (occurrence) =>
        new vscode.DocumentHighlight(
          new vscode.Range(
            document.positionAt(occurrence.offset),
            document.positionAt(occurrence.offset + occurrence.length)
          ),
          occurrence.kind === "write"
            ? vscode.DocumentHighlightKind.Write
            : vscode.DocumentHighlightKind.Text
        )
    );
  }
}
