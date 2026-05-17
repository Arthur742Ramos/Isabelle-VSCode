// Built-in "manual paste-back" AI repair provider.
//
// Background: the AI repair seam (PRs #44, #46, #47) defines a
// provider contract but ships no default provider — calling any
// third-party AI service automatically violates the project's
// no-silent-data-sharing rule. This module ships a provider that
// satisfies the contract WITHOUT making any network call: it copies
// the request to the clipboard so the user can paste it into
// whatever AI tool they trust, then waits for the user to point at
// a .patch file with the response.
//
// Why ship it: it makes the "Request AI Repair Suggestion" command
// useful by default. Users who turn on `isabelle.repair.aiProvider
// = "manual-paste-back"` and acknowledge the sharing policy get a
// guided round-trip without any network call from the extension.
// Acknowledging is still required because the user IS sharing the
// request with an external tool — the extension just isn't the one
// transmitting it.
//
// The provider is vscode-aware, but all vscode interactions are
// behind an injectable `ManualPasteBackHost` so the whole module
// can be unit-tested without spinning up the workbench.

import { RepairAiProvider, RepairAiRequest, RepairAiResult } from "./repairAiProvider";

/** Stable id matching the value users put in `isabelle.repair.aiProvider`. */
export const MANUAL_PASTE_BACK_PROVIDER_ID = "manual-paste-back";

export const MANUAL_PASTE_BACK_DISPLAY_NAME = "Manual paste-back (no network)";

/** All vscode interactions the provider needs. Injectable for tests. */
export interface ManualPasteBackHost {
  /** Place text on the user's clipboard. */
  writeClipboard(text: string): Promise<void>;
  /**
   * Surface an information message and wait for the user to either
   * dismiss it or click one of the supplied action labels. Returns
   * the clicked action label, or `undefined` if dismissed.
   */
  showInformationMessage(
    message: string,
    ...actions: readonly string[]
  ): Promise<string | undefined>;
  /**
   * Open a file picker scoped to .patch / .diff. Returns the chosen
   * path or `undefined` if cancelled.
   */
  showPatchOpenDialog(): Promise<string | undefined>;
  /** Read a UTF-8 text file from disk. */
  readTextFile(path: string): Promise<string>;
}

/** Label of the "Open patch file..." action surfaced after the prompt. */
export const MANUAL_PASTE_BACK_OPEN_ACTION = "Open patch file...";
/** Label of the "Cancel" action. */
export const MANUAL_PASTE_BACK_CANCEL_ACTION = "Cancel";

/**
 * Build the multi-line information-message prompt the provider
 * shows after copying the request to the clipboard. Includes the
 * captured-at timestamp so the user can confirm which request the
 * patch they paste back corresponds to.
 */
export function buildManualPasteBackPrompt(request: RepairAiRequest): string {
  return (
    `Checked repair request for ${request.documentUri} (v${request.documentVersion}, captured ${request.capturedAt}) ` +
    "has been copied to the clipboard. Paste it into your AI tool, save the response as a .patch / .diff file, " +
    `then click "${MANUAL_PASTE_BACK_OPEN_ACTION}" to point us at it. The patch will be validated by the existing ` +
    "previewRepairPatch pipeline before any edit is applied — no auto-apply."
  );
}

/**
 * Concrete `RepairAiProvider` implementation. Construct one with
 * a `ManualPasteBackHost` in `extension.ts`; the production host
 * wraps `vscode.env.clipboard`, `vscode.window.showInformationMessage`,
 * `vscode.window.showOpenDialog`, and `fs.promises.readFile`.
 */
export class ManualPasteBackRepairAiProvider implements RepairAiProvider {
  public readonly id = MANUAL_PASTE_BACK_PROVIDER_ID;
  public readonly displayName = MANUAL_PASTE_BACK_DISPLAY_NAME;

  public constructor(private readonly host: ManualPasteBackHost) {}

  public async generatePatch(
    request: RepairAiRequest,
    abortSignal?: AbortSignal
  ): Promise<RepairAiResult> {
    if (abortSignal?.aborted) {
      return { ok: false, reason: "Aborted before manual paste-back started." };
    }

    try {
      await this.host.writeClipboard(request.requestMarkdown);
    } catch (error) {
      return {
        ok: false,
        reason: `Manual paste-back: clipboard write failed: ${errorMessage(error)}`
      };
    }

    if (abortSignal?.aborted) {
      return { ok: false, reason: "Aborted while preparing the prompt." };
    }

    let action: string | undefined;
    try {
      action = await this.host.showInformationMessage(
        buildManualPasteBackPrompt(request),
        MANUAL_PASTE_BACK_OPEN_ACTION,
        MANUAL_PASTE_BACK_CANCEL_ACTION
      );
    } catch (error) {
      return {
        ok: false,
        reason: `Manual paste-back: prompt failed: ${errorMessage(error)}`
      };
    }

    if (abortSignal?.aborted) {
      return { ok: false, reason: "Aborted after the prompt was shown." };
    }
    if (action === undefined || action === MANUAL_PASTE_BACK_CANCEL_ACTION) {
      return {
        ok: false,
        reason: "Manual paste-back: cancelled before a patch file was chosen."
      };
    }
    if (action !== MANUAL_PASTE_BACK_OPEN_ACTION) {
      return {
        ok: false,
        reason: `Manual paste-back: unexpected action "${action}"; cancelling.`
      };
    }

    let patchPath: string | undefined;
    try {
      patchPath = await this.host.showPatchOpenDialog();
    } catch (error) {
      return {
        ok: false,
        reason: `Manual paste-back: file picker failed: ${errorMessage(error)}`
      };
    }
    if (!patchPath) {
      return {
        ok: false,
        reason: "Manual paste-back: no patch file chosen."
      };
    }

    if (abortSignal?.aborted) {
      return { ok: false, reason: "Aborted after the patch file was chosen." };
    }

    let patchText: string;
    try {
      patchText = await this.host.readTextFile(patchPath);
    } catch (error) {
      return {
        ok: false,
        reason: `Manual paste-back: unable to read ${patchPath}: ${errorMessage(error)}`
      };
    }
    if (patchText.trim().length === 0) {
      return {
        ok: false,
        reason: `Manual paste-back: ${patchPath} was empty.`
      };
    }

    return {
      ok: true,
      patchText,
      providerRunId: `${MANUAL_PASTE_BACK_PROVIDER_ID}:${request.capturedAt}`
    };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
