// Settings reader + safety gate for the optional AI-repair seam.
//
// Background: the existing checked-repair workflow (PR #11) is
// strictly local — `RepairService.createRepairRequest` produces a
// markdown bundle the user reviews and pastes into whatever tool
// they trust. This module is the configuration layer for an
// optional automated path that delegates the same request to a
// caller-registered AI provider. No provider is shipped by default.
//
// Two settings:
//   - isabelle.repair.aiProvider              (string, default "")
//   - isabelle.repair.aiAcknowledgedSharing   (boolean, default false)
//
// The acknowledge flag is the safety gate: until the user explicitly
// sets it to true, the coordinator refuses to call any provider —
// even if a provider is registered AND the provider setting names
// it — so a freshly installed extension can never silently exfil
// proof context to a third-party service.
//
// The reader follows the same injectable shape as
// sledgehammerSettings.ts and is vscode-free.

export interface RepairAiSettingsConfig {
  get<T>(section: string, defaultValue: T): T;
}

export interface RepairAiSettings {
  /** Name of the registered provider to delegate to, or "" for "none". */
  readonly providerId: string;
  /** True iff the user has explicitly acknowledged the sharing policy. */
  readonly acknowledgedSharing: boolean;
}

const SETTING_PROVIDER = "repair.aiProvider";
const SETTING_ACKNOWLEDGED = "repair.aiAcknowledgedSharing";

/**
 * Read both settings from a VS Code-like configuration source.
 * Hostile or unexpected types coerce to safe defaults: non-string
 * provider IDs become "" (the documented "none" sentinel) and
 * non-boolean acknowledge flags become `false` (the safe default).
 * Provider IDs are trimmed.
 */
export function readRepairAiSettings(
  config: RepairAiSettingsConfig
): RepairAiSettings {
  const providerRaw = config.get<unknown>(SETTING_PROVIDER, "");
  const ackRaw = config.get<unknown>(SETTING_ACKNOWLEDGED, false);
  return {
    providerId:
      typeof providerRaw === "string" ? providerRaw.trim() : "",
    acknowledgedSharing: typeof ackRaw === "boolean" ? ackRaw : false
  };
}

export type GateDecision =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/**
 * Pure safety-gate check that all callers must consult before
 * invoking a registered provider. Returns a typed decision the
 * caller can surface verbatim to the user.
 *
 * The gate refuses when:
 *   - no provider id is configured ("" sentinel);
 *   - the user has not acknowledged the sharing policy;
 *   - the configured provider id is not present in the registry's
 *     list of known providers.
 *
 * If a future change wants to relax (or tighten) one of these
 * rules, this single helper is the place to do it; the coordinator
 * never inlines the logic.
 */
export function decideRepairAiGate(
  settings: RepairAiSettings,
  registeredProviderIds: readonly string[]
): GateDecision {
  if (settings.providerId.length === 0) {
    return {
      ok: false,
      reason:
        "No AI repair provider is configured. Set `isabelle.repair.aiProvider` and try again."
    };
  }
  if (!settings.acknowledgedSharing) {
    return {
      ok: false,
      reason:
        "AI repair is disabled until `isabelle.repair.aiAcknowledgedSharing` is set to true. " +
        "Enabling it lets the configured provider receive the full repair request, which may include source code, diagnostics, and proof state."
    };
  }
  if (!registeredProviderIds.includes(settings.providerId)) {
    return {
      ok: false,
      reason:
        `No AI repair provider with id "${settings.providerId}" is registered. ` +
        `Known providers: ${registeredProviderIds.length > 0 ? registeredProviderIds.map((id) => `"${id}"`).join(", ") : "none"}.`
    };
  }
  return { ok: true };
}
