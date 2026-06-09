import { describe, expect, it } from "vitest";
import {
  ALL_ISABELLE_SYMBOLS,
  symbolsToAscii,
  symbolsToUnicode
} from "../../src/semantic/isabelleSymbols";

describe("symbolsToUnicode", () => {
  it("converts symbol tokens to glyphs", () => {
    expect(symbolsToUnicode("lemma \\<forall>x. P x")).toBe("lemma \u2200x. P x");
    expect(symbolsToUnicode("A \\<and> B \\<longrightarrow> C")).toBe("A \u2227 B \u27f6 C");
  });

  it("leaves ordinary text untouched", () => {
    expect(symbolsToUnicode("lemma foo: \"x = x\" by simp")).toBe("lemma foo: \"x = x\" by simp");
  });

  it("leaves unknown or malformed tokens untouched", () => {
    expect(symbolsToUnicode("\\<not_a_symbol> \\<>")).toBe("\\<not_a_symbol> \\<>");
  });

  it("converts control-symbol tokens that have a glyph", () => {
    // \<^sub> has a code point (⇩), so it converts and round-trips.
    expect(symbolsToUnicode("x\\<^sub>2")).toBe("x\u21e92");
  });
});

describe("symbolsToAscii", () => {
  it("converts glyphs back to symbol tokens", () => {
    expect(symbolsToAscii("lemma \u2200x. P x")).toBe("lemma \\<forall>x. P x");
    expect(symbolsToAscii("A \u2227 B \u27f6 C")).toBe("A \\<and> B \\<longrightarrow> C");
  });

  it("leaves ordinary ASCII untouched, including digits and letters", () => {
    expect(symbolsToAscii("lemma foo123: ABC by simp")).toBe("lemma foo123: ABC by simp");
  });

  it("handles astral-plane glyphs as a single unit", () => {
    // \<zero> renders as 𝟬 (U+1D7EC), distinct from ASCII '0'.
    expect(symbolsToAscii("\u{1d7ec}")).toBe("\\<zero>");
    expect(symbolsToAscii("0")).toBe("0");
  });
});

describe("conversion round-trips", () => {
  it("ascii -> unicode -> ascii is the identity for a representative line", () => {
    const source = "theorem t: \"\\<forall>x. \\<exists>y. x \\<le> y \\<and> P x \\<longrightarrow> Q y\"";
    expect(symbolsToAscii(symbolsToUnicode(source))).toBe(source);
  });

  it("round-trips every glyph symbol in both directions", () => {
    for (const symbol of ALL_ISABELLE_SYMBOLS) {
      if (symbol.glyph === null) {
        continue;
      }
      expect(symbolsToUnicode(symbol.name)).toBe(symbol.glyph);
      expect(symbolsToAscii(symbol.glyph)).toBe(symbol.name);
      expect(symbolsToAscii(symbolsToUnicode(symbol.name))).toBe(symbol.name);
    }
  });

  it("converting to unicode is idempotent", () => {
    const once = symbolsToUnicode("\\<forall>\\<exists>");
    expect(symbolsToUnicode(once)).toBe(once);
  });

  it("converting to ascii is idempotent", () => {
    const once = symbolsToAscii("\u2200\u2203");
    expect(symbolsToAscii(once)).toBe(once);
  });
});
