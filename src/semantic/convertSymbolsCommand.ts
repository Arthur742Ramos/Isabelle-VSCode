import * as vscode from "vscode";
import { symbolsToAscii, symbolsToUnicode } from "./isabelleSymbols";

type SymbolDirection = "unicode" | "ascii";

/**
 * Convert Isabelle symbols in the active editor between their ASCII token form
 * (`\<forall>`) and their rendered Unicode glyph (`∀`).
 *
 * Operates on the current selection(s) when any text is selected, otherwise on
 * the whole document. The transform is a pure, lossless, prover-independent
 * mapping (see `isabelleSymbols.ts`), so it works offline and round-trips.
 */
export async function convertIsabelleSymbols(direction: SymbolDirection): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isTheoryDocument(editor.document)) {
    vscode.window.showWarningMessage("Open an Isabelle theory to convert its symbols.");
    return;
  }

  const transform = direction === "unicode" ? symbolsToUnicode : symbolsToAscii;
  const ranges = targetRanges(editor);

  let changed = 0;
  const applied = await editor.edit((builder) => {
    for (const range of ranges) {
      const original = editor.document.getText(range);
      const converted = transform(original);
      if (converted !== original) {
        builder.replace(range, converted);
        changed += 1;
      }
    }
  });

  if (!applied) {
    vscode.window.showErrorMessage(
      "Isabelle: could not apply the symbol conversion (the document may be read-only)."
    );
    return;
  }

  if (changed === 0) {
    vscode.window.showInformationMessage(
      direction === "unicode"
        ? "No Isabelle symbol tokens to convert to Unicode."
        : "No Isabelle symbol glyphs to convert to ASCII."
    );
    return;
  }

  vscode.window.setStatusBarMessage(
    direction === "unicode"
      ? "Isabelle: converted symbols to Unicode."
      : "Isabelle: converted symbols to ASCII (\\<...>).",
    3000
  );
}

/**
 * Non-empty selections, or the whole document when nothing is selected. Empty
 * selections (bare cursors) are ignored unless they are the only selection, in
 * which case the whole document is used.
 */
function targetRanges(editor: vscode.TextEditor): vscode.Range[] {
  const nonEmpty = editor.selections.filter((selection) => !selection.isEmpty);
  if (nonEmpty.length > 0) {
    return nonEmpty.map((selection) => new vscode.Range(selection.start, selection.end));
  }
  const lastLine = editor.document.lineCount - 1;
  const end = editor.document.lineAt(lastLine).range.end;
  return [new vscode.Range(0, 0, end.line, end.character)];
}

function isTheoryDocument(document: vscode.TextDocument): boolean {
  return document.languageId === "isabelle" || document.uri.fsPath.endsWith(".thy");
}
