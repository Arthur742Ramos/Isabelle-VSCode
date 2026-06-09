import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const configPath = resolve(__dirname, "..", "..", "language-configuration.json");

interface AutoClosingPair {
  open: string;
  close: string;
  notIn?: string[];
}

interface LanguageConfiguration {
  comments?: { blockComment?: [string, string] };
  brackets?: Array<[string, string]>;
  autoClosingPairs?: Array<AutoClosingPair | [string, string]>;
  surroundingPairs?: Array<AutoClosingPair | [string, string]>;
  wordPattern?: string;
}

const config = JSON.parse(readFileSync(configPath, "utf8")) as LanguageConfiguration;

// Isabelle's commonly-typed Unicode bracket delimiters.
const CARTOUCHE: [string, string] = ["\u2039", "\u203a"]; // ‹ ›
const SEMANTIC_BRACKETS: [string, string] = ["\u27e6", "\u27e7"]; // ⟦ ⟧
const ANGLE_BRACKETS: [string, string] = ["\u27e8", "\u27e9"]; // ⟨ ⟩
const ISABELLE_PAIRS = [CARTOUCHE, SEMANTIC_BRACKETS, ANGLE_BRACKETS];

function pairOf(entry: AutoClosingPair | [string, string]): [string, string] {
  return Array.isArray(entry) ? entry : [entry.open, entry.close];
}

function includesPair(list: Array<AutoClosingPair | [string, string]> | undefined, [open, close]: [string, string]): boolean {
  return (list ?? []).some((entry) => {
    const [o, c] = pairOf(entry);
    return o === open && c === close;
  });
}

function matchesWholeWord(pattern: string, text: string): boolean {
  return new RegExp(`^(?:${pattern})$`).test(text);
}

describe("language-configuration.json", () => {
  it("keeps the Isabelle block-comment delimiters", () => {
    expect(config.comments?.blockComment).toEqual(["(*", "*)"]);
  });

  it("declares the Isabelle Unicode bracket pairs for matching", () => {
    for (const pair of ISABELLE_PAIRS) {
      expect(includesPair(config.brackets, pair), `brackets should include ${pair.join(" ")}`).toBe(true);
    }
    // ASCII brackets remain.
    for (const pair of [["(", ")"], ["[", "]"], ["{", "}"]] as Array<[string, string]>) {
      expect(includesPair(config.brackets, pair)).toBe(true);
    }
  });

  it("auto-closes the Isabelle Unicode bracket pairs", () => {
    for (const pair of ISABELLE_PAIRS) {
      expect(includesPair(config.autoClosingPairs, pair), `autoClosingPairs should include ${pair.join(" ")}`).toBe(true);
    }
  });

  it("surrounds selections with every configured pair", () => {
    for (const pair of [...ISABELLE_PAIRS, ['"', '"']] as Array<[string, string]>) {
      expect(includesPair(config.surroundingPairs, pair), `surroundingPairs should include ${pair.join(" ")}`).toBe(true);
    }
  });

  it("does not auto-insert a closing quote inside comments", () => {
    const quote = (config.autoClosingPairs ?? []).find(
      (entry): entry is AutoClosingPair => !Array.isArray(entry) && entry.open === '"'
    );
    expect(quote?.notIn).toContain("comment");
  });

  it("provides an Isabelle-aware wordPattern that compiles", () => {
    expect(typeof config.wordPattern).toBe("string");
    expect(() => new RegExp(config.wordPattern as string)).not.toThrow();
  });

  it("treats symbol escapes and primed identifiers as single words", () => {
    const pattern = config.wordPattern as string;
    expect(matchesWholeWord(pattern, "\\<alpha>")).toBe(true);
    expect(matchesWholeWord(pattern, "\\<^sub>")).toBe(true);
    expect(matchesWholeWord(pattern, "xs'")).toBe(true);
    expect(matchesWholeWord(pattern, "foo_bar")).toBe(true);
    // A space is a word boundary, so two identifiers are not one word.
    expect(matchesWholeWord(pattern, "a b")).toBe(false);
  });
});
