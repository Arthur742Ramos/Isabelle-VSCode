import { describe, expect, it } from "vitest";
import { tokenizeSemanticLine } from "../../src/semantic/tokenizer";

describe("tokenizeSemanticLine", () => {
  it("marks Isabelle commands and declarations", () => {
    expect(tokenizeSemanticLine("lemma add_commute: \"a + b = b + a\"", 3)).toEqual([
      {
        line: 3,
        character: 0,
        length: 5,
        type: "keyword"
      },
      {
        line: 3,
        character: 6,
        length: 11,
        type: "function",
        modifiers: ["declaration"]
      }
    ]);
  });

  it("keeps primed Isabelle declaration names intact", () => {
    expect(tokenizeSemanticLine("lemma foo': True", 0)).toContainEqual({
      line: 0,
      character: 6,
      length: 4,
      type: "function",
      modifiers: ["declaration"]
    });
  });

  it("marks schematic variables, type variables, and Isabelle symbol escapes", () => {
    expect(tokenizeSemanticLine("fixes ?x :: 'a and y \\<in> A", 0)).toMatchObject([
      {
        character: 6,
        length: 2,
        type: "variable"
      },
      {
        character: 12,
        length: 2,
        type: "typeParameter"
      },
      {
        character: 21,
        length: 5,
        type: "operator"
      }
    ]);
  });

  function declarationName(line: string): { character: number; length: number } | undefined {
    return tokenizeSemanticLine(line, 0).find((token) => token.type === "function");
  }

  it("does not mark a word inside a quoted proposition as a declaration name", () => {
    // The `x` here is part of the proposition, not a declared name.
    expect(declarationName('have "x = (if P then Q else R)"')).toBeUndefined();
    // An anonymous lemma declares nothing — `True` must not be marked.
    expect(declarationName('lemma "True"')).toBeUndefined();
    // `show` likewise: the goal is in quotes.
    expect(declarationName('show "P \\<longrightarrow> Q"')).toBeUndefined();
  });

  it("marks a declaration name that follows a type parameter or locale target", () => {
    expect(declarationName("datatype 'a list = Nil | Cons 'a \"'a list\"")).toMatchObject({
      character: 12,
      length: 4
    });
    expect(declarationName("definition (in monoid) e :: 'a where \"e = one\"")).toMatchObject({
      character: 23,
      length: 1
    });
  });

  it("still marks a plain leading declaration name", () => {
    expect(declarationName("definition foo :: nat where \"foo = 0\"")).toMatchObject({
      character: 11,
      length: 3
    });
    expect(declarationName("lemma bar: True")).toMatchObject({ character: 6, length: 3 });
  });
});
