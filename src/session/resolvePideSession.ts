import * as vscode from "vscode";
import { decideSessionCascade } from "./sessionCascade";

/**
 * Side-effecty wrapper around the pure {@link decideSessionCascade} that
 * resolves the active PIDE session for any backend command that needs one
 * (the 4-step cascade: setting → single-root auto-select → quickpick →
 * `HOL` fallback with one-time warning).
 *
 * Lives next to vscode-coupled callers because the helper itself is
 * deliberately vscode-coupled — it persists the auto-selected session via
 * `WorkspaceConfiguration.update`, drives a quickpick when multiple roots
 * are discovered, and shows the HOL-fallback warning toast. The pure
 * cascade decision stays in {@link decideSessionCascade}; this helper only
 * adds the UX side-effects.
 *
 * Tested via injected fakes so vitest can pin every branch without a
 * vscode import.
 */

/** Options surface needed for the persist call when a session is
  * auto-selected from a single discovered ROOT, OR when the user picks
  * one from the quickpick. Matches the `update` shape of
  * `WorkspaceConfiguration` so callers can pass a real vscode config
  * straight through. */
export interface ResolvePideSessionConfigSink {
  readonly update: (
    section: string,
    value: unknown,
    target: vscode.ConfigurationTarget
  ) => Promise<void> | Thenable<void>;
}

export interface ResolvePideSessionDeps {
  /** Current value of `isabelle.session.active` (empty when unset). */
  readonly activeSessionSetting: string;
  /** Discovered session names from the existing M2 ROOT/ROOTS scan. */
  readonly discoveredSessions: ReadonlyArray<string>;
  /** Read the "HOL fallback warning has been seen for this workspace"
    * flag from `workspaceState`. */
  readonly getHolWarningSeen: () => boolean;
  /** Persist the "HOL fallback warning has been seen for this workspace"
    * flag to `workspaceState`. Called only when the user clicks
    * "Don't show again" on the warning dialog. */
  readonly setHolWarningSeen: (value: boolean) => Promise<void>;
  /** Persist the resolved session into the `isabelle.session.active`
    * setting. Called when the cascade auto-selects from a single root OR
    * the user picks from a multi-session quickpick. */
  readonly persistActiveSession: (session: string) => Promise<void>;
  /** Show the multi-session quickpick. Returns the selected entry or
    * `undefined` when the user dismisses. */
  readonly showQuickPick: (
    items: ReadonlyArray<string>,
    options: vscode.QuickPickOptions
  ) => Promise<string | undefined> | Thenable<string | undefined>;
  /** Show the HOL-fallback warning toast. Returns the action label the
    * user clicked, or `undefined` if they dismissed. */
  readonly showWarningMessage: (
    message: string,
    ...actions: string[]
  ) => Promise<string | undefined> | Thenable<string | undefined>;
  /** Dispatch a VS Code command (e.g. `isabelle.selectSession`) when the
    * user clicks "Select Active Session" on the HOL-fallback warning. */
  readonly executeCommand: (command: string) => Promise<void> | Thenable<void>;
}

export type ResolvePideSessionOutcome =
  | { kind: "resolved"; session: string }
  | { kind: "cancelled" };

/**
 * Resolve the PIDE session for a backend-bound command following the
 * 4-step cascade. Returns `{ kind: "cancelled" }` when the user dismisses
 * the quickpick that the cascade surfaced for a multi-session workspace.
 *
 * Side-effects (all driven through `deps`):
 *  - When the cascade auto-selects from a single discovered ROOT, the
 *    chosen session name is persisted via `persistActiveSession` so
 *    subsequent commands hit the cascade's "step 1" (setting wins) path
 *    instead of repeating the auto-select.
 *  - When the cascade reports `needs-pick`, the quickpick is shown; if
 *    the user picks, the choice is persisted via `persistActiveSession`.
 *  - When the cascade reports `hol-fallback` and the warning has not yet
 *    been seen, the warning toast is shown with "Select Active Session"
 *    and "Don't show again" actions. The "Don't show again" click sets
 *    the workspace-state flag via `setHolWarningSeen`.
 */
export async function resolvePideSession(
  deps: ResolvePideSessionDeps
): Promise<ResolvePideSessionOutcome> {
  const decision = decideSessionCascade({
    activeSessionSetting: deps.activeSessionSetting,
    discoveredSessions: deps.discoveredSessions,
    holFallbackWarningSeen: deps.getHolWarningSeen()
  });

  switch (decision.kind) {
    case "resolved": {
      if (decision.source === "single-root-auto-select") {
        await deps.persistActiveSession(decision.session);
      }
      return { kind: "resolved", session: decision.session };
    }
    case "needs-pick": {
      const pick = await deps.showQuickPick(decision.candidates.slice(), {
        title: "Select an Isabelle session for the PIDE check",
        placeHolder: "Multiple sessions discovered — pick one (persisted as the active session)"
      });
      if (!pick) {
        return { kind: "cancelled" };
      }
      await deps.persistActiveSession(pick);
      return { kind: "resolved", session: pick };
    }
    case "hol-fallback": {
      if (!decision.suppressFurtherWarnings) {
        const action = await deps.showWarningMessage(
          "No Isabelle ROOT files discovered in this workspace. Defaulting to the `HOL` session for this PIDE check.",
          "Select Active Session",
          "Don't show again"
        );
        if (action === "Select Active Session") {
          await deps.executeCommand("isabelle.selectSession");
        } else if (action === "Don't show again") {
          await deps.setHolWarningSeen(true);
        }
      }
      return { kind: "resolved", session: decision.session };
    }
  }
}
