import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RepairAiProvider,
  RepairAiProviderRegistry,
  RepairAiRequest,
  RepairAiResult,
  runRepairAi
} from "../../src/repair/repairAiProvider";
import { RepairAiSettingsConfig } from "../../src/repair/repairAiSettings";

const REQUEST: RepairAiRequest = {
  requestMarkdown: "# request",
  documentUri: "file:///workspace/Demo.thy",
  documentVersion: 7,
  capturedAt: "2026-05-17T11:55:00.000Z"
};

function makeConfig(values: Readonly<Record<string, unknown>>): RepairAiSettingsConfig {
  return {
    get<T>(section: string, defaultValue: T): T {
      if (Object.prototype.hasOwnProperty.call(values, section)) {
        return values[section] as T;
      }
      return defaultValue;
    }
  };
}

function stubProvider(
  id: string,
  result: RepairAiResult | (() => Promise<RepairAiResult>) = { ok: true, patchText: "diff" }
): RepairAiProvider {
  return {
    id,
    displayName: id,
    generatePatch: async () => (typeof result === "function" ? result() : result)
  };
}

describe("RepairAiProviderRegistry", () => {
  it("rejects providers with an empty id", () => {
    const registry = new RepairAiProviderRegistry();
    expect(() =>
      registry.register({ id: "", displayName: "x", generatePatch: async () => ({ ok: true, patchText: "" }) })
    ).toThrow(/provider\.id must be non-empty/);
  });

  it("registers a provider and exposes it via list / listIds / get", () => {
    const registry = new RepairAiProviderRegistry();
    const provider = stubProvider("a");
    registry.register(provider);
    expect(registry.listIds()).toEqual(["a"]);
    expect(registry.list()).toEqual([provider]);
    expect(registry.get("a")).toBe(provider);
  });

  it("re-registering the same id replaces the previous provider", () => {
    const registry = new RepairAiProviderRegistry();
    const first = stubProvider("a");
    const second = stubProvider("a");
    registry.register(first);
    registry.register(second);
    expect(registry.get("a")).toBe(second);
    expect(registry.listIds()).toEqual(["a"]);
  });

  it("dispose() removes the registration only if it is still the current one", () => {
    const registry = new RepairAiProviderRegistry();
    const first = stubProvider("a");
    const second = stubProvider("a");
    const firstDisposable = registry.register(first);
    registry.register(second); // replaces
    firstDisposable.dispose(); // must NOT remove second
    expect(registry.get("a")).toBe(second);
  });
});

describe("runRepairAi", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("forwards the gate refusal verbatim when no provider is configured", async () => {
    const registry = new RepairAiProviderRegistry();
    registry.register(stubProvider("my"));
    const result = await runRepairAi(
      registry,
      makeConfig({ "repair.aiAcknowledgedSharing": true }),
      REQUEST
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/No AI repair provider is configured/);
    }
  });

  it("forwards the gate refusal verbatim when acknowledge flag is false", async () => {
    const registry = new RepairAiProviderRegistry();
    const generatePatch = vi.fn(async () => ({ ok: true as const, patchText: "diff" }));
    registry.register({
      id: "my",
      displayName: "my",
      generatePatch
    });
    const result = await runRepairAi(
      registry,
      makeConfig({ "repair.aiProvider": "my" }),
      REQUEST
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/aiAcknowledgedSharing/);
    }
    expect(generatePatch).not.toHaveBeenCalled();
  });

  it("invokes the configured provider when the gate passes and returns its result", async () => {
    const registry = new RepairAiProviderRegistry();
    registry.register(
      stubProvider("my", {
        ok: true,
        patchText: "--- a\n+++ b\n@@\n-old\n+new\n",
        providerRunId: "abc"
      })
    );
    const promise = runRepairAi(
      registry,
      makeConfig({
        "repair.aiProvider": "my",
        "repair.aiAcknowledgedSharing": true
      }),
      REQUEST
    );
    const result = await promise;
    expect(result).toEqual({
      ok: true,
      patchText: "--- a\n+++ b\n@@\n-old\n+new\n",
      providerRunId: "abc"
    });
  });

  it("passes the configured request to the provider verbatim", async () => {
    const registry = new RepairAiProviderRegistry();
    let captured: RepairAiRequest | undefined;
    registry.register({
      id: "capture",
      displayName: "capture",
      generatePatch: async (request) => {
        captured = request;
        return { ok: true, patchText: "" };
      }
    });
    await runRepairAi(
      registry,
      makeConfig({
        "repair.aiProvider": "capture",
        "repair.aiAcknowledgedSharing": true
      }),
      REQUEST
    );
    expect(captured).toEqual(REQUEST);
  });

  it("requires the optional authorization hook to approve before invoking a provider", async () => {
    const registry = new RepairAiProviderRegistry();
    const generatePatch = vi.fn(async () => ({ ok: true as const, patchText: "diff" }));
    registry.register({
      id: "guarded",
      displayName: "Guarded Provider",
      generatePatch
    });
    const authorizeRequest = vi.fn(async () => false);
    const result = await runRepairAi(
      registry,
      makeConfig({
        "repair.aiProvider": "guarded",
        "repair.aiAcknowledgedSharing": true
      }),
      REQUEST,
      { authorizeRequest }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/not confirmed/);
    }
    expect(authorizeRequest).toHaveBeenCalledWith({
      providerId: "guarded",
      providerDisplayName: "Guarded Provider",
      request: REQUEST
    });
    expect(generatePatch).not.toHaveBeenCalled();
  });

  it("wraps authorization hook failures as typed refusals", async () => {
    const registry = new RepairAiProviderRegistry();
    const generatePatch = vi.fn(async () => ({ ok: true as const, patchText: "diff" }));
    registry.register({
      id: "guarded",
      displayName: "Guarded Provider",
      generatePatch
    });
    const result = await runRepairAi(
      registry,
      makeConfig({
        "repair.aiProvider": "guarded",
        "repair.aiAcknowledgedSharing": true
      }),
      REQUEST,
      {
        authorizeRequest: async () => {
          throw new Error("review document failed");
        }
      }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/confirmation failed: review document failed/);
    }
    expect(generatePatch).not.toHaveBeenCalled();
  });

  it("invokes the provider only after the authorization hook approves", async () => {
    const registry = new RepairAiProviderRegistry();
    const generatePatch = vi.fn(async () => ({ ok: true as const, patchText: "diff" }));
    registry.register({
      id: "guarded",
      displayName: "Guarded Provider",
      generatePatch
    });
    const result = await runRepairAi(
      registry,
      makeConfig({
        "repair.aiProvider": "guarded",
        "repair.aiAcknowledgedSharing": true
      }),
      REQUEST,
      { authorizeRequest: async () => true }
    );
    expect(result).toEqual({ ok: true, patchText: "diff" });
    expect(generatePatch).toHaveBeenCalledTimes(1);
  });

  it("converts a provider rejection into a typed failure", async () => {
    const registry = new RepairAiProviderRegistry();
    registry.register({
      id: "rej",
      displayName: "rej",
      generatePatch: async () => {
        throw new Error("API unreachable");
      }
    });
    const result = await runRepairAi(
      registry,
      makeConfig({
        "repair.aiProvider": "rej",
        "repair.aiAcknowledgedSharing": true
      }),
      REQUEST
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/threw: API unreachable/);
    }
  });

  it("converts a provider's own typed failure into its returned reason", async () => {
    const registry = new RepairAiProviderRegistry();
    registry.register(
      stubProvider("nope", { ok: false, reason: "rate limited" })
    );
    const result = await runRepairAi(
      registry,
      makeConfig({
        "repair.aiProvider": "nope",
        "repair.aiAcknowledgedSharing": true
      }),
      REQUEST
    );
    expect(result).toEqual({ ok: false, reason: "rate limited" });
  });

  it("times out when the provider hangs longer than timeoutMs", async () => {
    const registry = new RepairAiProviderRegistry();
    let schedulerCb: (() => void) | undefined;
    registry.register({
      id: "hang",
      displayName: "hang",
      generatePatch: () => new Promise(() => undefined) // never resolves
    });
    const promise = runRepairAi(
      registry,
      makeConfig({
        "repair.aiProvider": "hang",
        "repair.aiAcknowledgedSharing": true
      }),
      REQUEST,
      {
        timeoutMs: 5_000,
        scheduleTimeout: (cb) => {
          schedulerCb = cb;
          return 1;
        },
        cancelTimeout: () => {
          schedulerCb = undefined;
        }
      }
    );
    schedulerCb?.();
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/timed out after 5000 ms/);
    }
  });

  it("aborts the provider via abortSignal when the timeout fires", async () => {
    const registry = new RepairAiProviderRegistry();
    let observedAborted = false;
    let schedulerCb: (() => void) | undefined;
    registry.register({
      id: "watch",
      displayName: "watch",
      generatePatch: (_request, signal) =>
        new Promise(() => {
          signal?.addEventListener("abort", () => {
            observedAborted = true;
          });
        })
    });
    const promise = runRepairAi(
      registry,
      makeConfig({
        "repair.aiProvider": "watch",
        "repair.aiAcknowledgedSharing": true
      }),
      REQUEST,
      {
        timeoutMs: 1_000,
        scheduleTimeout: (cb) => {
          schedulerCb = cb;
          return 1;
        },
        cancelTimeout: () => undefined
      }
    );
    schedulerCb?.();
    await promise;
    expect(observedAborted).toBe(true);
  });
});
