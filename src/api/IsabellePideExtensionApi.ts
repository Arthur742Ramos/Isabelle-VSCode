// Public extension API surface for `arthur742ramos.isabelle-pide-vscode`.
//
// Third-party VS Code extensions can retrieve this object via:
//
//   const isabelle = vscode.extensions.getExtension(
//     "arthur742ramos.isabelle-pide-vscode"
//   );
//   await isabelle?.activate();
//   const api: IsabellePideExtensionApi | undefined = isabelle?.exports;
//   if (api && api.version === "1") {
//     api.registerRepairAiProvider({ ... });
//   }
//
// Stability contract: every shape exported here is part of the
// extension's public API and follows semantic-version-like
// compatibility. The `version` field is the canonical compat check;
// it bumps whenever this file changes in a non-additive way.
//
// As of this PR, the only surface is provider registration for the
// AI repair seam (see docs/AI_REPAIR.md). The seam is intentionally
// narrow: we want third parties to register providers, not to reach
// into the rest of the extension.
//
// This module is vscode-free; the production wiring constructs an
// instance from inside `extension.ts` and returns it from
// `activate()`.

import type {
  RepairAiProvider,
  RepairAiProviderRegistry
} from "../repair/repairAiProvider";
import type { RepairAiSecretStore } from "../repair/RepairAiSecretStore";

/** Disposable contract — structurally compatible with vscode.Disposable. */
export interface IsabellePideApiDisposable {
  dispose(): void;
}

/** Stable v1 surface. */
export interface IsabellePideExtensionApiV1 {
  /** Canonical compat tag. Bump in a non-additive change. */
  readonly version: "1";
  /**
   * Register an AI repair provider that the
   * `Isabelle: Request AI Repair Suggestion` command can delegate
   * to. The returned disposable removes the registration; it is
   * the third-party extension's responsibility to call dispose on
   * deactivation. Throws if `provider.id` is empty (the registry
   * uses ids as keys).
   *
   * See docs/AI_REPAIR.md for the provider contract and the
   * acknowledged-sharing safety gate that always sits in front of
   * any invocation.
   */
  registerRepairAiProvider(
    provider: RepairAiProvider
  ): IsabellePideApiDisposable;
  /**
   * Read-only snapshot of currently registered provider ids,
   * useful for diagnostics or for a host extension that wants to
   * surface which providers are available.
   */
  listRepairAiProviderIds(): readonly string[];
  /**
   * Get the credential store keyed by provider id. Providers should
   * use `await api.getRepairAiSecretStore().get(provider.id)` rather
   * than reading workspace settings, so secrets never land in
   * settings.json. See docs/AI_REPAIR.md.
   */
  getRepairAiSecretStore(): RepairAiSecretStore;
}

/** Re-exported here for typed-consumer convenience. */
export type { RepairAiProvider } from "../repair/repairAiProvider";

/** Stable alias that always points at the latest API version. */
export type IsabellePideExtensionApi = IsabellePideExtensionApiV1;

/**
 * Build the public API object that `activate()` returns. The factory
 * keeps the construction pure so unit tests can verify the surface
 * shape against a stub registry without spinning up vscode.
 */
export function createIsabellePideExtensionApi(
  registry: RepairAiProviderRegistry,
  secretStore: RepairAiSecretStore
): IsabellePideExtensionApi {
  return {
    version: "1",
    registerRepairAiProvider(provider) {
      return registry.register(provider);
    },
    listRepairAiProviderIds() {
      return registry.listIds();
    },
    getRepairAiSecretStore() {
      return secretStore;
    }
  };
}
