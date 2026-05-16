import { describe, expect, it } from "vitest";
import { extractCommandSpans } from "../../src/document/commandSpans";
import { findDeclarationByName, wordAt } from "../../src/semantic/definitions";

describe("findDeclarationByName", () => {
  it("finds the nearest previous local declaration by exact name", () => {
    const spans = extractCommandSpans(
      "file:///Definitions.thy",
      [
        "theory Definitions",
        "imports Main",
        "begin",
        "definition answer :: nat where \"answer = 42\"",
        "lemma uses_answer: \"answer = 42\"",
        "  by simp",
        "end"
      ].join("\n"),
      1
    );

    const declaration = findDeclarationByName("answer", spans, { line: 4, character: 21 });

    expect(declaration?.span.kind).toBe("definition");
    expect(declaration?.span.range.start).toEqual({ line: 3, character: 0 });
  });

  it("matches primed Isabelle names exactly", () => {
    const spans = extractCommandSpans(
      "file:///Primed.thy",
      [
        "theory Primed",
        "imports Main",
        "begin",
        "lemma foo': True",
        "  by simp",
        "lemma foo: True",
        "  by simp",
        "end"
      ].join("\n"),
      1
    );

    expect(findDeclarationByName("foo'", spans)?.span.name).toBe("foo'");
    expect(findDeclarationByName("foo", spans)?.span.name).toBe("foo");
  });
});

describe("wordAt", () => {
  it("returns Isabelle identifier ranges at a cursor position", () => {
    expect(wordAt("lemma foo': True", 9)).toEqual({
      word: "foo'",
      start: 6,
      end: 10
    });
  });
});
