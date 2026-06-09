import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Structural pin for the curated `editor/context` menu shipped in package.json.
//
// This test is the dump-prevention boundary for the right-click menu on
// Isabelle .thy files. The menu is intentionally short — every entry must
// earn its place. If you find yourself adding an 18th entry, stop and read
// the rationale in AGENTS.md / the PR that introduced this test.
//
// The set covers seven daily-driver groups:
//   1_navigation   — caret/command-span jumps
//   2_proof        — proof actions + proof state controls
//   3_sledgehammer — run + pick-suggestion (suggestion entry gated)
//   4_preview      — theory preview (current + split)
//   5_spellcheck   — include/exclude word (session + permanent)
//   6_symbols      — convert symbols to Unicode / ASCII
//   9_repair       — create checked repair request
//
// Things deliberately NOT exposed in the right-click menu (palette-only):
// session/build commands (panel toolbar handles those), LSP lifecycle,
// theory-graph mutations, AI-repair internals, sledgehammer history, and
// debug surfaces like Show Version / Check Backend Health. See the
// AGENTS.md "right-click menu" rationale and the PR description.

const packageJsonPath = resolve(__dirname, "..", "..", "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
  contributes?: {
    menus?: {
      "editor/context"?: Array<{ command: string; when?: string; group?: string }>;
    };
  };
};

interface ExpectedEntry {
  command: string;
  group: string;
  when: string;
}

// The curated, ordered set. Order is enforced — the test compares index-for-index.
const EXPECTED: ExpectedEntry[] = [
  { command: "isabelle.nextCommand", group: "1_navigation@1", when: "editorLangId == isabelle" },
  { command: "isabelle.previousCommand", group: "1_navigation@2", when: "editorLangId == isabelle" },
  { command: "isabelle.revealCurrentCommand", group: "1_navigation@3", when: "editorLangId == isabelle" },
  { command: "isabelle.showProofActions", group: "2_proof@1", when: "editorLangId == isabelle" },
  { command: "isabelle.refreshProofState", group: "2_proof@2", when: "editorLangId == isabelle" },
  { command: "isabelle.relocateProofState", group: "2_proof@3", when: "editorLangId == isabelle" },
  { command: "isabelle.runSledgehammer", group: "3_sledgehammer@1", when: "editorLangId == isabelle" },
  {
    command: "isabelle.pickSledgehammerSuggestion",
    group: "3_sledgehammer@2",
    when: "editorLangId == isabelle && isabelle.sledgehammerHasSuggestion"
  },
  { command: "isabelle.previewTheory", group: "4_preview@1", when: "editorLangId == isabelle" },
  { command: "isabelle.previewTheoryInSplit", group: "4_preview@2", when: "editorLangId == isabelle" },
  { command: "isabelle.includeWord", group: "5_spellcheck@1", when: "editorLangId == isabelle" },
  { command: "isabelle.includeWordPermanently", group: "5_spellcheck@2", when: "editorLangId == isabelle" },
  { command: "isabelle.excludeWord", group: "5_spellcheck@3", when: "editorLangId == isabelle" },
  { command: "isabelle.excludeWordPermanently", group: "5_spellcheck@4", when: "editorLangId == isabelle" },
  { command: "isabelle.convertSymbolsToUnicode", group: "6_symbols@1", when: "editorLangId == isabelle" },
  { command: "isabelle.convertSymbolsToAscii", group: "6_symbols@2", when: "editorLangId == isabelle" },
  { command: "isabelle.createRepairRequest", group: "9_repair@1", when: "editorLangId == isabelle" }
];

describe("editor/context menu manifest", () => {
  const entries = packageJson.contributes?.menus?.["editor/context"];

  it("declares the editor/context menu under contributes.menus", () => {
    expect(Array.isArray(entries)).toBe(true);
  });

  it("contains exactly the curated 17 entries (no fewer, no extras)", () => {
    expect(entries).toBeDefined();
    expect(entries).toHaveLength(EXPECTED.length);
    expect(EXPECTED).toHaveLength(17);
  });

  it("preserves the curated order, commands, groups, and when-clauses", () => {
    expect(entries).toBeDefined();
    expect(entries).toEqual(EXPECTED);
  });

  it("gates every entry on `editorLangId == isabelle` so the menu never shows on non-.thy files", () => {
    expect(entries).toBeDefined();
    for (const entry of entries ?? []) {
      expect(typeof entry.when).toBe("string");
      expect(entry.when ?? "").toContain("editorLangId == isabelle");
    }
  });

  it("only references commands that are actually contributed by the extension", () => {
    expect(entries).toBeDefined();
    const contributedCommandIds = new Set(
      ((packageJson as unknown as { contributes?: { commands?: Array<{ command: string }> } })
        .contributes?.commands ?? []).map((c) => c.command)
    );
    for (const entry of entries ?? []) {
      expect(
        contributedCommandIds.has(entry.command),
        `editor/context entry references unknown command "${entry.command}"`
      ).toBe(true);
    }
  });

  it("groups entries into the seven curated sections in numeric order", () => {
    expect(entries).toBeDefined();
    const sections = (entries ?? [])
      .map((e) => (e.group ?? "").split("@")[0])
      .filter((s, i, arr) => arr.indexOf(s) === i);
    expect(sections).toEqual([
      "1_navigation",
      "2_proof",
      "3_sledgehammer",
      "4_preview",
      "5_spellcheck",
      "6_symbols",
      "9_repair"
    ]);
  });

  it("only adds the extra `isabelle.sledgehammerHasSuggestion` clause for Pick Sledgehammer Suggestion", () => {
    expect(entries).toBeDefined();
    const gated = (entries ?? []).filter((e) =>
      (e.when ?? "").includes("isabelle.sledgehammerHasSuggestion")
    );
    expect(gated.map((e) => e.command)).toEqual(["isabelle.pickSledgehammerSuggestion"]);
  });
});
