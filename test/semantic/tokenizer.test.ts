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
});
