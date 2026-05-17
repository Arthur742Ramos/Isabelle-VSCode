// Command implementation for `Isabelle: Browse Isabelle Documentation`.
//
// Reads the cached `PIDE/documentation_response` table maintained by
// `PideDocumentationCache`, shows a quick-pick organised by section
// (Tutorial / Isar-Ref / etc. surface first because Isabelle marks
// them as `important: true`), and opens the selected entry's
// `platform_path` with the OS's default application.
//
// Behaviour when the cache is empty depends on the language server
// state:
//   - LSP not `running`: surfaces an informational message telling
//     the user to enable the LSP relay.
//   - LSP `running` but cache empty: triggers a fresh
//     `PIDE/documentation_request` and surfaces a "loading" message.
//
// The module is intentionally `vscode`-free: it accepts an
// injectable `ShowDocumentationUi` shape that the extension's
// activation wires to the real `vscode.window.showQuickPick` /
// `vscode.env.openExternal` pair. The tests pass small fakes.

import {
  PideDocumentationCache,
  PideDocumentationQuickPickItem,
  flattenDocumentationForQuickPick
} from "./PideDocumentationCache";
import { IsabelleLanguageServerStatus } from "../lsp/lspTypes";

export interface ShowDocumentationLspStatusReader {
  getStatus(): IsabelleLanguageServerStatus;
}

export interface ShowDocumentationLogger {
  appendLine(message: string): void;
}

export interface ShowDocumentationQuickPickItem {
  readonly label: string;
  readonly description?: string;
  readonly detail?: string;
  readonly entry: PideDocumentationQuickPickItem;
}

export interface ShowDocumentationQuickPickOptions {
  readonly placeHolder?: string;
  readonly matchOnDescription?: boolean;
  readonly matchOnDetail?: boolean;
}

export interface ShowDocumentationUi {
  showQuickPick(
    items: readonly ShowDocumentationQuickPickItem[],
    options?: ShowDocumentationQuickPickOptions
  ): Promise<ShowDocumentationQuickPickItem | undefined>;
  showInformationMessage(message: string): Promise<unknown>;
  showWarningMessage(message: string): Promise<unknown>;
  /** Open a local file via the OS's default association. Returns true on success. */
  openExternalFile(platformPath: string): Promise<boolean>;
}

export const SHOW_DOCUMENTATION_COMMAND_ID = "isabelle.browseDocumentation";

export async function browseIsabelleDocumentation(
  cache: PideDocumentationCache,
  lspStatus: ShowDocumentationLspStatusReader,
  logger: ShowDocumentationLogger,
  ui: ShowDocumentationUi
): Promise<void> {
  const state = lspStatus.getStatus().state;
  if (state !== "running") {
    await ui.showInformationMessage(
      "Isabelle documentation is only available when the Isabelle language server is running. Enable it via `isabelle.languageServer.enabled` or run `Isabelle: Start Language Server`."
    );
    return;
  }
  const sections = cache.getSections();
  if (sections.length === 0) {
    cache.refresh();
    await ui.showInformationMessage(
      "Isabelle documentation is loading from the language server. Try the command again in a moment."
    );
    return;
  }
  const flattened = flattenDocumentationForQuickPick(sections);
  if (flattened.length === 0) {
    await ui.showWarningMessage(
      "The Isabelle language server returned no documentation entries."
    );
    return;
  }
  const items: ShowDocumentationQuickPickItem[] = flattened.map((entry) => ({
    label: entry.label,
    description: entry.important ? `${entry.section}  ★` : entry.section,
    detail: entry.platformPath,
    entry
  }));
  const picked = await ui.showQuickPick(items, {
    placeHolder: "Select an Isabelle documentation entry to open",
    matchOnDescription: true,
    matchOnDetail: true
  });
  if (!picked) return;
  try {
    const opened = await ui.openExternalFile(picked.entry.platformPath);
    if (!opened) {
      await ui.showWarningMessage(
        `Failed to open ${picked.entry.label} (${picked.entry.platformPath}).`
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.appendLine(
      `Isabelle documentation: openExternal(${picked.entry.platformPath}) failed: ${message}`
    );
    await ui.showWarningMessage(
      `Failed to open ${picked.entry.label}: ${message}`
    );
  }
}
