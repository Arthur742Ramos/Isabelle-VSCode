import * as vscode from "vscode";
import {
  ALL_ISABELLE_SYMBOLS,
  findSymbolCompletionContext,
  ResolvedIsabelleSymbol,
  symbolFilterText
} from "./isabelleSymbols";

/**
 * Offline Isabelle symbol completion.
 *
 * When the user starts typing an Isabelle symbol token (`\`, `\<`, `\<fora`, …),
 * this offers the matching symbols from the embedded authoritative table and
 * inserts the full token, e.g. `\<forall>`. It needs no running prover or
 * language server, so it works the instant a `.thy` file opens.
 *
 * When the optional language server is also running, its `PIDE/abbrevs`
 * completions (see {@link PideAbbrevsCompletionProvider}) and VS Code's
 * aggregation mean both sets appear; the items here sort after PIDE-sourced
 * suggestions so live data wins ties.
 */
export class IsabelleSymbolCompletionProvider implements vscode.CompletionItemProvider {
  public provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.ProviderResult<vscode.CompletionList> {
    if (!isTheoryDocument(document)) {
      return undefined;
    }
    const lineText = document.lineAt(position.line).text;
    const context = findSymbolCompletionContext(lineText, position.character);
    if (!context) {
      return undefined;
    }
    const range = new vscode.Range(new vscode.Position(position.line, context.replaceStart), position);
    const items = ALL_ISABELLE_SYMBOLS.map((symbol) => toCompletionItem(symbol, range));
    // isIncomplete: false — the full table is static, so VS Code can filter the
    // returned set client-side as the user keeps typing without re-querying.
    return new vscode.CompletionList(items, false);
  }
}

const SYMBOL_TRIGGER_CHARACTERS = ["\\", "<", "^"];

export function registerIsabelleSymbolCompletionProvider(): vscode.Disposable {
  return vscode.languages.registerCompletionItemProvider(
    { language: "isabelle", scheme: "file" },
    new IsabelleSymbolCompletionProvider(),
    ...SYMBOL_TRIGGER_CHARACTERS
  );
}

function toCompletionItem(symbol: ResolvedIsabelleSymbol, range: vscode.Range): vscode.CompletionItem {
  const label: vscode.CompletionItemLabel = {
    label: symbol.name,
    detail: symbol.glyph ? `  ${symbol.glyph}` : undefined,
    description: describe(symbol)
  };
  const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Constant);
  item.insertText = symbol.name;
  item.range = range;
  item.filterText = symbolFilterText(symbol);
  item.detail = symbol.glyph ? `${symbol.glyph}  ${symbol.name}` : symbol.name;
  item.documentation = buildDocumentation(symbol);
  // Sort after any PIDE/LSP-sourced completions for the same prefix.
  item.sortText = `~isabelle-symbol~${symbol.name}`;
  return item;
}

function describe(symbol: ResolvedIsabelleSymbol): string {
  if (symbol.abbrevs.length > 0) {
    return `${symbol.group ?? "symbol"} · ${symbol.abbrevs.join(" ")}`;
  }
  return symbol.group ?? "symbol";
}

function buildDocumentation(symbol: ResolvedIsabelleSymbol): vscode.MarkdownString {
  const lines: string[] = [];
  if (symbol.glyph) {
    lines.push(`**${symbol.glyph}**  \`${symbol.name}\``);
  } else {
    lines.push(`\`${symbol.name}\` (markup symbol)`);
  }
  if (symbol.code !== null) {
    lines.push("", `Unicode \`U+${symbol.code.toString(16).toUpperCase().padStart(4, "0")}\``);
  }
  if (symbol.abbrevs.length > 0) {
    lines.push("", `Abbreviations: ${symbol.abbrevs.map((abbrev) => `\`${abbrev}\``).join(", ")}`);
  }
  return new vscode.MarkdownString(lines.join("\n"));
}

function isTheoryDocument(document: vscode.TextDocument): boolean {
  return document.languageId === "isabelle" || document.uri.fsPath.endsWith(".thy");
}
