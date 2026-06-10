import { describe, expect, it } from "vitest";
import {
  ALL_ISABELLE_SYMBOLS,
  buildSymbolHoverMarkdown,
  buildSymbolPickItems,
  findGlyphSpanAt,
  findSymbolCompletionContext,
  ISABELLE_SYMBOL_COUNT,
  resolveSymbolByGlyph,
  resolveSymbolByName,
  symbolFilterText
} from "../../src/semantic/isabelleSymbols";

describe("Isabelle symbol table", () => {
  it("loads a substantial, non-trivial table", () => {
    expect(ISABELLE_SYMBOL_COUNT).toBeGreaterThan(400);
    expect(ALL_ISABELLE_SYMBOLS.length).toBe(ISABELLE_SYMBOL_COUNT);
  });

  it("resolves canonical logic and arrow symbols to the correct glyph", () => {
    // Code points are pinned against Isabelle's authoritative etc/symbols.
    expect(resolveSymbolByName("\\<forall>")?.glyph).toBe("\u2200"); // ∀
    expect(resolveSymbolByName("\\<exists>")?.glyph).toBe("\u2203"); // ∃
    expect(resolveSymbolByName("\\<Longrightarrow>")?.glyph).toBe("\u27f9"); // ⟹
    expect(resolveSymbolByName("\\<lambda>")?.glyph).toBe("\u03bb"); // λ
    expect(resolveSymbolByName("\\<in>")?.glyph).toBe("\u2208"); // ∈
  });

  it("exposes the ASCII abbreviations Isabelle accepts", () => {
    expect(resolveSymbolByName("\\<forall>")?.abbrevs).toContain("ALL");
    expect(resolveSymbolByName("\\<Longrightarrow>")?.abbrevs).toContain("==>");
    expect(resolveSymbolByName("\\<lambda>")?.abbrevs).toContain("%");
  });

  it("handles astral-plane glyphs as a single code point", () => {
    const zero = resolveSymbolByName("\\<zero>");
    expect(zero?.glyph).toBe("\u{1d7ec}"); // 𝟬
    expect([...(zero?.glyph ?? "")].length).toBe(1);
  });

  it("marks markup-only control symbols with no glyph", () => {
    const latex = resolveSymbolByName("\\<^latex>");
    expect(latex).toBeDefined();
    expect(latex?.glyph).toBeNull();
    expect(latex?.code).toBeNull();
  });

  it("round-trips name <-> glyph for every glyph symbol", () => {
    for (const symbol of ALL_ISABELLE_SYMBOLS) {
      if (symbol.glyph === null) {
        continue;
      }
      expect(resolveSymbolByGlyph(symbol.glyph)?.name).toBe(symbol.name);
    }
  });

  it("never assigns an ASCII letter or digit glyph (ordinary text is safe)", () => {
    for (const code of [..."0123456789abcdefXYZ"].map((c) => c.codePointAt(0))) {
      expect(resolveSymbolByGlyph(String.fromCodePoint(code as number))).toBeUndefined();
    }
  });

  it("builds filter text covering the name and abbreviations", () => {
    const forall = resolveSymbolByName("\\<forall>");
    const filter = symbolFilterText(forall!);
    expect(filter).toContain("\\<forall>");
    expect(filter).toContain("forall");
    expect(filter).toContain("ALL");
  });
});

describe("findSymbolCompletionContext", () => {
  function ctx(line: string) {
    return findSymbolCompletionContext(line, line.length);
  }

  it("fires on a lone backslash", () => {
    expect(ctx("have \\")).toEqual({ replaceStart: 5, query: "" });
  });

  it("fires after the opening bracket", () => {
    expect(ctx("\\<")).toEqual({ replaceStart: 0, query: "" });
  });

  it("captures a partial name after the bracket", () => {
    expect(ctx("  \\<fora")).toEqual({ replaceStart: 2, query: "fora" });
  });

  it("captures a control-symbol prefix", () => {
    expect(ctx("x\\<^bo")).toEqual({ replaceStart: 1, query: "bo" });
  });

  it("supports the no-bracket shorthand", () => {
    expect(ctx("\\fora")).toEqual({ replaceStart: 0, query: "fora" });
  });

  it("does not fire for a bare control caret without the bracket", () => {
    // Isabelle control symbols are written `\<^...>`, so `\^foo` is not a valid
    // symbol prefix and must not trigger completion.
    expect(ctx("\\^foo")).toBeUndefined();
    expect(ctx("a \\^bo")).toBeUndefined();
  });

  it("does not fire outside an open token", () => {
    expect(ctx("lemma foo")).toBeUndefined();
    expect(ctx("\\<forall> ")).toBeUndefined();
    expect(ctx("done")).toBeUndefined();
  });

  it("does not fire once the token is closed", () => {
    expect(ctx("\\<forall>")).toBeUndefined();
  });

  it("resolves the replacement range mid-line", () => {
    const line = "  from \\<fora rest";
    const result = findSymbolCompletionContext(line, "  from \\<fora".length);
    expect(result).toEqual({ replaceStart: "  from ".length, query: "fora" });
  });
});

describe("findGlyphSpanAt", () => {
  it("spans a single BMP glyph", () => {
    const line = "x \u2200 y"; // ∀ at index 2
    expect(findGlyphSpanAt(line, 2)).toEqual({ glyph: "\u2200", start: 2, end: 3 });
  });

  it("spans an astral glyph as two UTF-16 units from the high half", () => {
    const line = "\u{1d7ec}"; // 𝟬 — \<zero>
    expect(findGlyphSpanAt(line, 0)).toEqual({ glyph: "\u{1d7ec}", start: 0, end: 2 });
  });

  it("spans an astral glyph when the cursor sits on the low half", () => {
    const line = "\u{1d7ec}";
    expect(findGlyphSpanAt(line, 1)).toEqual({ glyph: "\u{1d7ec}", start: 0, end: 2 });
  });

  it("returns undefined past the end of the line", () => {
    expect(findGlyphSpanAt("ab", 2)).toBeUndefined();
    expect(findGlyphSpanAt("", 0)).toBeUndefined();
  });

  it("treats a lone low surrogate as a single unit, not the previous char", () => {
    // Ill-formed UTF-16: "a" then a lone low surrogate. At index 1 the result
    // must be the surrogate itself, not "a".
    const line = "a\udc00";
    expect(findGlyphSpanAt(line, 1)).toEqual({ glyph: "\udc00", start: 1, end: 2 });
  });
});

describe("buildSymbolHoverMarkdown", () => {
  it("describes a glyph symbol with token, code point, group, and abbreviations", () => {
    const md = buildSymbolHoverMarkdown(resolveSymbolByName("\\<forall>")!);
    expect(md).toContain("\u2200");
    expect(md).toContain("\\<forall>");
    expect(md).toContain("U+2200");
    expect(md).toContain("logic");
    expect(md).toContain("ALL");
  });

  it("notes markup symbols that have no glyph", () => {
    const md = buildSymbolHoverMarkdown(resolveSymbolByName("\\<^latex>")!);
    expect(md).toContain("\\<^latex>");
    expect(md.toLowerCase()).toContain("markup");
    expect(md).not.toContain("U+");
  });
});

describe("buildSymbolPickItems", () => {
  const items = buildSymbolPickItems();

  it("includes every symbol", () => {
    expect(items.length).toBe(ISABELLE_SYMBOL_COUNT);
  });

  it("labels glyph symbols with the glyph and inserts the glyph", () => {
    const forall = items.find((item) => item.name === "\\<forall>");
    expect(forall?.label).toBe("\u2200");
    expect(forall?.insertText).toBe("\u2200");
    expect(forall?.detail).toContain("logic");
    expect(forall?.detail).toContain("ALL");
    expect(forall?.detail).toContain("\\<forall>");
  });

  it("falls back to the token for markup symbols with no glyph", () => {
    const latex = items.find((item) => item.name === "\\<^latex>");
    expect(latex?.label).toBe("\\<^latex>");
    expect(latex?.insertText).toBe("\\<^latex>");
  });

  it("sorts by group then token", () => {
    for (let i = 1; i < items.length; i++) {
      const previous = items[i - 1];
      const current = items[i];
      const previousGroup = previous.group ?? "~";
      const currentGroup = current.group ?? "~";
      const ordered =
        previousGroup < currentGroup ||
        (previousGroup === currentGroup && previous.name <= current.name);
      expect(ordered, `${previous.name} before ${current.name}`).toBe(true);
    }
  });
});
