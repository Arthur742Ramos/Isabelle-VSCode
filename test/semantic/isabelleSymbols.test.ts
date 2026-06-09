import { describe, expect, it } from "vitest";
import {
  ALL_ISABELLE_SYMBOLS,
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
