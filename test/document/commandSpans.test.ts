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

  it("recognises the broader HOL/AFP command vocabulary and its names", () => {
    // A theory exercising specifications, type classes, locales, and
    // diagnostics that the foundation previously left unhighlighted.
    const spans = extractCommandSpans(
      "file:///Vocabulary.thy",
      [
        "theory Vocabulary",
        "imports Main",
        "begin",
        "typedecl point",
        "type_synonym name = string",
        "typedef pos = \"{n :: nat. n > 0}\"",
        "  by auto",
        "codatatype 'a stream = SCons 'a \"'a stream\"",
        "class ordered =",
        "  fixes le :: \"'a \\<Rightarrow> 'a \\<Rightarrow> bool\"",
        "instantiation nat :: ordered",
        "begin",
        "end",
        "interpretation trivial: ordered \"(\\<le>)\"",
        "  by standard",
        "lift_definition pos_one :: pos is \"1 :: nat\"",
        "  by simp",
        "lemmas useful = conjI disjI1",
        "value \"2 + 2 :: nat\"",
        "find_theorems \"_ + _ = _ + _\"",
        "ML \\<open>writeln \"hi\"\\<close>",
        "end"
      ].join("\n"),
      1
    );

    const byKind = spans.map((span) => [span.kind, span.name]);
    expect(byKind).toContainEqual(["typedecl", "point"]);
    expect(byKind).toContainEqual(["type_synonym", "name"]);
    expect(byKind).toContainEqual(["typedef", "pos"]);
    // `codatatype 'a stream` is recognised; the name follows the type
    // parameter, which the local name extractor does not yet skip.
    expect(spans.map((span) => span.kind)).toContain("codatatype");
    expect(byKind).toContainEqual(["class", "ordered"]);
    expect(byKind).toContainEqual(["instantiation", undefined]);
    expect(byKind).toContainEqual(["interpretation", undefined]);
    expect(byKind).toContainEqual(["lift_definition", "pos_one"]);
    expect(byKind).toContainEqual(["lemmas", "useful"]);
    expect(byKind).toContainEqual(["value", undefined]);
    expect(byKind).toContainEqual(["find_theorems", undefined]);
    expect(byKind).toContainEqual(["ML", undefined]);
  });
});
