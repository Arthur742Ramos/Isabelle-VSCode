import * as vscode from "vscode";
import { tokenizeSemanticLine, SemanticTokenModifier, SemanticTokenType } from "./tokenizer";

const TOKEN_TYPES: SemanticTokenType[] = ["keyword", "function", "variable", "typeParameter", "operator"];
const TOKEN_MODIFIERS: SemanticTokenModifier[] = ["declaration"];

export const ISABELLE_SEMANTIC_TOKENS_LEGEND = new vscode.SemanticTokensLegend(
  TOKEN_TYPES,
  TOKEN_MODIFIERS
);

export class IsabelleSemanticTokensProvider implements vscode.DocumentSemanticTokensProvider {
  public provideDocumentSemanticTokens(document: vscode.TextDocument): vscode.ProviderResult<vscode.SemanticTokens> {
    const builder = new vscode.SemanticTokensBuilder(ISABELLE_SEMANTIC_TOKENS_LEGEND);

    for (let line = 0; line < document.lineCount; line++) {
      for (const token of tokenizeSemanticLine(document.lineAt(line).text, line)) {
        builder.push(
          token.line,
          token.character,
          token.length,
          TOKEN_TYPES.indexOf(token.type),
          modifierMask(token.modifiers ?? [])
        );
      }
    }

    return builder.build();
  }
}

function modifierMask(modifiers: SemanticTokenModifier[]): number {
  return modifiers.reduce((mask, modifier) => mask | (1 << TOKEN_MODIFIERS.indexOf(modifier)), 0);
}
