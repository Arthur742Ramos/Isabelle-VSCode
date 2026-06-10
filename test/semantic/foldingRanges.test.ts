import { describe, expect, it } from "vitest";
import {
  computeIsabelleFoldingRanges,
  IsabelleFoldingRange
} from "../../src/semantic/foldingRanges";

function kinds(ranges: readonly IsabelleFoldingRange[], kind: IsabelleFoldingRange["kind"]): IsabelleFoldingRange[] {
  return ranges.filter((range) => range.kind === kind);
}

function hasRange(
  ranges: readonly IsabelleFoldingRange[],
  start: number,
  end: number,
  kind: IsabelleFoldingRange["kind"]
): boolean {
  return ranges.some((range) => range.start === start && range.end === end && range.kind === kind);
}

describe("computeIsabelleFoldingRanges — invariants", () => {
  it("returns nothing for trivial input", () => {
    expect(computeIsabelleFoldingRanges("")).toEqual([]);
    expect(computeIsabelleFoldingRanges("lemma foo by simp\n")).toEqual([]);
  });

  it("never emits a single-line (zero-height) range", () => {
    const source = ["section \\<open>A\\<close>", "lemma foo proof qed", "(* one line *)"].join("\n");
    for (const range of computeIsabelleFoldingRanges(source)) {
      expect(range.end).toBeGreaterThan(range.start);
    }
  });

  it("returns ranges sorted by start ascending then end descending", () => {
    const source = [
      "section \\<open>Outer\\<close>", // 0
      "lemma a", // 1
      "proof -", // 2
      "  show ?thesis", // 3
      "  proof -", // 4
      "    show x", // 5
      "  qed", // 6
      "qed", // 7
      "subsection \\<open>Inner\\<close>", // 8
      "lemma b by simp" // 9
    ].join("\n");
    const ranges = computeIsabelleFoldingRanges(source);
    for (let i = 1; i < ranges.length; i++) {
      const previous = ranges[i - 1];
      const current = ranges[i];
      const ordered =
        previous.start < current.start ||
        (previous.start === current.start && previous.end >= current.end);
      expect(ordered).toBe(true);
    }
  });
});

describe("computeIsabelleFoldingRanges — comments", () => {
  it("folds a multi-line block comment", () => {
    const source = ["(* line0", "   line1", "   line2 *)", "lemma foo by simp"].join("\n");
    const ranges = computeIsabelleFoldingRanges(source);
    expect(hasRange(ranges, 0, 2, "comment")).toBe(true);
  });

  it("does not fold a single-line comment", () => {
    const ranges = computeIsabelleFoldingRanges("(* all on one line *)\nlemma foo by simp");
    expect(kinds(ranges, "comment")).toHaveLength(0);
  });

  it("treats a nested comment as one outer fold", () => {
    const source = ["(* a", "   (* b", "      c *)", "   d *)", "end"].join("\n");
    const ranges = computeIsabelleFoldingRanges(source);
    expect(kinds(ranges, "comment")).toHaveLength(1);
    expect(hasRange(ranges, 0, 3, "comment")).toBe(true);
  });
});

describe("computeIsabelleFoldingRanges — proofs", () => {
  it("folds a proof..qed block", () => {
    const source = ["lemma foo", "proof -", "  show ?thesis by auto", "qed", ""].join("\n");
    const ranges = computeIsabelleFoldingRanges(source);
    expect(hasRange(ranges, 1, 3, "region")).toBe(true);
  });

  it("folds nested proofs independently", () => {
    const source = [
      "lemma foo", // 0
      "proof -", // 1
      "  have a", // 2
      "  proof -", // 3
      "    show b by auto", // 4
      "  qed", // 5
      "  show ?thesis by auto", // 6
      "qed" // 7
    ].join("\n");
    const ranges = kinds(computeIsabelleFoldingRanges(source), "region");
    expect(hasRange(ranges, 1, 7, "region")).toBe(true);
    expect(hasRange(ranges, 3, 5, "region")).toBe(true);
  });

  it("does not fold a single-line proof", () => {
    const ranges = computeIsabelleFoldingRanges("lemma foo proof qed\n");
    expect(kinds(ranges, "region")).toHaveLength(0);
  });

  it("ignores an unmatched qed without crashing", () => {
    expect(() => computeIsabelleFoldingRanges("qed\nqed\n")).not.toThrow();
    expect(computeIsabelleFoldingRanges("qed\nqed\n")).toEqual([]);
  });

  it("ignores an unterminated proof at end of file", () => {
    const ranges = computeIsabelleFoldingRanges("lemma foo\nproof -\n  show x\n");
    expect(kinds(ranges, "region")).toHaveLength(0);
  });
});

describe("computeIsabelleFoldingRanges — heading hierarchy", () => {
  const source = [
    "section \\<open>One\\<close>", // 0
    "lemma a by simp", // 1
    "subsection \\<open>One.A\\<close>", // 2
    "lemma b by simp", // 3
    "section \\<open>Two\\<close>", // 4
    "lemma c by simp", // 5
    "" // 6 (trailing blank)
  ].join("\n");

  it("folds a section down to the next same-level heading", () => {
    const ranges = computeIsabelleFoldingRanges(source);
    expect(hasRange(ranges, 0, 3, "region")).toBe(true);
  });

  it("nests a subsection inside its section", () => {
    const ranges = computeIsabelleFoldingRanges(source);
    expect(hasRange(ranges, 2, 3, "region")).toBe(true);
  });

  it("folds the final section to the last non-empty line, trimming trailing blanks", () => {
    const ranges = computeIsabelleFoldingRanges(source);
    expect(hasRange(ranges, 4, 5, "region")).toBe(true);
  });

  it("respects level ordering: a higher-level heading closes a lower one", () => {
    const nested = [
      "chapter \\<open>C\\<close>", // 0
      "section \\<open>S\\<close>", // 1
      "subsection \\<open>SS\\<close>", // 2
      "lemma x by simp", // 3
      "section \\<open>S2\\<close>", // 4
      "lemma y by simp" // 5
    ].join("\n");
    const ranges = computeIsabelleFoldingRanges(nested);
    // chapter spans the whole body.
    expect(hasRange(ranges, 0, 5, "region")).toBe(true);
    // first section closes when the next section starts.
    expect(hasRange(ranges, 1, 3, "region")).toBe(true);
    // subsection closes at the same boundary as its section.
    expect(hasRange(ranges, 2, 3, "region")).toBe(true);
  });
});

describe("computeIsabelleFoldingRanges — theory header", () => {
  it("folds a multi-line theory header to the line above begin", () => {
    const source = [
      "theory Foo", // 0
      "  imports Main", // 1
      "    Other", // 2
      "begin", // 3
      "lemma foo by simp" // 4
    ].join("\n");
    const ranges = computeIsabelleFoldingRanges(source);
    expect(hasRange(ranges, 0, 2, "imports")).toBe(true);
  });

  it("does not fold a single-line theory header", () => {
    const ranges = computeIsabelleFoldingRanges("theory Foo imports Main begin\nlemma x by simp\nend");
    expect(kinds(ranges, "imports")).toHaveLength(0);
  });
});

describe("computeIsabelleFoldingRanges — begin..end blocks", () => {
  it("folds a context block but not the theory body", () => {
    const source = [
      "theory T", // 0
      "imports Main", // 1
      "begin", // 2
      "context fixes x begin", // 3
      "  definition d where \"d = x\"", // 4
      "  lemma l: \"d = x\" by simp", // 5
      "end", // 6
      "end" // 7
    ].join("\n");
    const ranges = computeIsabelleFoldingRanges(source);
    // The context body folds...
    expect(hasRange(ranges, 3, 6, "region")).toBe(true);
    // ...but the theory body (begin line 2 .. end line 7) does not.
    expect(ranges.some((r) => r.start === 2)).toBe(false);
  });

  it("folds instantiation and locale blocks independently", () => {
    const source = [
      "theory T", // 0
      "imports Main", // 1
      "begin", // 2
      "instantiation nat :: ord", // 3
      "begin", // 4
      "  definition le where \"le = (\\<le>)\"", // 5
      "  instance ..", // 6
      "end", // 7
      "locale L =", // 8
      "  fixes f", // 9
      "begin", // 10
      "  lemma e: True by simp", // 11
      "end", // 12
      "end" // 13
    ].join("\n");
    const ranges = computeIsabelleFoldingRanges(source);
    expect(hasRange(ranges, 4, 7, "region")).toBe(true);
    expect(hasRange(ranges, 10, 12, "region")).toBe(true);
    // theory body begin (2) is not folded.
    expect(ranges.some((r) => r.start === 2)).toBe(false);
  });

  it("does not fold a single-line begin..end block", () => {
    const source = ["theory T", "imports Main", "begin", "context begin end", "end"].join("\n");
    const ranges = computeIsabelleFoldingRanges(source);
    expect(ranges.some((r) => r.kind === "region")).toBe(false);
  });

  it("folds a standalone begin..end fragment with no theory header", () => {
    // Without a `theory ... begin` header, the only begin..end pair is a real
    // block (e.g. a snippet or an included fragment), so it must fold — the
    // theory-body exclusion only applies to the begin that follows `theory`.
    const source = [
      "context fixes x begin", // 0
      "  definition d where \"d = x\"", // 1
      "  lemma l: True by simp", // 2
      "end" // 3
    ].join("\n");
    const ranges = computeIsabelleFoldingRanges(source);
    expect(hasRange(ranges, 0, 3, "region")).toBe(true);
  });

  it("ignores begin/end keywords inside comments and strings", () => {
    const source = [
      "theory T", // 0
      "imports Main", // 1
      "begin", // 2
      "(* context begin", // 3
      "   end *)", // 4
      "lemma x: \"begin = end\" by simp", // 5
      "end" // 6
    ].join("\n");
    const ranges = computeIsabelleFoldingRanges(source);
    // Only the multi-line comment folds; no spurious begin..end region.
    expect(kinds(ranges, "region")).toHaveLength(0);
  });
});

describe("computeIsabelleFoldingRanges — masking", () => {
  it("ignores keywords inside block comments", () => {
    const source = ["(* proof", "   section here", "   qed *)", "lemma foo by simp"].join("\n");
    const ranges = computeIsabelleFoldingRanges(source);
    expect(kinds(ranges, "region")).toHaveLength(0);
    // Only the comment itself folds.
    expect(hasRange(ranges, 0, 2, "comment")).toBe(true);
  });

  it("ignores keywords inside cartouches", () => {
    const source = ["text \\<open>", "  proof and qed and section live here", "\\<close>", "lemma foo by simp"].join(
      "\n"
    );
    const ranges = computeIsabelleFoldingRanges(source);
    expect(kinds(ranges, "region")).toHaveLength(0);
  });

  it("ignores keywords inside string literals", () => {
    const source = 'lemma foo: "proof qed section" by simp\n';
    expect(computeIsabelleFoldingRanges(source)).toEqual([]);
  });

  it("does not treat symbol-glued identifiers as commands", () => {
    // `\<^bold>proof` is a single decorated identifier, not a `proof` command.
    const source = ["lemma a", "have \\<^bold>proof_obligation", "by simp"].join("\n");
    expect(kinds(computeIsabelleFoldingRanges(source), "region")).toHaveLength(0);
  });
});

describe("computeIsabelleFoldingRanges — line model", () => {
  it("handles CRLF line endings with correct line numbers", () => {
    const source = ["(* c0", "   c1 *)", "lemma foo by simp"].join("\r\n");
    const ranges = computeIsabelleFoldingRanges(source);
    expect(hasRange(ranges, 0, 1, "comment")).toBe(true);
  });

  it("produces a coherent set on a realistic theory", () => {
    const source = [
      "theory Demo", // 0
      "  imports Main", // 1
      "begin", // 2
      "", // 3
      "section \\<open>Basics\\<close>", // 4
      "", // 5
      "lemma trivial:", // 6
      '  "x = x"', // 7
      "proof -", // 8
      "  show ?thesis by simp", // 9
      "qed", // 10
      "", // 11
      "end" // 12
    ].join("\n");
    const ranges = computeIsabelleFoldingRanges(source);
    expect(hasRange(ranges, 0, 1, "imports")).toBe(true);
    expect(hasRange(ranges, 4, 12, "region")).toBe(true); // section to end-of-body
    expect(hasRange(ranges, 8, 10, "region")).toBe(true); // proof..qed
  });
});
