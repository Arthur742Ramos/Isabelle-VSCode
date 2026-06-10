import * as vscode from "vscode";
import { buildSymbolPickItems, SymbolPickItem } from "./isabelleSymbols";

interface SymbolQuickPickItem extends vscode.QuickPickItem {
  readonly insertText: string;
}

let cachedItems: readonly SymbolQuickPickItem[] | undefined;

/** Build the quick-pick items lazily on first use so importing this module
 * (during activation) does not pay the build+sort cost when the command is
 * never run. */
function getPickItems(): readonly SymbolQuickPickItem[] {
  if (cachedItems === undefined) {
    cachedItems = buildSymbolPickItems().map(toQuickPickItem);
  }
  return cachedItems;
}

/**
 * `Isabelle: Insert Symbol` — browse and search the full Isabelle symbol table
 * (by glyph, token, group, or ASCII abbreviation) and insert the chosen symbol
 * at the cursor. Complements the inline `\<…>` completion for when you do not
 * know the symbol's name. Works offline.
 */
export async function insertIsabelleSymbol(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isTheoryDocument(editor.document)) {
    vscode.window.showWarningMessage("Open an Isabelle theory to insert a symbol.");
    return;
  }

  const picked = await vscode.window.showQuickPick(getPickItems(), {
    title: "Insert Isabelle Symbol",
    placeHolder: "Search by glyph, name (\\<forall>), group (logic), or abbreviation (ALL, !)…",
    matchOnDescription: true,
    matchOnDetail: true
  });
  if (!picked) {
    return;
  }

  const selections = editor.selections;
  const applied = await editor.edit((builder) => {
    for (const selection of selections) {
      builder.replace(selection, picked.insertText);
    }
  });
  if (!applied) {
    vscode.window.showErrorMessage(
      "Isabelle: could not insert the symbol (the document may be read-only)."
    );
  }
}

function toQuickPickItem(item: SymbolPickItem): SymbolQuickPickItem {
  return {
    label: item.label,
    description: item.label === item.name ? undefined : item.name,
    detail: item.detail,
    insertText: item.insertText
  };
}

function isTheoryDocument(document: vscode.TextDocument): boolean {
  return document.languageId === "isabelle" || document.uri.fsPath.endsWith(".thy");
}
