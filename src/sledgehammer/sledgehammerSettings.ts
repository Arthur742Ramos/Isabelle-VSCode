// Settings reader for the `isabelle.sledgehammer.*` configuration block.
//
// The settings shipped here describe the three knobs exposed by the
// upstream `PIDE/sledgehammer_request` LSP notification — see
// docs/sledgehammer_lsp_research.md for the message shape — plus a
// helper that resolves the configured prover list against an optional
// fallback (typically the cached `PIDE/sledgehammer_provers_response`).
//
// The module deliberately keeps the reader injectable so it can be
// exercised in unit tests without spinning up a VS Code workspace or
// mocking the `vscode` namespace. Production callers pass
// `vscode.workspace.getConfiguration("isabelle")`; tests pass a small
// stub matching `SledgehammerSettingsConfig`.
//
// Nothing in this module talks to the language client. Wiring the
// resolved request params into `SledgehammerPanel`'s LSP-mode branch
// (research recommendation #2) is intentionally deferred to a follow-up
// PR so this groundwork can be reviewed on its own merits.

/** Minimal contract this module needs from a settings source. */
export interface SledgehammerSettingsConfig {
  get<T>(section: string, defaultValue: T): T;
}

/** Snapshot of the three `isabelle.sledgehammer.*` settings. */
export interface SledgehammerSettings {
  /**
   * Space-separated prover list. Empty string means "no user override —
   * fall back to the LSP-cached prover list or the server defaults".
   */
  readonly provers: string;
  /** When true, request Isar-style structured proofs (proof ... qed). */
  readonly isar: boolean;
  /** When true, allow the standard `try0` tactics before/around external provers. */
  readonly try0: boolean;
}

/**
 * Parameters that will be forwarded to the upstream
 * `PIDE/sledgehammer_request` LSP notification. The provers string is
 * trimmed and whitespace-normalized (multiple spaces collapse to one).
 */
export interface PideSledgehammerRequestParams {
  readonly provers: string;
  readonly isar: boolean;
  readonly try0: boolean;
}

const SETTING_PROVERS = "sledgehammer.provers";
const SETTING_ISAR = "sledgehammer.isar";
const SETTING_TRY0 = "sledgehammer.try0";

/**
 * Read the `isabelle.sledgehammer.*` settings from a VS Code-like
 * configuration source. Hostile or unexpected types are coerced to
 * safe defaults: a non-string `provers` value becomes an empty string,
 * and non-boolean isar/try0 values fall back to their schema defaults
 * (false and true respectively).
 */
export function readSledgehammerSettings(
  config: SledgehammerSettingsConfig
): SledgehammerSettings {
  const proversRaw = config.get<unknown>(SETTING_PROVERS, "");
  const isarRaw = config.get<unknown>(SETTING_ISAR, false);
  const try0Raw = config.get<unknown>(SETTING_TRY0, true);

  return {
    provers: normalizeProversString(typeof proversRaw === "string" ? proversRaw : ""),
    isar: typeof isarRaw === "boolean" ? isarRaw : false,
    try0: typeof try0Raw === "boolean" ? try0Raw : true
  };
}

/**
 * Normalize a raw provers string: trim, collapse interior whitespace
 * runs to single spaces, drop empty tokens. The result is either an
 * empty string (caller falls back) or a clean space-separated list
 * safe to forward to `PIDE/sledgehammer_request`.
 */
export function normalizeProversString(raw: string): string {
  if (typeof raw !== "string" || raw.length === 0) {
    return "";
  }
  return raw
    .split(/\s+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .join(" ");
}

/**
 * Resolve the prover string the extension should forward to upstream:
 *   - if the user has configured a non-empty `isabelle.sledgehammer.provers`,
 *     use that;
 *   - otherwise fall back to the supplied cached list (typically the
 *     latest `PIDE/sledgehammer_provers_response.provers`);
 *   - otherwise return an empty string, letting the server pick.
 *
 * Both inputs are normalized through `normalizeProversString` so
 * downstream consumers never see ragged whitespace.
 */
export function resolveSledgehammerProvers(
  configured: string,
  fallback: string | undefined = ""
): string {
  const normalizedConfigured = normalizeProversString(configured);
  if (normalizedConfigured.length > 0) {
    return normalizedConfigured;
  }
  return normalizeProversString(fallback ?? "");
}

/**
 * Build the params object that will be sent as
 * `PIDE/sledgehammer_request`. The settings supply isar and try0
 * directly; provers are resolved against the supplied fallback (which
 * the caller — typically the future provers cache — will populate from
 * `PIDE/sledgehammer_provers_response`).
 */
export function buildPideSledgehammerRequestParams(
  settings: SledgehammerSettings,
  fallbackProvers: string | undefined = ""
): PideSledgehammerRequestParams {
  return {
    provers: resolveSledgehammerProvers(settings.provers, fallbackProvers),
    isar: settings.isar,
    try0: settings.try0
  };
}
