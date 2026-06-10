import * as vscode from "vscode";
import { buildSymbolPickItems, SymbolPickItem } from "./isabelleSymbols";

interface SymbolQuickPickItem extends vscode.QuickPickItem {
  readonly insertText: string;
}

const PICK_ITEMS: readonly SymbolQuickPickItem[] = buildSymbolPickItems().map(toQuickPickItem);

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

  const picked = await vscode.window.showQuickPick(PICK_ITEMS, {
    title: "Insert Isabelle Symbol",
    placeHolder: "Search by glyph, name (\\<forall>), group (logic), or abbreviation (ALL, !)…",
    matchOnDescription: true,
    matchOnDetail: true
  });
  if (!picked) {
    return;
  }

  const selections = editor.selections;
  await editor.edit((builder) => {
    for (const selection of selections) {
      builder.replace(selection, picked.insertText);
    }
  });
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
