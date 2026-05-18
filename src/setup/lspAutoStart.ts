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
   * True when the user has explicitly set
   * `isabelle.languageServer.enabled` at any scope (user / workspace /
   * folder), i.e. `inspect()` returned a non-undefined value at one of
   * `globalValue` / `workspaceValue` / `workspaceFolderValue`. When
   * false the setting is still at its package default and the
   * auto-start branch is allowed to run.
   */
  readonly userExplicitlySet: boolean;
  /**
   * The effective resolved value of `isabelle.languageServer.enabled`
   * for the active resource, computed via VS Code's normal scope
   * precedence (folder > workspace > user > default). Only consulted
   * when `userExplicitlySet` is true; this is what guarantees we honor
   * the same precedence that `getConfiguration("isabelle").get(...)`
   * uses everywhere else in the extension (e.g. the
   * `onDidChangeConfiguration` toggle handler).
   */
  readonly effectiveEnabled: boolean;
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
  if (inputs.userExplicitlySet) {
    // The user has touched the setting somewhere. Honor VS Code's
    // normal scope precedence (folder > workspace > user) by using the
    // effective resolved value the caller looked up via `.get(...)`.
    // This matches every other code path in the extension that reads
    // the same setting (e.g. the `onDidChangeConfiguration` handler in
    // `extension.ts`), so activation and a later toggle behave the
    // same way for the same user.
    return inputs.effectiveEnabled ? "explicit-start" : "do-not-start";
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
/**
 * Decide whether an auto-start attempt should be recorded as a failure.
 *
 * Two failure modes need to be combined into one boolean:
 *
 *   1. The `languageClient.start()` call itself threw. The internal
 *      `doStart()` swallows reach-check and spawn errors and transitions
 *      to `"failed"`, but any other throw (programming error, OOM,
 *      transport setup failure before the first state transition, …)
 *      can bubble out with the client's state still at `"starting"` or
 *      `"disabled"`. We must treat that as a failure too — otherwise
 *      the silent throw would be retried on every activation.
 *
 *   2. `start()` returned cleanly but `getStatus().state` is `"failed"`,
 *      i.e. `doStart()` caught the error internally and transitioned.
 *
 * Pure: no `vscode`, no I/O. Caller wires this into the auto-start
 * outcome branch in `extension.ts`.
 */
export function autoStartOutcomeIsFailure(threw: boolean, statusState: string): boolean {
  return threw || statusState === "failed";
}

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
