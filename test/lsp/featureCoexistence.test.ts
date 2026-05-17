import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Structural verification that the Isabelle LSP relay and the local
 * syntax-only providers coexist for the same `.thy` documents under a
 * matching documentSelector. This pins down two roadmap items from
 * docs/PIDE_INTEGRATION.md whose end-to-end behavior depends on a
 * live Isabelle install and therefore can't be fully exercised in
 * vitest:
 *
 *   - Milestone 4: textDocument/{didOpen,didChange,didClose} are
 *     forwarded for `.thy` documents to isabelle vscode_server.
 *     vscode-languageclient handles this automatically for any
 *     document matching the LanguageClientOptions.documentSelector.
 *     The assertion here is that the selector covers Isabelle
 *     `.thy` files via {scheme: "file", language: "isabelle"} —
 *     the same selector that drives every local provider
 *     registration in extension.ts.
 *
 *   - Milestone 5: textDocument/{hover,definition,completion}
 *     coexist between the LSP and the local providers. Both
 *     register against the same document selector and the LSP-side
 *     registration is conditional on the upstream
 *     `isabelle vscode_server` advertising the matching capability
 *     at `initialize` time (see docs/sledgehammer_lsp_research.md
 *     "Findings → Capabilities advertised at initialize" — the
 *     2025-2 probe shows definitionProvider, hoverProvider, and
 *     completionProvider but NO documentSymbolProvider).
 *
 * If any future refactor narrows the LSP documentSelector, or
 * widens the local providers off the Isabelle scheme/language, this
 * test will fail at build time rather than only at live runtime
 * during a manual Tier-2 verification.
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

const extensionSourcePath = resolve(
  __dirname,
  "..",
  "..",
  "src",
  "extension.ts"
);
const extensionSource = readFileSync(extensionSourcePath, "utf8");

describe("LSP feature coexistence (Milestone 4 + 5 structural pins)", () => {
  it("LSP client targets Isabelle `.thy` documents via the file/isabelle documentSelector", () => {
    // vscode-languageclient auto-syncs every matching document via
    // textDocument/didOpen / didChange / didClose. The selector
    // shape below is what guarantees `.thy` documents flow through
    // the LSP, which is the first Milestone 4 capability checkbox
    // in docs/PIDE_INTEGRATION.md.
    expect(lspClientSource).toMatch(
      /documentSelector:\s*\[\s*\{\s*scheme:\s*["']file["'],\s*language:\s*["']isabelle["']\s*\}\s*\]/
    );
  });

  it("LSP client does not pin a stricter selector (e.g. by URI pattern) that would skip some .thy files", () => {
    // Defensive guard: any future addition of `pattern: …` to the
    // selector would risk filtering .thy files out of the LSP sync
    // path. If we ever want to narrow the selector intentionally,
    // this assertion will fail and force a follow-up.
    expect(lspClientSource).not.toMatch(/documentSelector:\s*\[[^\]]*pattern:/);
  });

  it("LSP client uses TransportKind.stdio so the bundled isabelle vscode_server is reachable on every platform", () => {
    // The Windows .ps1 auto-wrap (PR #27) plus stdio transport is
    // the cross-platform path. If a future change ever moves the
    // child to IPC or socket, that's a substantial behavior change
    // and this assertion makes us notice.
    expect(lspClientSource).toMatch(/transport:\s*TransportKind\.stdio/);
  });

  it("local hover provider registers against the same Isabelle file selector the LSP uses", () => {
    // VS Code aggregates hovers from every registered provider for
    // the document, so both the LSP (when running) and the local
    // syntax-only provider contribute. This pins the local-side
    // selector so a future refactor can't accidentally narrow it.
    expect(extensionSource).toMatch(
      /registerHoverProvider\(\s*\{\s*language:\s*["']isabelle["'],\s*scheme:\s*["']file["']\s*\}/
    );
  });

  it("local definition provider registers against the same Isabelle file selector the LSP uses", () => {
    expect(extensionSource).toMatch(
      /registerDefinitionProvider\(\s*\{\s*language:\s*["']isabelle["'],\s*scheme:\s*["']file["']\s*\}/
    );
  });

  it("local document symbol provider registers against the same Isabelle file selector the LSP uses", () => {
    // Note: as of Isabelle 2025-2 the LSP does NOT advertise
    // documentSymbolProvider (see
    // docs/sledgehammer_lsp_research.md), so VS Code's Outline view
    // is served exclusively by the local provider when the LSP is
    // running. That's the documented behavior — pinning the local
    // registration here so it stays in place.
    expect(extensionSource).toMatch(
      /registerDocumentSymbolProvider\(\s*\{\s*language:\s*["']isabelle["'],\s*scheme:\s*["']file["']\s*\}/
    );
  });

  it("local document link provider registers against the same Isabelle file selector", () => {
    expect(extensionSource).toMatch(
      /registerDocumentLinkProvider\(\s*\{\s*language:\s*["']isabelle["'],\s*scheme:\s*["']file["']\s*\}/
    );
  });

  it("local semantic-tokens provider registers against the same Isabelle file selector", () => {
    expect(extensionSource).toMatch(
      /registerDocumentSemanticTokensProvider\(\s*\{\s*language:\s*["']isabelle["'],\s*scheme:\s*["']file["']\s*\}/
    );
  });

  it("extension.ts does not unregister any local provider when the LSP transitions to running", () => {
    // The LSP-status-aware decoration suppression (PR #35) is the
    // ONLY local surface that defers to the LSP, and it does so by
    // suppressing rendering, not by unregistering. None of the
    // other local providers should be tied to the LSP's state.
    // Guard against an accidental future refactor that conflates
    // "suppress decorations" with "unregister providers".
    expect(extensionSource).not.toMatch(/dispose.*HoverProvider/);
    expect(extensionSource).not.toMatch(/dispose.*DefinitionProvider/);
    expect(extensionSource).not.toMatch(/dispose.*DocumentSymbolProvider/);
    expect(extensionSource).not.toMatch(/dispose.*CompletionItemProvider/);
  });

  it("LSP client never auto-registers a custom completion provider that could clash with local registrations", () => {
    // vscode-languageclient itself registers a completion provider
    // when the server advertises completionProvider — and Isabelle
    // 2025-2 DOES advertise it (see the live probe in
    // sledgehammer_lsp_research.md). Our own extension.ts must
    // therefore NOT register a second LSP-style completion
    // provider that would either steal results or fight with the
    // language client's auto-registration. Today extension.ts has
    // no completion provider at all; the local-syntax surface is
    // hover, definition, document-symbol, document-link, and
    // semantic-tokens. If a future change adds a local completion
    // provider it should land via this test being updated, not
    // via duplicate registration.
    expect(extensionSource).not.toMatch(/registerCompletionItemProvider/);
  });
});
