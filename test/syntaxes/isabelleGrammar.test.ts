import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ISABELLE_COMMANDS, type IsabelleCommandCategory } from "../../src/semantic/isabelleSyntax";
import { ISABELLE_METHODS } from "../../src/semantic/proofMethods";

const root = resolve(__dirname, "..", "..");

interface GrammarPattern {
  name?: string;
  match?: string;
  begin?: string;
  end?: string;
  include?: string;
  patterns?: GrammarPattern[];
  captures?: Record<string, { name?: string }>;
  beginCaptures?: Record<string, { name?: string }>;
  endCaptures?: Record<string, { name?: string }>;
}

interface Grammar {
  scopeName: string;
  fileTypes?: string[];
  patterns: GrammarPattern[];
  repository: Record<string, GrammarPattern>;
}

const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
  contributes?: { grammars?: Array<{ language: string; scopeName: string; path: string }> };
};

const grammarContribution = (packageJson.contributes?.grammars ?? []).find(
  (entry) => entry.language === "isabelle"
);

const grammar = JSON.parse(
  readFileSync(resolve(root, "syntaxes", "isabelle.tmLanguage.json"), "utf8")
) as Grammar;

/**
 * Pull the alternatives out of a keyword/method `match` of the canonical shape
 * `(?<![A-Za-z0-9_'])(?:a|b|c)(?![A-Za-z0-9_'])`. The non-capturing alternation
 * group never itself contains a `)`, so capturing up to the first `)` yields
 * exactly the pipe-separated keyword list.
 */
function alternativesOf(repoKey: string): Set<string> {
  const entry = grammar.repository[repoKey];
  expect(entry, `repository.${repoKey} should exist`).toBeDefined();
  const source = entry.match ?? "";
  const group = /\(\?:([^)]*)\)/.exec(source);
  expect(group, `repository.${repoKey} should be a (?:...) alternation`).not.toBeNull();
  return new Set((group as RegExpExecArray)[1].split("|"));
}

// Canonical category -> the grammar repository entry + scope that must carry it.
const CATEGORY_TO_GRAMMAR: Record<IsabelleCommandCategory, { repoKey: string; scope: string }> = {
  theory: { repoKey: "keywords-theory", scope: "keyword.control.theory.isabelle" },
  declaration: { repoKey: "keywords-declaration", scope: "keyword.other.declaration.isabelle" },
  statement: { repoKey: "keywords-statement", scope: "keyword.control.statement.isabelle" },
  context: { repoKey: "keywords-context", scope: "keyword.control.context.isabelle" },
  proof: { repoKey: "keywords-proof", scope: "keyword.control.proof.isabelle" },
  proofTerminal: { repoKey: "keywords-proof-terminal", scope: "keyword.control.proof.terminal.isabelle" },
  diagnostic: { repoKey: "keywords-diagnostic", scope: "keyword.other.diagnostic.isabelle" },
  ml: { repoKey: "keywords-ml", scope: "keyword.other.ml.isabelle" }
};

function canonicalKeywordsByCategory(category: IsabelleCommandCategory): string[] {
  return [...ISABELLE_COMMANDS.values()]
    .filter((command) => command.category === category)
    .map((command) => command.keyword);
}

describe("Isabelle TextMate grammar manifest", () => {
  it("is contributed by package.json against the isabelle language and source.isabelle scope", () => {
    expect(grammarContribution, "package.json should contribute an isabelle grammar").toBeDefined();
    expect(grammarContribution?.scopeName).toBe("source.isabelle");
    expect(grammarContribution?.path).toBe("./syntaxes/isabelle.tmLanguage.json");
    expect(existsSync(resolve(root, grammarContribution?.path ?? "")), "grammar file must exist").toBe(true);
  });

  it("declares the source.isabelle scope and the .thy file type", () => {
    expect(grammar.scopeName).toBe("source.isabelle");
    expect(grammar.fileTypes).toContain("thy");
  });

  it("has no dangling repository includes", () => {
    const keys = new Set(Object.keys(grammar.repository));
    const seen = new Set<string>();
    const walk = (patterns: GrammarPattern[] | undefined): void => {
      for (const pattern of patterns ?? []) {
        if (pattern.include) {
          const key = pattern.include.replace(/^#/, "");
          seen.add(key);
          expect(keys.has(key), `include "#${key}" must resolve to a repository entry`).toBe(true);
        }
        walk(pattern.patterns);
      }
    };
    walk(grammar.patterns);
    for (const entry of Object.values(grammar.repository)) {
      walk(entry.patterns);
    }
    // The top-level keyword categories must actually be wired into the scanner.
    for (const { repoKey } of Object.values(CATEGORY_TO_GRAMMAR)) {
      expect(seen.has(repoKey), `top-level patterns should include #${repoKey}`).toBe(true);
    }
  });

  it("covers every canonical command keyword in its category, with the right scope and no strays", () => {
    const allCanonical = new Set<string>();
    for (const category of Object.keys(CATEGORY_TO_GRAMMAR) as IsabelleCommandCategory[]) {
      const { repoKey, scope } = CATEGORY_TO_GRAMMAR[category];
      expect(grammar.repository[repoKey]?.name, `${repoKey} scope`).toBe(scope);
      const alternatives = alternativesOf(repoKey);
      for (const keyword of canonicalKeywordsByCategory(category)) {
        allCanonical.add(keyword);
        expect(alternatives.has(keyword), `${repoKey} must list "${keyword}"`).toBe(true);
      }
      // No stray keyword: every alternative must be a real command of this category.
      const categoryKeywords = new Set(canonicalKeywordsByCategory(category));
      for (const alternative of alternatives) {
        expect(
          categoryKeywords.has(alternative),
          `${repoKey} lists "${alternative}" which is not a canonical ${category} command`
        ).toBe(true);
      }
    }
    // Sanity: the union of grammar keyword categories equals the canonical set.
    const unionFromGrammar = new Set<string>();
    for (const { repoKey } of Object.values(CATEGORY_TO_GRAMMAR)) {
      for (const alternative of alternativesOf(repoKey)) {
        unionFromGrammar.add(alternative);
      }
    }
    expect([...unionFromGrammar].sort()).toEqual([...allCanonical].sort());
  });

  it("covers every canonical proof method (the null method `-` is handled contextually)", () => {
    const methodAlternatives = alternativesOf("proof-methods");
    expect(grammar.repository["proof-methods"]?.name).toBe("support.function.method.isabelle");
    for (const name of ISABELLE_METHODS.keys()) {
      if (name === "-") {
        continue;
      }
      expect(methodAlternatives.has(name), `proof-methods must list "${name}"`).toBe(true);
    }
    // The `-` null method must NOT be in the global alternation (it would mis-color
    // subtraction); it is matched only after `proof` via the proof-dash pattern.
    expect(methodAlternatives.has("-"), "`-` must not be in the global method alternation").toBe(false);
    const proofDash = grammar.repository["proof-dash"];
    expect(proofDash, "proof-dash pattern should exist").toBeDefined();
    expect(proofDash?.captures?.["3"]?.name).toBe("keyword.other.null-method.isabelle");
    expect(proofDash?.match).toContain("proof");
  });

  it("models nested block comments and recursive cartouches (unicode + ASCII)", () => {
    const comment = grammar.repository["comment"];
    expect(comment?.begin).toBe("\\(\\*");
    expect(comment?.end).toBe("\\*\\)");
    expect((comment?.patterns ?? []).some((pattern) => pattern.include === "#comment")).toBe(true);

    const cartouche = grammar.repository["cartouche"];
    expect(cartouche?.begin).toBe("\\x{2039}");
    expect(cartouche?.end).toBe("\\x{203a}");
    expect((cartouche?.patterns ?? []).some((pattern) => pattern.include === "#cartouche")).toBe(true);

    const cartoucheAscii = grammar.repository["cartouche-ascii"];
    expect(cartoucheAscii?.begin).toBe("\\\\<open>");
    expect(cartoucheAscii?.end).toBe("\\\\<close>");
    expect(
      (cartoucheAscii?.patterns ?? []).some((pattern) => pattern.include === "#cartouche-ascii")
    ).toBe(true);
  });

  it("matches Isabelle markup symbols, antiquotations, and type/schematic variables", () => {
    expect(grammar.repository["isabelle-symbol"]?.match).toBe("\\\\<\\^?[A-Za-z]+>");
    expect(grammar.repository["isabelle-symbol"]?.name).toBe("constant.character.isabelle-symbol.isabelle");
    expect(grammar.repository["antiquotation"]?.begin).toContain("@\\{");
    expect(grammar.repository["type-variable"]?.match).toContain("'[A-Za-z_]");
    expect(grammar.repository["schematic-variable"]?.match).toContain("\\?[A-Za-z_]");
  });
});
