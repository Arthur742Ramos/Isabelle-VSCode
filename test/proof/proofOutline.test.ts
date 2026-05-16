import { describe, expect, it } from "vitest";
import { extractCommandSpans } from "../../src/document/commandSpans";
import {
  buildProofOutline,
  findCommandSpanAtOrBefore,
  nextCommandSpan,
  previousCommandSpan,
  proofActionsForCommand
} from "../../src/proof/proofOutline";

describe("proof outline helpers", () => {
  const spans = extractCommandSpans(
    "file:///Outline.thy",
    [
      "theory Outline",
      "imports Main",
      "begin",
      "definition foo where \"foo = True\"",
      "lemma fooI: foo",
      "proof -",
      "  have h: True by simp",
      "  show foo unfolding foo_def by fact",
      "qed",
      "end"
    ].join("\n"),
    3
  );

  it("nests proof steps below proof statements", () => {
    const outline = buildProofOutline(spans);
    const lemma = outline.find((node) => node.span.kind === "lemma");

    expect(outline.map((node) => node.span.kind)).toEqual([
      "theory",
      "imports",
      "begin",
      "definition",
      "lemma",
      "end"
    ]);
    expect(lemma?.children.map((node) => node.span.kind)).toEqual([
      "proof",
      "have",
      "show",
      "qed"
    ]);
  });

  it("finds current, previous, and next command spans", () => {
    const current = findCommandSpanAtOrBefore(spans, { line: 6, character: 8 });
    expect(current?.kind).toBe("have");
    expect(previousCommandSpan(spans, { line: 6, character: 8 })?.kind).toBe("proof");
    expect(nextCommandSpan(spans, { line: 6, character: 8 })?.kind).toBe("show");
  });

  it("offers conservative proof insertions only for proof-bearing commands", () => {
    const lemma = spans.find((span) => span.kind === "lemma");
    const definition = spans.find((span) => span.kind === "definition");

    expect(proofActionsForCommand(lemma, "HOL").map((action) => action.kind)).toEqual([
      "refreshProofState",
      "buildActiveSession",
      "insertSorry",
      "insertOops"
    ]);
    expect(proofActionsForCommand(definition, "HOL").map((action) => action.kind)).toEqual([
      "refreshProofState",
      "buildActiveSession"
    ]);
  });
});
