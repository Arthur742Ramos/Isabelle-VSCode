import * as vscode from "vscode";
import {
  allMethods,
  findMethodCompletionContext,
  IsabelleMethodInfo
} from "./proofMethods";

/**
 * Offline Isabelle proof-method completion.
 *
 * When the cursor sits exactly where a proof *method name* is expected — right
 * after `apply`, `by`, or `proof`, or after a method-combinator delimiter such
 * as `(` / `,` / `|` — this offers the core HOL proof methods (`simp`, `auto`,
 * `induct`, `metis`, …) from the same curated table that powers the method
 * hover. It needs no running prover or language server, so it works the instant
 * a `.thy` file opens.
 *
 * The gate is intentionally tight (see {@link findMethodCompletionContext}): it
 * does not fire in argument position (the fact list of `apply (simp add: …)` or
 * the variable of `apply (induct …)`) nor inside a quoted inner-syntax string,
 * so it never competes with ordinary identifier completion in term position.
 */
export class IsabelleMethodCompletionProvider implements vscode.CompletionItemProvider {
  public provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.ProviderResult<vscode.CompletionList> {
    if (!isTheoryDocument(document)) {
      return undefined;
    }
    const lineText = document.lineAt(position.line).text;
    const context = findMethodCompletionContext(lineText, position.character);
    if (!context) {
      return undefined;
    }
    const range = new vscode.Range(
      new vscode.Position(position.line, context.replaceStart),
      position
    );
    const items = allMethods().map((method) => toCompletionItem(method, range));
    // isIncomplete: false — the method table is static, so VS Code filters the
    // returned set client-side as the user keeps typing without re-querying.
    return new vscode.CompletionList(items, false);
  }
}

export function registerIsabelleMethodCompletionProvider(): vscode.Disposable {
  return vscode.languages.registerCompletionItemProvider(
    { language: "isabelle", scheme: "file" },
    new IsabelleMethodCompletionProvider()
  );
}

function toCompletionItem(method: IsabelleMethodInfo, range: vscode.Range): vscode.CompletionItem {
  const item = new vscode.CompletionItem(method.name, vscode.CompletionItemKind.Method);
  item.insertText = method.name;
  item.range = range;
  item.detail = `Isabelle method · ${method.category}`;
  item.documentation = new vscode.MarkdownString(method.description);
  // Sort after this repo's symbol completions and any PIDE/LSP-sourced
  // suggestions so live data wins ties; group methods together by name.
  item.sortText = `~~~~isabelle-method~${method.name}`;
  return item;
}

function isTheoryDocument(document: vscode.TextDocument): boolean {
  return document.languageId === "isabelle" || document.uri.fsPath.endsWith(".thy");
}
