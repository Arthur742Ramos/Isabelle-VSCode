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
    expect(byKind).toContainEqual(["codatatype", "stream"]);
    expect(byKind).toContainEqual(["class", "ordered"]);
    expect(byKind).toContainEqual(["instantiation", undefined]);
    expect(byKind).toContainEqual(["interpretation", undefined]);
    expect(byKind).toContainEqual(["lift_definition", "pos_one"]);
    expect(byKind).toContainEqual(["lemmas", "useful"]);
    expect(byKind).toContainEqual(["value", undefined]);
    expect(byKind).toContainEqual(["find_theorems", undefined]);
    expect(byKind).toContainEqual(["ML", undefined]);
  });

  it("extracts declaration names that follow type parameters and locale targets", () => {
    const spans = extractCommandSpans(
      "file:///TypeParams.thy",
      [
        "theory TypeParams",
        "imports Main",
        "begin",
        "datatype 'a list = Nil | Cons 'a \"'a list\"",
        "codatatype ('a, 'b) tree = Node 'a 'b",
        "type_synonym 'a env = \"string \\<Rightarrow> 'a\"",
        "definition (in monoid) e :: 'a where \"e = one\"",
        "lemma (in group) inv_unique: True",
        "  by simp",
        "datatype nat' = Z | S nat'",
        "end"
      ].join("\n"),
      1
    );

    const byKind = new Map(spans.map((span) => [span.kind + ":" + span.range.start.line, span.name]));
    expect(byKind.get("datatype:3")).toBe("list");
    expect(byKind.get("codatatype:4")).toBe("tree");
    expect(byKind.get("type_synonym:5")).toBe("env");
    expect(byKind.get("definition:6")).toBe("e");
    expect(byKind.get("lemma:7")).toBe("inv_unique");
    // A name that simply happens to be primed (no leading type parameter) is
    // still taken verbatim.
    expect(byKind.get("datatype:9")).toBe("nat'");
  });

  it("leaves a name that precedes everything else untouched", () => {
    const spans = extractCommandSpans(
      "file:///PlainNames.thy",
      [
        "definition foo :: nat where \"foo = 0\"",
        "lemma bar: True",
        "  by simp"
      ].join("\n"),
      1
    );
    expect(spans.find((span) => span.kind === "definition")?.name).toBe("foo");
    expect(spans.find((span) => span.kind === "lemma")?.name).toBe("bar");
  });
});
