import { describe, expect, it } from "vitest";
import { createIsabellePideExtensionApi } from "../../src/api/IsabellePideExtensionApi";
import {
  RepairAiProvider,
  RepairAiProviderRegistry
} from "../../src/repair/repairAiProvider";
import {
  RepairAiSecretStore,
  SecretStorageLike
} from "../../src/repair/RepairAiSecretStore";

function stubProvider(id: string): RepairAiProvider {
  return {
    id,
    displayName: id,
    generatePatch: async () => ({ ok: true, patchText: "" })
  };
}

function fakeSecretStore(): RepairAiSecretStore {
  const map = new Map<string, string>();
  const storage: SecretStorageLike = {
    get: async (key) => map.get(key),
    store: async (key, value) => {
      map.set(key, value);
    },
    delete: async (key) => {
      map.delete(key);
    }
  };
  return new RepairAiSecretStore(storage);
}

describe("createIsabellePideExtensionApi", () => {
  it("declares version='1' so consumers can do a compat check", () => {
    const api = createIsabellePideExtensionApi(
      new RepairAiProviderRegistry(),
      fakeSecretStore()
    );
    expect(api.version).toBe("1");
  });

  it("registerRepairAiProvider proxies into the underlying registry", () => {
    const registry = new RepairAiProviderRegistry();
    const api = createIsabellePideExtensionApi(registry, fakeSecretStore());
    const provider = stubProvider("third-party-ai");
    api.registerRepairAiProvider(provider);
    expect(registry.get("third-party-ai")).toBe(provider);
  });

  it("registerRepairAiProvider returns a disposable that removes the registration", () => {
    const registry = new RepairAiProviderRegistry();
    const api = createIsabellePideExtensionApi(registry, fakeSecretStore());
    const disposable = api.registerRepairAiProvider(stubProvider("x"));
    expect(registry.listIds()).toEqual(["x"]);
    disposable.dispose();
    expect(registry.listIds()).toEqual([]);
  });

  it("listRepairAiProviderIds reflects the live registry state", () => {
    const registry = new RepairAiProviderRegistry();
    const api = createIsabellePideExtensionApi(registry, fakeSecretStore());
    expect(api.listRepairAiProviderIds()).toEqual([]);

    api.registerRepairAiProvider(stubProvider("alpha"));
    api.registerRepairAiProvider(stubProvider("beta"));
    expect(api.listRepairAiProviderIds()).toEqual(["alpha", "beta"]);

    // Direct registry registration is also reflected — the API is a
    // facade, not a separate store.
    registry.register(stubProvider("gamma"));
    expect(api.listRepairAiProviderIds()).toEqual(["alpha", "beta", "gamma"]);
  });

  it("propagates the registry's empty-id rejection unchanged", () => {
    // The registry rejects empty ids because it keys by id. The API
    // must propagate that error so callers cannot get a phantom
    // disposable that refers to nothing.
    const api = createIsabellePideExtensionApi(
      new RepairAiProviderRegistry(),
      fakeSecretStore()
    );
    expect(() =>
      api.registerRepairAiProvider({
        id: "",
        displayName: "x",
        generatePatch: async () => ({ ok: true, patchText: "" })
      })
    ).toThrow(/provider\.id must be non-empty/);
  });

  it("respects the registry's replace-on-same-id semantics", () => {
    const registry = new RepairAiProviderRegistry();
    const api = createIsabellePideExtensionApi(registry, fakeSecretStore());
    const first = stubProvider("a");
    const second = stubProvider("a");
    const firstDisposable = api.registerRepairAiProvider(first);
    api.registerRepairAiProvider(second);
    // first.dispose() must not remove `second` — the disposable
    // tracks the specific registration it owns.
    firstDisposable.dispose();
    expect(registry.get("a")).toBe(second);
  });

  it("getRepairAiSecretStore returns the same store across calls", () => {
    const store = fakeSecretStore();
    const api = createIsabellePideExtensionApi(
      new RepairAiProviderRegistry(),
      store
    );
    expect(api.getRepairAiSecretStore()).toBe(store);
    expect(api.getRepairAiSecretStore()).toBe(api.getRepairAiSecretStore());
  });

  it("getRepairAiSecretStore exposes a working store (round-trips a secret)", async () => {
    const store = fakeSecretStore();
    const api = createIsabellePideExtensionApi(
      new RepairAiProviderRegistry(),
      store
    );
    await api.getRepairAiSecretStore().set("my-provider", "shh");
    expect(await api.getRepairAiSecretStore().get("my-provider")).toBe("shh");
  });
});
