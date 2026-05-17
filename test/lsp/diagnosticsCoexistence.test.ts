import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BUILD_DIAGNOSTIC_COLLECTION_NAME } from "../../src/build/diagnostics";

/*
 * Structural verification that the Isabelle CLI-build runner and the
 * (opt-in) Isabelle LSP client use distinct `vscode.DiagnosticCollection`
 * owners, so their diagnostics coexist in the Problems panel rather than
 * one overwriting the other.
 *
 * Background:
 *   - `BuildService` owns a collection named `"isabelle-build"` and tags each
 *     diagnostic with `source = "isabelle build"`.
 *   - `IsabelleLanguageClient` constructs a `LanguageClient` from
 *     `vscode-languageclient/node`. That library only calls
 *     `vscode.languages.createDiagnosticCollection(name)` with a name when
 *     `LanguageClientOptions.diagnosticCollectionName` is set; otherwise it
 *     calls the no-argument overload and VS Code assigns an internal name.
 *     The current LSP client does NOT set `diagnosticCollectionName`, so its
 *     collection name is auto-generated and necessarily different from
 *     `"isabelle-build"`.
 *
 * These assertions guard the structural property — they do NOT verify the
 * live VS Code Problems-panel aggregation behavior, which still requires a
 * Tier-2 manual run against an Isabelle install. The intent is to make any
 * future change that would reuse the build collection name on the LSP side
 * fail at test time rather than only at user-visible runtime.
 */
const lspClientSourcePath = resolve(
  __dirname,
  "..",
  "..",
  "src",
  "lsp",
  "IsabelleLanguageClient.ts"
);
const lspClientSource = readFileSync(lspClientSourcePath, "utf8");

const buildServiceSourcePath = resolve(
  __dirname,
  "..",
  "..",
  "src",
  "build",
  "BuildService.ts"
);
const buildServiceSource = readFileSync(buildServiceSourcePath, "utf8");

describe("LSP and CLI-build DiagnosticCollection coexistence", () => {
  it("BuildService owns the 'isabelle-build' diagnostic-collection name", () => {
    expect(BUILD_DIAGNOSTIC_COLLECTION_NAME).toBe("isabelle-build");
  });

  it("BuildService only clears its own DiagnosticCollection, never anything global", () => {
    // The merge story depends on BuildService never wiping diagnostics it
    // does not own. The build runner is allowed to clear `this.diagnostics`
    // (its own collection) and to dispose it, but it must not touch
    // `vscode.languages.getDiagnostics(...)` clearing or any other owner's
    // collection.
    expect(buildServiceSource).toMatch(/this\.diagnostics\.clear\(\s*\)/);
    expect(buildServiceSource).not.toMatch(/vscode\.languages\.getDiagnostics/);
  });

  it("IsabelleLanguageClient does not claim the 'isabelle-build' collection name", () => {
    // If the LSP client is ever updated to set diagnosticCollectionName
    // explicitly, it must NOT reuse the CLI-build collection name — that
    // would let one source overwrite the other's diagnostics for the same
    // file.
    expect(lspClientSource).not.toMatch(
      /diagnosticCollectionName\s*:\s*["']isabelle-build["']/
    );
  });

  it("IsabelleLanguageClient does not import the build collection-name constant", () => {
    // Prevents an accidental future refactor from wiring the LSP collection
    // name to the same constant that BuildService uses.
    expect(lspClientSource).not.toMatch(/BUILD_DIAGNOSTIC_COLLECTION_NAME/);
  });
});
