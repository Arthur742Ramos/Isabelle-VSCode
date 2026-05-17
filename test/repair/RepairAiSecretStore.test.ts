import { describe, expect, it } from "vitest";
import {
  buildRepairAiSecretKey,
  REPAIR_AI_SECRET_KEY_PREFIX,
  RepairAiSecretStore,
  SecretStorageLike
} from "../../src/repair/RepairAiSecretStore";

class FakeSecretStorage implements SecretStorageLike {
  public readonly store = new Map<string, string>();
  public readonly events: { op: "get" | "store" | "delete"; key: string; value?: string }[] = [];
  public throwOnce: { op: "get" | "store" | "delete"; error: Error } | undefined;

  public async get(key: string): Promise<string | undefined> {
    this.maybeThrow("get");
    this.events.push({ op: "get", key });
    return this.store.get(key);
  }
  public async storeFn(key: string, value: string): Promise<void> {
    this.maybeThrow("store");
    this.events.push({ op: "store", key, value });
    this.store.set(key, value);
  }
  // SecretStorageLike interface uses `store`, but TS doesn't let us shadow
  // the field; expose via a method name and alias on construction.
  public storeMethod = this.storeFn.bind(this);
  public async delete(key: string): Promise<void> {
    this.maybeThrow("delete");
    this.events.push({ op: "delete", key });
    this.store.delete(key);
  }
  private maybeThrow(op: "get" | "store" | "delete"): void {
    if (this.throwOnce && this.throwOnce.op === op) {
      const err = this.throwOnce.error;
      this.throwOnce = undefined;
      throw err;
    }
  }
}

// Adapt FakeSecretStorage to the SecretStorageLike interface that
// uses `store` as a method, not a field. We construct a small
// passthrough so the tests work cleanly without colliding with the
// internal map.
function makeStorage(): { storage: SecretStorageLike; fake: FakeSecretStorage } {
  const fake = new FakeSecretStorage();
  const storage: SecretStorageLike = {
    get: (key) => fake.get(key),
    store: (key, value) => fake.storeMethod(key, value),
    delete: (key) => fake.delete(key)
  };
  return { storage, fake };
}

describe("buildRepairAiSecretKey", () => {
  it("namespaces the provider id under the canonical prefix", () => {
    expect(buildRepairAiSecretKey("my-provider")).toBe(
      `${REPAIR_AI_SECRET_KEY_PREFIX}my-provider`
    );
  });

  it("trims surrounding whitespace before keying", () => {
    expect(buildRepairAiSecretKey("  spaced  ")).toBe(
      `${REPAIR_AI_SECRET_KEY_PREFIX}spaced`
    );
  });

  it("rejects empty / whitespace-only ids", () => {
    expect(() => buildRepairAiSecretKey("")).toThrow(/must be non-empty/);
    expect(() => buildRepairAiSecretKey("   ")).toThrow(/must be non-empty/);
  });

  it("rejects non-string inputs", () => {
    expect(() => buildRepairAiSecretKey(undefined as unknown as string)).toThrow(/must be a string/);
    expect(() => buildRepairAiSecretKey(42 as unknown as string)).toThrow(/must be a string/);
  });

  it("rejects ids with characters outside [A-Za-z0-9._-]", () => {
    // Belt-and-braces: no quotes, no slashes, no spaces, no nulls.
    // A hostile id should not be able to escape the namespace.
    expect(() => buildRepairAiSecretKey("a/b")).toThrow(/outside/);
    expect(() => buildRepairAiSecretKey("a b")).toThrow(/outside/);
    expect(() => buildRepairAiSecretKey('a"b')).toThrow(/outside/);
    expect(() => buildRepairAiSecretKey("a\0b")).toThrow(/outside/);
    expect(() => buildRepairAiSecretKey("a:b")).toThrow(/outside/);
  });

  it("accepts every character in the allowed set", () => {
    expect(() => buildRepairAiSecretKey("Alpha.Beta_Gamma-0123456789")).not.toThrow();
  });
});

describe("RepairAiSecretStore", () => {
  it("get() forwards to the underlying storage with the namespaced key", async () => {
    const { storage, fake } = makeStorage();
    fake.store.set("isabelle.repair.aiSecret.alpha", "shh");
    const store = new RepairAiSecretStore(storage);
    expect(await store.get("alpha")).toBe("shh");
    expect(fake.events).toEqual([
      { op: "get", key: "isabelle.repair.aiSecret.alpha" }
    ]);
  });

  it("get() returns undefined when no secret has been stored", async () => {
    const { storage } = makeStorage();
    const store = new RepairAiSecretStore(storage);
    expect(await store.get("never-set")).toBeUndefined();
  });

  it("set() writes the secret under the namespaced key", async () => {
    const { storage, fake } = makeStorage();
    const store = new RepairAiSecretStore(storage);
    await store.set("alpha", "shh");
    expect(fake.store.get("isabelle.repair.aiSecret.alpha")).toBe("shh");
    expect(fake.events).toEqual([
      { op: "store", key: "isabelle.repair.aiSecret.alpha", value: "shh" }
    ]);
  });

  it("set() with an empty string deletes the entry (mirrors UI 'clear by emptying input')", async () => {
    const { storage, fake } = makeStorage();
    fake.store.set("isabelle.repair.aiSecret.alpha", "old");
    const store = new RepairAiSecretStore(storage);
    await store.set("alpha", "");
    expect(fake.store.has("isabelle.repair.aiSecret.alpha")).toBe(false);
    expect(fake.events).toEqual([{ op: "delete", key: "isabelle.repair.aiSecret.alpha" }]);
  });

  it("set() rejects non-string secret values", async () => {
    const { storage } = makeStorage();
    const store = new RepairAiSecretStore(storage);
    await expect(store.set("alpha", 42 as unknown as string)).rejects.toThrow(/must be a string/);
    await expect(store.set("alpha", undefined as unknown as string)).rejects.toThrow(/must be a string/);
  });

  it("clear() deletes the namespaced key", async () => {
    const { storage, fake } = makeStorage();
    fake.store.set("isabelle.repair.aiSecret.alpha", "old");
    const store = new RepairAiSecretStore(storage);
    await store.clear("alpha");
    expect(fake.store.has("isabelle.repair.aiSecret.alpha")).toBe(false);
  });

  it("clear() is a no-op for a missing key", async () => {
    const { storage } = makeStorage();
    const store = new RepairAiSecretStore(storage);
    await expect(store.clear("never-set")).resolves.toBeUndefined();
  });

  it("propagates invalid provider ids through every method", async () => {
    const { storage } = makeStorage();
    const store = new RepairAiSecretStore(storage);
    await expect(store.get("")).rejects.toThrow(/non-empty/);
    await expect(store.set("", "x")).rejects.toThrow(/non-empty/);
    await expect(store.clear("")).rejects.toThrow(/non-empty/);
    await expect(store.get("bad id")).rejects.toThrow(/outside/);
  });

  it("propagates storage-layer errors instead of swallowing them", async () => {
    const { storage, fake } = makeStorage();
    const store = new RepairAiSecretStore(storage);
    fake.throwOnce = { op: "store", error: new Error("keychain locked") };
    await expect(store.set("alpha", "shh")).rejects.toThrow(/keychain locked/);
  });
});
