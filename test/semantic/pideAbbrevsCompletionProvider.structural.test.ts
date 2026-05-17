import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Structural pins for the `PideAbbrevsCompletionProvider` wiring.
 *
 * The pure cache + prefix-matching helpers in `PideAbbrevsCache` are
 * covered by `test/semantic/pideAbbrevsCache.test.ts`. These pins
 * catch regressions in the vscode-side registration that would only
 * show up at runtime with a live Isabelle install.
 */

const providerSourcePath = resolve(
  __dirname,
  "..",
  "..",
  "src",
  "semantic",
  "PideAbbrevsCompletionProvider.ts"
);
const providerSource = readFileSync(providerSourcePath, "utf8");

const extensionSourcePath = resolve(
  __dirname,
  "..",
  "..",
  "src",
  "extension.ts"
);
const extensionSource = readFileSync(extensionSourcePath, "utf8");

describe("PideAbbrevsCompletionProvider structural wiring", () => {
  it("targets Isabelle .thy documents via the file/isabelle documentSelector", () => {
    expect(providerSource).toContain(`scheme: "file"`);
    expect(providerSource).toContain(`language: "isabelle"`);
  });

  it("registers using vscode.languages.registerCompletionItemProvider with cache-derived triggers", () => {
    expect(providerSource).toContain("vscode.languages.registerCompletionItemProvider");
    expect(providerSource).toContain("...triggers");
  });

  it("re-registers when the cache reports a fresh PIDE/abbrevs_response", () => {
    // The cache's onDidUpdate listener must trigger a re-registration
    // so that the trigger character set stays in sync with the actual
    // abbreviations table (VS Code captures triggers at registration).
    expect(providerSource).toMatch(/cache\.onDidUpdate/);
    expect(providerSource).toMatch(/providerSubscription\?\.dispose\(\)/);
  });

  it("emits no items when the cache is empty so the path is safe with LSP off", () => {
    expect(providerSource).toContain("if (abbrevs.length === 0) return [];");
  });

  it("uses the abbreviation as filterText and the expansion as insertText", () => {
    expect(providerSource).toContain("item.filterText = entry.abbrev");
    expect(providerSource).toContain("item.insertText = entry.expansion");
  });

  it("attributes the suggestion source as a PIDE/abbrevs_response entry", () => {
    expect(providerSource).toContain("PIDE/abbrevs_response");
    expect(providerSource).toContain("Isabelle abbrev");
  });
});

describe("PideAbbrevsCache wired into extension activation", () => {
  it("constructs the cache in activate() with the language client and output channel", () => {
    expect(extensionSource).toMatch(
      /pideAbbrevsCache\s*=\s*new PideAbbrevsCache\(languageClient,\s*output\)/
    );
  });

  it("registers the completion provider via the cache-aware helper", () => {
    expect(extensionSource).toMatch(
      /registerPideAbbrevsCompletionProvider\(pideAbbrevsCache\)/
    );
  });

  it("includes the cache in the activation subscriptions list", () => {
    expect(extensionSource).toMatch(/\bpideAbbrevsCache\b/);
  });

  it("is disposed in deactivate()", () => {
    expect(extensionSource).toMatch(/pideAbbrevsCache\?\.dispose\(\)/);
    expect(extensionSource).toMatch(/pideAbbrevsCache = undefined/);
  });
});
