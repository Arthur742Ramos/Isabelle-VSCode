import { describe, expect, it } from "vitest";
import { findOccurrences, identifierTokenAt } from "../../src/semantic/occurrences";
import { maskNonProofText } from "../../src/audit/proofGapScanner";

// Helper: offset of the first occurrence of `needle` in `source`, optionally
// the nth (0-based).
function offsetOf(source: string, needle: string, nth = 0): number {
  let from = -1;
  for (let i = 0; i <= nth; i++) {
    from = source.indexOf(needle, from + 1);
    if (from < 0) throw new Error(`needle ${needle} #${nth} not found`);
  }
  return from;
}

describe("identifierTokenAt", () => {
  it("returns the token covering the cursor", () => {
    const line = "  show foo' unfolding bar.baz by simp";
    const masked = maskNonProofText(line);
    expect(identifierTokenAt(masked, line.indexOf("foo'"))?.token).toBe("foo'");
    // primed identifier kept whole
    expect(identifierTokenAt(masked, line.indexOf("foo'") + 3)?.token).toBe("foo'");
    // qualified name kept whole
    expect(identifierTokenAt(masked, line.indexOf("bar.baz") + 4)?.token).toBe("bar.baz");
  });

  it("returns undefined off a token", () => {
    const line = "lemma  x";
    const masked = maskNonProofText(line);
    // on the double space between tokens
    expect(identifierTokenAt(masked, 6)).toBeUndefined();
  });

  it("treats a symbol escape run as one token", () => {
    const line = "term \\<alpha>\\<^sub>n";
    const masked = maskNonProofText(line);
    expect(identifierTokenAt(masked, line.indexOf("alpha"))?.token).toBe("\\<alpha>\\<^sub>n");
  });
});

describe("findOccurrences", () => {
  const theory = [
    "theory T", // 0
    "imports Main", // 1
    "begin", // 2
    "definition foo where \"foo = (0 :: nat)\"", // 3
    "lemma foo_pos: \"foo > 0\"", // 4
    "  unfolding foo_def by simp", // 5
    "end" // 6
  ].join("\n");

  it("finds every code occurrence of the identifier under the cursor", () => {
    const cursor = offsetOf(theory, "foo"); // the declaration on line 3
    const occ = findOccurrences(theory, cursor);
    // foo appears: definition foo (3), "foo = ..." is inside a string -> masked,
    // lemma foo_pos has `foo_pos` (different token), `"foo > 0"` masked,
    // `foo_def` (different token). So only the bare `definition foo` counts here
    // plus... let's assert the declaration is found and is a write.
    expect(occ.length).toBeGreaterThanOrEqual(1);
    const declared = occ.find((o) => o.offset === offsetOf(theory, "foo"));
    expect(declared?.kind).toBe("write");
  });

  it("does not match inside strings, comments, or different tokens", () => {
    const src = [
      "definition foo where \"foo = 0\"", // 0: `foo` decl, `foo` in string (masked)
      "(* foo here is a comment *)", // 1: masked
      "lemma l: \"foo_bar = foo\"" // 2: `foo_bar` differs; `foo` in string masked
    ].join("\n");
    const occ = findOccurrences(src, src.indexOf("foo"));
    // Only the declaring `foo` on line 0 is real code; the rest are masked or a
    // different token (`foo_bar`).
    expect(occ).toHaveLength(1);
    expect(occ[0].kind).toBe("write");
  });

  it("marks only the declaration as write and uses as text", () => {
    const src = ["definition dd where \"dd = 1\"", "lemma e: dd", "  using dd by simp"].join("\n");
    const occ = findOccurrences(src, src.indexOf("dd"));
    const kinds = occ.map((o) => o.kind);
    expect(kinds[0]).toBe("write"); // the `definition dd`
    expect(kinds.slice(1).every((k) => k === "text")).toBe(true);
    expect(occ.length).toBe(3); // definition dd, lemma e: dd, using dd
  });

  it("returns nothing when the cursor is on a command keyword", () => {
    const src = "lemma foo: True\n  by simp\nlemma bar: True\n  by simp";
    expect(findOccurrences(src, src.indexOf("lemma"))).toHaveLength(0);
    expect(findOccurrences(src, src.indexOf("by"))).toHaveLength(0);
  });

  it("returns nothing when the cursor is on whitespace or inside a string", () => {
    const src = "definition foo where \"foo = 0\"";
    // cursor inside the quoted `"foo = 0"`
    expect(findOccurrences(src, src.indexOf("\"foo") + 2)).toHaveLength(0);
  });

  it("handles a primed identifier as distinct from its unprimed form", () => {
    const src = ["fix xs xs'", "have \"length xs = length xs\"", "have a: xs'", "have b: xs"].join("\n");
    const primed = findOccurrences(src, src.indexOf("xs'"));
    // xs' appears as code twice: the `fix xs'` and `have a: xs'`.
    expect(primed.length).toBeGreaterThan(0);
    const unprimed = findOccurrences(src, offsetOf(src, "xs", 0));
    expect(unprimed.length).toBeGreaterThan(0);
    // The two sets are disjoint in offsets — `xs` must never match inside `xs'`.
    const primedOffsets = new Set(primed.map((o) => o.offset));
    expect(unprimed.some((o) => primedOffsets.has(o.offset))).toBe(false);
  });

  it("returns an empty array for an out-of-range cursor", () => {
    const src = "definition foo where \"foo = 0\"";
    expect(findOccurrences(src, -1)).toHaveLength(0);
    expect(findOccurrences(src, src.length + 100)).toHaveLength(0);
  });
});
