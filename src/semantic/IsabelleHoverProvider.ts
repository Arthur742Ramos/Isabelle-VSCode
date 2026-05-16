import * as vscode from "vscode";
import { getCommandInfo, getSymbolInfo } from "./isabelleSyntax";
import { findSymbolEscapeRange } from "./ranges";

export class IsabelleHoverProvider implements vscode.HoverProvider {
  public provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.ProviderResult<vscode.Hover> {
    const symbolRange = symbolEscapeRangeAt(document, position);
    if (symbolRange) {
      const source = document.getText(symbolRange);
      const symbol = getSymbolInfo(source);
      if (symbol) {
        return new vscode.Hover(
          new vscode.MarkdownString(`**${symbol.glyph}** \`${source}\`\n\n${symbol.description}`),
          symbolRange
        );
      }
    }

    const wordRange = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_']*/);
    if (!wordRange) {
      return undefined;
    }

    const word = document.getText(wordRange);
    const command = getCommandInfo(word);
    if (!command) {
      return undefined;
    }

    return new vscode.Hover(new vscode.MarkdownString(`**Isabelle command** \`${word}\`\n\n${command.description}`), wordRange);
  }
}

function symbolEscapeRangeAt(document: vscode.TextDocument, position: vscode.Position): vscode.Range | undefined {
  const text = document.lineAt(position.line).text;
  const range = findSymbolEscapeRange(text, position.character);
  return range ? new vscode.Range(position.line, range.start, position.line, range.end) : undefined;
}
