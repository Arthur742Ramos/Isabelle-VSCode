// Completion provider backed by the cached `PIDE/abbrevs_response`
// table. When the optional Isabelle language server is `running`,
// the `PideAbbrevsCache` (companion module) listens for the upstream
// abbreviation list and populates a synchronous lookup table. This
// provider walks backwards from the cursor to find the longest typed
// prefix that begins at least one cached abbreviation, then returns
// the matching expansions as completion items with the prefix as the
// replacement range.
//
// Coexistence with the LSP completion provider:
//   - When the LSP is `running`, `vscode-languageclient` auto-registers
//     a textDocument/completion provider against the same Isabelle
//     documentSelector (see test/lsp/featureCoexistence.test.ts).
//   - This abbrevs provider is ADDITIVE: VS Code aggregates results
//     from both providers and the abbrev expansions appear inline with
//     PIDE-sourced suggestions. The two paths do not race because
//     this provider only emits items when the user has typed a prefix
//     that matches at least one known abbreviation.
//   - When the LSP is not `running`, the cache is empty and this
//     provider returns no items, so there's no fallback path that
//     surfaces stale data.
//
// The provider re-registers itself every time the cache reports a
// fresh `PIDE/abbrevs_response` because VS Code captures the trigger
// character set at registration time. The first registration after
// LSP `running` uses the precomputed trigger set; later refreshes
// update it.

import * as vscode from "vscode";
import {
  PideAbbrev,
  PideAbbrevsCache,
  findPideAbbrevPrefixMatch
} from "./PideAbbrevsCache";

export const PIDE_ABBREV_COMPLETION_LANGUAGE_FILTER: vscode.DocumentFilter = {
  scheme: "file",
  language: "isabelle"
};

/**
 * The completion-provider portion. The `register` entry point owns
 * the lifecycle (initial registration plus re-registration on cache
 * updates) so callers don't have to manage two layered subscriptions.
 */
export class PideAbbrevsCompletionProvider implements vscode.CompletionItemProvider {
  public constructor(private readonly cache: PideAbbrevsCache) {}

  public provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.ProviderResult<vscode.CompletionItem[]> {
    if (!isTheoryDocument(document)) return [];
    const abbrevs = this.cache.getAbbrevs();
    if (abbrevs.length === 0) return [];
    const lineText = document.lineAt(position.line).text;
    const match = findPideAbbrevPrefixMatch(abbrevs, lineText, position.character);
    if (!match) return [];
    const replaceRange = new vscode.Range(
      new vscode.Position(position.line, match.start),
      position
    );
    return match.matches.map((entry) => toCompletionItem(entry, replaceRange));
  }
}

/**
 * Register the abbrevs completion provider with VS Code, including
 * re-registering whenever the cache reports a fresh abbreviation
 * list (so the trigger character set stays in sync with the server's
 * actual abbreviations rather than being frozen at activation time).
 */
export function registerPideAbbrevsCompletionProvider(
  cache: PideAbbrevsCache
): vscode.Disposable {
  let providerSubscription: vscode.Disposable | undefined =
    registerWithCurrentTriggers(cache);
  const cacheSubscription = cache.onDidUpdate(() => {
    providerSubscription?.dispose();
    providerSubscription = registerWithCurrentTriggers(cache);
  });
  return new vscode.Disposable(() => {
    cacheSubscription.dispose();
    providerSubscription?.dispose();
    providerSubscription = undefined;
  });
}

function registerWithCurrentTriggers(cache: PideAbbrevsCache): vscode.Disposable {
  const triggers = cache.getTriggerCharacters();
  return vscode.languages.registerCompletionItemProvider(
    PIDE_ABBREV_COMPLETION_LANGUAGE_FILTER,
    new PideAbbrevsCompletionProvider(cache),
    ...triggers
  );
}

function toCompletionItem(
  entry: PideAbbrev,
  range: vscode.Range
): vscode.CompletionItem {
  const item = new vscode.CompletionItem(entry.expansion, vscode.CompletionItemKind.Snippet);
  item.detail = `Isabelle abbrev: ${entry.abbrev}`;
  item.filterText = entry.abbrev;
  item.insertText = entry.expansion;
  item.range = range;
  item.documentation = new vscode.MarkdownString(
    `Replaces \`${escapeMarkdown(entry.abbrev)}\` with \`${escapeMarkdown(entry.expansion)}\` (from \`PIDE/abbrevs_response\`).`
  );
  // Lower priority than the LSP's own completion items so that
  // PIDE-sourced identifier completions appear above the bulk
  // symbol-abbreviation list when both match the same typed prefix.
  item.sortText = `~~abbrev~${entry.abbrev}`;
  return item;
}

function isTheoryDocument(document: vscode.TextDocument): boolean {
  return document.languageId === "isabelle" || document.uri.fsPath.endsWith(".thy");
}

function escapeMarkdown(value: string): string {
  return value.replace(/`/g, "\\`");
}
