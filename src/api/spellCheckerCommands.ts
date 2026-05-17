// Command wrappers for the upstream spell-checker dictionary LSP
// notifications, verified at `mirror-isabelle@ce22e9ea`
// `src/Tools/VSCode/src/lsp.scala:414-434` and the matching
// `Language_Server.update_dictionary` dispatch arms in
// `src/Tools/VSCode/src/language_server.scala:401-407`:
//
//   PIDE/include_word              -> update_dictionary(include=true,  permanent=false)
//   PIDE/include_word_permanently  -> update_dictionary(include=true,  permanent=true)
//   PIDE/exclude_word              -> update_dictionary(include=false, permanent=false)
//   PIDE/exclude_word_permanently  -> update_dictionary(include=false, permanent=true)
//   PIDE/reset_words               -> reset_dictionary()
//
// All five notifications are parameter-less. The server pulls the
// affected word from `resources.get_caret()` — the most recently
// pushed `PIDE/caret_update`. The client therefore must:
//
//   1. Send a fresh `PIDE/caret_update { uri, line, character, focus }`
//      so the server is looking at the word the user actually
//      selected (the existing background `caret_update` from the
//      sledgehammer flow may be stale and is keyed off a different
//      editor).
//   2. Send the appropriate spell-checker notification.
//
// Both notifications must arrive over the same LSP transport, so
// the helper sends them back-to-back synchronously.
//
// `reset_words` is global (no caret needed), so it bypasses the
// caret update.
//
// This module is `vscode`-free: it takes injectable client +
// active-editor + logger contracts that the production
// `IsabelleLanguageClient` and vscode wrappers satisfy
// structurally. Tests pass small in-memory stubs.

import { IsabelleLanguageServerStatus } from "../lsp/lspTypes";

export const PIDE_CARET_UPDATE_METHOD = "PIDE/caret_update";
export const PIDE_INCLUDE_WORD_METHOD = "PIDE/include_word";
export const PIDE_INCLUDE_WORD_PERMANENTLY_METHOD = "PIDE/include_word_permanently";
export const PIDE_EXCLUDE_WORD_METHOD = "PIDE/exclude_word";
export const PIDE_EXCLUDE_WORD_PERMANENTLY_METHOD = "PIDE/exclude_word_permanently";
export const PIDE_RESET_WORDS_METHOD = "PIDE/reset_words";

export const INCLUDE_WORD_COMMAND_ID = "isabelle.includeWord";
export const INCLUDE_WORD_PERMANENTLY_COMMAND_ID = "isabelle.includeWordPermanently";
export const EXCLUDE_WORD_COMMAND_ID = "isabelle.excludeWord";
export const EXCLUDE_WORD_PERMANENTLY_COMMAND_ID = "isabelle.excludeWordPermanently";
export const RESET_WORDS_COMMAND_ID = "isabelle.resetWords";

export interface SpellCheckerCaretEditor {
  readonly uri: string;
  readonly isTheoryDocument: boolean;
  readonly line: number;
  readonly character: number;
}

export interface SpellCheckerClient {
  sendNotification(method: string, params?: unknown): void;
}

export interface SpellCheckerLspStatusReader {
  getStatus(): IsabelleLanguageServerStatus;
}

export interface SpellCheckerLogger {
  appendLine(message: string): void;
}

export interface SpellCheckerUi {
  getActiveEditor(): SpellCheckerCaretEditor | undefined;
  showInformationMessage(message: string): Promise<unknown>;
}

export type SpellCheckerWordAction =
  | "include"
  | "include-permanently"
  | "exclude"
  | "exclude-permanently";

const WORD_METHODS: Record<SpellCheckerWordAction, string> = {
  include: PIDE_INCLUDE_WORD_METHOD,
  "include-permanently": PIDE_INCLUDE_WORD_PERMANENTLY_METHOD,
  exclude: PIDE_EXCLUDE_WORD_METHOD,
  "exclude-permanently": PIDE_EXCLUDE_WORD_PERMANENTLY_METHOD
};

export interface SpellCheckerWordResult {
  /** Did we actually dispatch the request? */
  readonly dispatched: boolean;
  /** Method name we dispatched (only set when dispatched is true). */
  readonly method?: string;
  /** Failure reason when dispatched is false — also surfaced to the user. */
  readonly reason?:
    | "lsp-not-running"
    | "no-editor"
    | "not-theory-document"
    | "client-error";
}

/**
 * Send a `PIDE/include_word`-family notification for the word at the
 * active caret position. Returns a structured result so callers /
 * tests can assert behavior without spying on the UI.
 *
 * Pre-conditions checked in order:
 *   1. LSP must be `running`. Otherwise the helper surfaces an info
 *      message and returns `dispatched: false`.
 *   2. There must be an active editor. Otherwise info + return.
 *   3. The active editor must be an Isabelle theory document.
 *      Otherwise info + return.
 *
 * On success the helper sends `PIDE/caret_update { uri, line,
 * character, focus: true }` followed immediately by the chosen
 * spell-checker notification.
 */
export async function dispatchSpellCheckerWord(
  action: SpellCheckerWordAction,
  client: SpellCheckerClient,
  lspStatus: SpellCheckerLspStatusReader,
  ui: SpellCheckerUi,
  logger: SpellCheckerLogger
): Promise<SpellCheckerWordResult> {
  if (lspStatus.getStatus().state !== "running") {
    await ui.showInformationMessage(
      "Isabelle spell-checker dictionary commands require the Isabelle language server. Enable it via `isabelle.languageServer.enabled` or run `Isabelle: Start Language Server`."
    );
    return { dispatched: false, reason: "lsp-not-running" };
  }
  const editor = ui.getActiveEditor();
  if (!editor) {
    await ui.showInformationMessage(
      "Open an Isabelle theory before running the spell-checker dictionary commands."
    );
    return { dispatched: false, reason: "no-editor" };
  }
  if (!editor.isTheoryDocument) {
    await ui.showInformationMessage(
      "Isabelle spell-checker dictionary commands only apply to `.thy` files."
    );
    return { dispatched: false, reason: "not-theory-document" };
  }
  const method = WORD_METHODS[action];
  try {
    client.sendNotification(PIDE_CARET_UPDATE_METHOD, {
      uri: editor.uri,
      line: editor.line,
      character: editor.character,
      focus: true
    });
    client.sendNotification(method);
    return { dispatched: true, method };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.appendLine(
      `Isabelle spell-checker: failed to dispatch ${method}: ${message}`
    );
    return { dispatched: false, reason: "client-error" };
  }
}

/**
 * Send `PIDE/reset_words`. Unlike the include/exclude commands this
 * one is global — the server `reset_dictionary` does not consult
 * the caret — so the helper does NOT push a caret update first.
 */
export async function dispatchResetWords(
  client: SpellCheckerClient,
  lspStatus: SpellCheckerLspStatusReader,
  ui: SpellCheckerUi,
  logger: SpellCheckerLogger
): Promise<SpellCheckerWordResult> {
  if (lspStatus.getStatus().state !== "running") {
    await ui.showInformationMessage(
      "Isabelle spell-checker dictionary commands require the Isabelle language server. Enable it via `isabelle.languageServer.enabled` or run `Isabelle: Start Language Server`."
    );
    return { dispatched: false, reason: "lsp-not-running" };
  }
  try {
    client.sendNotification(PIDE_RESET_WORDS_METHOD);
    return { dispatched: true, method: PIDE_RESET_WORDS_METHOD };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.appendLine(
      `Isabelle spell-checker: failed to dispatch ${PIDE_RESET_WORDS_METHOD}: ${message}`
    );
    return { dispatched: false, reason: "client-error" };
  }
}
