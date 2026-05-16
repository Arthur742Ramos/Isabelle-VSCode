import { describe, expect, it } from "vitest";
import { extractCommandSpans } from "../../src/document/commandSpans";

describe("extractCommandSpans", () => {
  it("extracts Isabelle command spans and declaration names", () => {
    const spans = extractCommandSpans(
      "file:///Example.thy",
      [
        "theory Example",
        "imports Main",
        "begin",
        "",
        "lemma add_commute: \"a + b = b + a\"",
        "  by simp",
        "end"
      ].join("\n"),
      7
    );

    expect(spans.map((span) => [span.kind, span.name])).toEqual([
      ["theory", undefined],
      ["imports", undefined],
      ["begin", undefined],
      ["lemma", "add_commute"],
      ["by", undefined],
      ["end", undefined]
    ]);
    expect(spans[3].range).toEqual({
      start: { line: 4, character: 0 },
      end: { line: 5, character: 2 }
    });
  });

  it("skips keywords inside block comments and quoted terms", () => {
    const spans = extractCommandSpans(
      "file:///Commented.thy",
      [
        "(*",
        "lemma ignored: True",
        "*)",
        "text \"theorem ignored: False\"",
        "lemma kept: True",
        "  sorry"
      ].join("\n"),
      1
    );

    expect(spans.map((span) => span.kind)).toEqual(["text", "lemma", "sorry"]);
    expect(spans[1].name).toBe("kept");
  });

  it("carries string and cartouche state across lines", () => {
    const open = "\u2039";
    const close = "\u203A";
    const spans = extractCommandSpans(
      "file:///Cartouche.thy",
      [
        `text ${open}`,
        "lemma ignored_cartouche: True",
        close,
        "text \"",
        "lemma ignored_string: True",
        "\"",
        "lemma kept: True"
      ].join("\n"),
      2
    );

    expect(spans.map((span) => [span.kind, span.name])).toEqual([
      ["text", undefined],
      ["text", undefined],
      ["lemma", "kept"]
    ]);
  });
});
