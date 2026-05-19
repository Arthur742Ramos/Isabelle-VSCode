/**
 * Pure 4-step session-id cascade for the Phase 2a
 * `document/checkWithPide` flow:
 *
 *   1. `isabelle.session.active` setting (if non-empty) wins.
 *   2. Otherwise, scan the discovered sessions. If exactly one is
 *      discovered, auto-select it and tell the caller to persist
 *      that choice as the new active session.
 *   3. Otherwise, if multiple are discovered, defer to the caller to
 *      surface a QuickPick. Returns `kind: "needs-pick"` with the
 *      candidate names.
 *   4. Otherwise (no discovered sessions, workspace has no ROOT
 *      files anywhere), tell the caller to surface a warning toast
 *      that defaults to `HOL` AND link to
 *      `Isabelle: Select Active Session`.
 *
 * Kept vscode-free so vitest pins each branch without the extension
 * host. The VS Code wiring layer reads the M2 discovery state,
 * passes it in here, and acts on the returned decision.
 */
export type SessionCascadeDecision =
  | { kind: "resolved"; session: string; source: "setting" | "single-root-auto-select" }
  | { kind: "needs-pick"; candidates: ReadonlyArray<string> }
  | { kind: "hol-fallback"; session: string; suppressFurtherWarnings: boolean };

export interface SessionCascadeInputs {
  /** Current value of `isabelle.session.active` setting (empty when unset). */
  readonly activeSessionSetting: string;
  /** Discovered session names from the existing M2 ROOT/ROOTS scan. */
  readonly discoveredSessions: ReadonlyArray<string>;
  /** Whether the user has previously seen the HOL-fallback warning
    * for this workspace (read from `workspaceState`). When true the
    * decider still returns `hol-fallback` but flags it as
    * `suppressFurtherWarnings: true` so the wiring skips the toast. */
  readonly holFallbackWarningSeen: boolean;
}

export function decideSessionCascade(inputs: SessionCascadeInputs): SessionCascadeDecision {
  const setting = inputs.activeSessionSetting.trim();
  if (setting.length > 0) {
    return { kind: "resolved", session: setting, source: "setting" };
  }

  const discovered = inputs.discoveredSessions.filter((s) => s.trim().length > 0);
  if (discovered.length === 1) {
    return { kind: "resolved", session: discovered[0], source: "single-root-auto-select" };
  }

  if (discovered.length > 1) {
    return { kind: "needs-pick", candidates: discovered.slice() };
  }

  // No ROOT files discovered. Fall back to HOL with a one-time warning.
  return {
    kind: "hol-fallback",
    session: "HOL",
    suppressFurtherWarnings: inputs.holFallbackWarningSeen
  };
}

/** Stable storage key for the "HOL fallback warning seen" workspaceState
  * record. Exposed so the VS Code wiring + tests agree on the key. */
export const SESSION_CASCADE_HOL_WARNING_KEY = "isabelle.session.holFallbackWarningSeen";
