import { describe, it, expect } from "vitest";
import { parseProofBody } from "../../src/sledgehammer/minimizeProofParser";

describe("parseProofBody", () => {
  it("parses `by (metis foo bar baz)`", () => {
    const r = parseProofBody("by (metis foo bar baz)");
    expect(r).not.toBeNull();
    expect(r!.method).toBe("metis");
    expect(r!.facts).toEqual(["foo", "bar", "baz"]);
    expect(r!.usingFacts).toEqual([]);
  });

  it("parses `by metis`", () => {
    const r = parseProofBody("by metis");
    expect(r).not.toBeNull();
    expect(r!.method).toBe("metis");
    expect(r!.facts).toEqual([]);
  });

  it("parses `apply (simp add: foo)` (we keep `add: foo` as facts for now)", () => {
    const r = parseProofBody("apply (simp foo bar)");
    expect(r).not.toBeNull();
    expect(r!.method).toBe("simp");
    expect(r!.facts).toEqual(["foo", "bar"]);
  });

  it("parses `using fact1 fact2 by (metis fact3)`", () => {
    const r = parseProofBody("using fact1 fact2 by (metis fact3)");
    expect(r).not.toBeNull();
    expect(r!.method).toBe("metis");
    expect(r!.facts).toEqual(["fact3"]);
    expect(r!.usingFacts).toEqual(["fact1", "fact2"]);
  });

  it("parses `using assms by metis`", () => {
    const r = parseProofBody("using assms by metis");
    expect(r).not.toBeNull();
    expect(r!.method).toBe("metis");
    expect(r!.usingFacts).toEqual(["assms"]);
    expect(r!.facts).toEqual([]);
  });

  it("trims leading whitespace", () => {
    const r = parseProofBody("    by (metis foo)");
    expect(r).not.toBeNull();
    expect(r!.method).toBe("metis");
    expect(r!.facts).toEqual(["foo"]);
  });

  it("returns null for empty / non-string input", () => {
    expect(parseProofBody("")).toBeNull();
    expect(parseProofBody("   ")).toBeNull();
    expect(parseProofBody(null as unknown as string)).toBeNull();
    expect(parseProofBody(undefined as unknown as string)).toBeNull();
  });

  it("returns null for non-proof lines", () => {
    expect(parseProofBody("lemma foo: \"True\"")).toBeNull();
    expect(parseProofBody("sorry")).toBeNull();
    expect(parseProofBody("theorem bar shows \"x = x\"")).toBeNull();
  });

  it("handles quoted fact names", () => {
    const r = parseProofBody('by (metis "foo bar" baz)');
    expect(r).not.toBeNull();
    expect(r!.facts).toEqual(["foo bar", "baz"]);
  });

  it("handles methods with underscores", () => {
    const r = parseProofBody("by (force_simp foo)");
    expect(r).not.toBeNull();
    expect(r!.method).toBe("force_simp");
  });
});
