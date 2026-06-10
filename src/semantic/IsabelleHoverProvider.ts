import * as vscode from "vscode";
import { buildCommandHoverMarkdown, getCommandInfo } from "./isabelleSyntax";
import { buildMethodHoverMarkdown, getMethodInfo, isMethodArgumentLabel, isMethodPosition } from "./proofMethods";
import {
  buildSymbolHoverMarkdown,
  findGlyphSpanAt,
  resolveSymbolByGlyph,
  resolveSymbolByName
} from "./isabelleSymbols";
import { findSymbolEscapeRange } from "./ranges";

export class IsabelleHoverProvider implements vscode.HoverProvider {
  public provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.ProviderResult<vscode.Hover> {
    const lineText = document.lineAt(position.line).text;

    // 1. Cursor inside a `\<...>` symbol token.
    const escapeRange = findSymbolEscapeRange(lineText, position.character);
    if (escapeRange) {
      const token = lineText.slice(escapeRange.start, escapeRange.end);
      const symbol = resolveSymbolByName(token);
      if (symbol) {
        return new vscode.Hover(
          new vscode.MarkdownString(buildSymbolHoverMarkdown(symbol)),
          new vscode.Range(position.line, escapeRange.start, position.line, escapeRange.end)
        );
      }
    }

    // 2. Cursor on a rendered Isabelle glyph (e.g. ∀, ⟹, λ).
    const glyphSpan = findGlyphSpanAt(lineText, position.character);
    if (glyphSpan) {
      const symbol = resolveSymbolByGlyph(glyphSpan.glyph);
      if (symbol) {
        return new vscode.Hover(
          new vscode.MarkdownString(buildSymbolHoverMarkdown(symbol)),
          new vscode.Range(position.line, glyphSpan.start, position.line, glyphSpan.end)
        );
      }
    }

    // 3. Cursor on an Isabelle command keyword.
    const wordRange = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_']*/);
    if (!wordRange) {
      return undefined;
    }

    const word = document.getText(wordRange);
    const command = getCommandInfo(word);
    if (command) {
      return new vscode.Hover(new vscode.MarkdownString(buildCommandHoverMarkdown(command)), wordRange);
    }

    // 4. Cursor on a proof method (`simp`, `auto`, `induct`, …) in method
    //    position — i.e. following `apply` / `by` / `proof` on the line — so a
    //    bare identifier in a term is not described as a method. A name used as
    //    an argument label (`induct rule: r`) is excluded.
    const method = getMethodInfo(word);
    if (
      method &&
      isMethodPosition(lineText, wordRange.start.character) &&
      !isMethodArgumentLabel(lineText, wordRange.end.character)
    ) {
      return new vscode.Hover(new vscode.MarkdownString(buildMethodHoverMarkdown(method)), wordRange);
    }

    return undefined;
  }
}
