/**
 * Decide whether to start Isabelle's bundled language server at activation
 * time. Three outcomes:
 *
 *   "explicit-start"  — the user explicitly enabled `languageServer.enabled`
 *                       at some scope (user/workspace/folder). Start the
 *                       client immediately, regardless of prereq state.
 *
 *   "auto-start"      — the setting is at its package default AND the new
 *                       `languageServer.autoStart` opt-out is on (default
 *                       true) AND the prerequisite check found a usable
 *                       Java + Isabelle AND no prior auto-start attempt
 *                       failed for this exact resolved runtime. Start
 *                       silently, log a one-line note for transparency.
 *
 *   "do-not-start"    — any other case. Includes: user explicitly disabled
 *                       it, auto-start is off, prereqs missing, prior
 *                       failure on this exact runtime, or activation
 *                       happened before the prereq check finished.
 *
 * The decision is a pure function so tests can exercise every branch
 * with no `vscode` import. The caller (extension.ts) is responsible for
 * actually calling `languageClient.start()`, inspecting the resulting
 * `getStatus().state`, and persisting the failure flag.
 */

import * as crypto from "crypto";

export type LanguageServerStartupDecision = "explicit-start" | "auto-start" | "do-not-start";

export interface LanguageServerStartupInputs {
  /**
   * True when `isabelle.languageServer.enabled` is explicitly set to true at
   * any scope (user / workspace / folder). When true the LSP starts
   * regardless of every other input.
   */
  readonly explicitEnabled: boolean;
  /**
   * True when `isabelle.languageServer.enabled` is explicitly set to false
   * at any scope. When true the LSP does not start, regardless of
   * everything else.
   */
  readonly explicitDisabled: boolean;
  /**
   * Effective value of the new `isabelle.languageServer.autoStart`
   * opt-out (default true). When false the auto-start branch is off,
   * but the explicit-enable branch still works.
   */
  readonly autoStartSetting: boolean;
  /**
   * Did the activation-time `java -version` probe succeed at the
   * minimum supported version?
   */
  readonly javaOk: boolean;
  /**
   * Did the activation-time `isabelle version` probe succeed?
   */
  readonly isabelleOk: boolean;
  /**
   * True when a previous auto-start attempt for this exact resolved
   * runtime (executable path + extra args) was recorded as failed in
   * `workspaceState`. Cleared when the user changes any of those
   * settings or when a later auto-start succeeds.
   */
  readonly autoStartFailedForResolved: boolean;
}

export function decideLanguageServerStartup(inputs: LanguageServerStartupInputs): LanguageServerStartupDecision {
  if (inputs.explicitDisabled) {
    return "do-not-start";
  }
  if (inputs.explicitEnabled) {
    return "explicit-start";
  }
  if (!inputs.autoStartSetting) {
    return "do-not-start";
  }
  if (!inputs.javaOk || !inputs.isabelleOk) {
    return "do-not-start";
  }
  if (inputs.autoStartFailedForResolved) {
    return "do-not-start";
  }
  return "auto-start";
}

/**
 * Compute a stable, opaque key that identifies a specific resolved
 * Isabelle runtime (executable path + extra args). Used as the
 * `workspaceState` key under which a previous auto-start failure is
 * recorded, so that changing the configured runtime clears the flag
 * for free (lookup of the new key returns `undefined`).
 *
 * The hash is short (12 hex chars) and prefixed with
 * `isabelle.lsp.autoStartFailed.` so the keyspace stays self-describing.
 *
 * Pure: no `vscode`, no `process`, no I/O.
 */
export function computeAutoStartFailureKey(executable: string, extraArgs: readonly string[] | undefined): string {
  const args = (extraArgs ?? []).slice();
  const hash = crypto.createHash("sha256");
  hash.update(executable);
  hash.update("\u0000");
  for (const arg of args) {
    hash.update(arg);
    hash.update("\u0000");
  }
  const digest = hash.digest("hex").slice(0, 12);
  return `isabelle.lsp.autoStartFailed.${digest}`;
}
