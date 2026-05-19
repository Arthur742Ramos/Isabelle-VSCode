import * as assert from "assert";
import * as vscode from "vscode";

// Seed integration test #1: prove that the extension is present, that
// activate() actually runs end-to-end inside a real VS Code extension host,
// and that the returned IsabellePideExtensionApi surface (see
// src/api/IsabellePideExtensionApi.ts) has the shape consumers depend on.
//
// This test deliberately stays at the activation/API surface and does NOT
// exercise the LSP, Sledgehammer, proof state, or any feature that requires
// a real Isabelle install — those are covered by the manual Tier-2
// checklist (docs/SMOKE_THEORY_CHECKLIST.md).

const EXTENSION_ID = "arthur742ramos.isabelle-pide-vscode";

suite("Extension activation", () => {
  test("extension is installed and resolvable", () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `Expected ${EXTENSION_ID} to be installed in the test host`);
  });

  test("activate() succeeds and returns a sane IsabellePideExtensionApi", async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `Expected ${EXTENSION_ID} to be installed in the test host`);

    const api = (await ext.activate()) as {
      version: string;
      registerRepairAiProvider: unknown;
      listRepairAiProviderIds: unknown;
      getRepairAiSecretStore: unknown;
    };

    assert.strictEqual(ext.isActive, true, "extension should report isActive after activate()");
    assert.ok(api, "activate() must return an API object");
    assert.strictEqual(api.version, "1", "API version contract is the v1 compat tag");
    assert.strictEqual(
      typeof api.registerRepairAiProvider,
      "function",
      "registerRepairAiProvider must be a function"
    );
    assert.strictEqual(
      typeof api.listRepairAiProviderIds,
      "function",
      "listRepairAiProviderIds must be a function"
    );
    assert.strictEqual(
      typeof api.getRepairAiSecretStore,
      "function",
      "getRepairAiSecretStore must be a function"
    );
  });
});
