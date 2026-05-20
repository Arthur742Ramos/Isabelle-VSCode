// Provider registry + coordinator for the optional AI-repair seam.
//
// This module defines the integration point that a third-party
// (or future first-party) AI repair provider can plug into. No
// provider ships by default — see docs/AI_REPAIR.md for the
// rationale and for the policy gate behaviour.
//
// Provider contract (deliberately small):
//   - id            stable provider identifier (the user puts this
//                   in `isabelle.repair.aiProvider`);
//   - displayName   human-readable name surfaced in the UI;
//   - generatePatch invoked with the same markdown bundle that the
//                   existing `createRepairRequest` produces; returns
//                   either a unified diff string (the existing
//                   preview command will validate it) or a typed
//                   error reason.
//
// The coordinator orchestrates one round-trip:
//   1. Read the user's settings.
//   2. Consult the safety gate.
//   3. Look up the provider.
//   4. Run it with caller-supplied timeout protection.
//   5. Return a typed result the caller can branch on.
//
// Both layers are vscode-free; tests pass in-memory providers and
// stub settings.

import {
  GateDecision,
  RepairAiSettings,
  RepairAiSettingsConfig,
  decideRepairAiGate,
  readRepairAiSettings
} from "./repairAiSettings";

export interface RepairAiRequest {
  /** Markdown bundle produced by `buildRepairRequestMarkdown`. */
  readonly requestMarkdown: string;
  /** Absolute or workspace-relative URI of the theory under repair. */
  readonly documentUri: string;
  /** TextDocument.version captured at request time. */
  readonly documentVersion: number;
  /** Captured ISO timestamp from the request bundle, for traceability. */
  readonly capturedAt: string;
}

export type RepairAiResult =
  | {
      readonly ok: true;
      /** Unified diff text to feed into the existing preview command. */
      readonly patchText: string;
      /** Optional, opaque provider id for logging / replay. */
      readonly providerRunId?: string;
    }
  | {
      readonly ok: false;
      readonly reason: string;
    };

export interface RepairAiProvider {
  readonly id: string;
  readonly displayName: string;
  generatePatch(
    request: RepairAiRequest,
    abortSignal?: AbortSignal
  ): Promise<RepairAiResult>;
}

/**
 * Registry of installed AI repair providers. Keyed by `provider.id`;
 * re-registering the same id replaces the previous provider.
 */
export class RepairAiProviderRegistry {
  private readonly providers = new Map<string, RepairAiProvider>();

  public register(provider: RepairAiProvider): RegistryDisposable {
    if (!provider.id) {
      throw new Error("RepairAiProviderRegistry.register: provider.id must be non-empty");
    }
    this.providers.set(provider.id, provider);
    return {
      dispose: () => {
        const current = this.providers.get(provider.id);
        if (current === provider) {
          this.providers.delete(provider.id);
        }
      }
    };
  }

  public list(): readonly RepairAiProvider[] {
    return Array.from(this.providers.values());
  }

  public listIds(): readonly string[] {
    return Array.from(this.providers.keys());
  }

  public get(id: string): RepairAiProvider | undefined {
    return this.providers.get(id);
  }
}

export interface RegistryDisposable {
  dispose(): void;
}

export const DEFAULT_REPAIR_AI_TIMEOUT_MS = 60_000;

export interface RepairAiAuthorizationRequest {
  readonly providerId: string;
  readonly providerDisplayName: string;
  readonly request: RepairAiRequest;
}

export interface RunRepairAiOptions {
  readonly timeoutMs?: number;
  /**
   * Last-chance policy hook invoked after the settings gate passes and before
   * the provider sees the request. UI callers use this to show the exact
   * request bundle and ask for explicit confirmation.
   */
  readonly authorizeRequest?: (
    authorization: RepairAiAuthorizationRequest
  ) => boolean | Promise<boolean>;
  /**
   * Time source for the timeout race. Pure for testability; defaults
   * to a real setTimeout / clearTimeout pair.
   */
  readonly scheduleTimeout?: (callback: () => void, ms: number) => unknown;
  readonly cancelTimeout?: (handle: unknown) => void;
}

/**
 * Read settings, consult the gate, look up the provider, and run
 * it with a timeout. Returns a typed RepairAiResult.
 *
 * Never throws. Every failure mode (no provider, ungated,
 * unknown id, provider rejection, provider throw, timeout) maps
 * to `{ ok: false, reason }`.
 */
export async function runRepairAi(
  registry: RepairAiProviderRegistry,
  settingsConfig: RepairAiSettingsConfig,
  request: RepairAiRequest,
  options: RunRepairAiOptions = {}
): Promise<RepairAiResult> {
  const settings = readRepairAiSettings(settingsConfig);
  const gate = decideRepairAiGate(settings, registry.listIds());
  if (!gate.ok) {
    return { ok: false, reason: gate.reason };
  }
  const provider = registry.get(settings.providerId);
  if (!provider) {
    // Defensive: decideRepairAiGate already validated this, but the
    // registry could mutate between the check and the lookup.
    return {
      ok: false,
      reason: `Provider "${settings.providerId}" disappeared between gate check and lookup.`
    };
  }
  if (options.authorizeRequest) {
    let authorized: boolean;
    try {
      authorized = await options.authorizeRequest({
        providerId: provider.id,
        providerDisplayName: provider.displayName,
        request
      });
    } catch (error) {
      return {
        ok: false,
        reason: `AI repair provider "${provider.id}" was not invoked because request confirmation failed: ${errorMessage(error)}`
      };
    }
    if (!authorized) {
      return {
        ok: false,
        reason: `AI repair provider "${provider.id}" was not invoked because the repair request was not confirmed.`
      };
    }
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_REPAIR_AI_TIMEOUT_MS;
  const schedule = options.scheduleTimeout ?? ((cb, ms) => setTimeout(cb, ms));
  const cancel =
    options.cancelTimeout ??
    ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  const abortController = new AbortController();
  let timeoutHandle: unknown;
  const timeout = new Promise<RepairAiResult>((resolve) => {
    timeoutHandle = schedule(() => {
      abortController.abort();
      resolve({
        ok: false,
        reason: `AI repair provider "${provider.id}" timed out after ${timeoutMs} ms.`
      });
    }, timeoutMs);
  });

  let providerOutcome: RepairAiResult;
  try {
    providerOutcome = await Promise.race([
      provider.generatePatch(request, abortController.signal),
      timeout
    ]);
  } catch (error) {
    providerOutcome = {
      ok: false,
      reason: `AI repair provider "${provider.id}" threw: ${errorMessage(error)}`
    };
  } finally {
    cancel(timeoutHandle);
  }

  return providerOutcome;
}

/** Re-export so callers can introspect the gate without importing the settings module. */
export { decideRepairAiGate, readRepairAiSettings };
export type { GateDecision, RepairAiSettings };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
