import { describe, expect, it } from "vitest";
import {
  allMethods,
  buildMethodHoverMarkdown,
  findMethodCompletionContext,
  getMethodInfo,
  isMethodArgumentLabel,
  isMethodPosition,
  isProofMethod,
  ISABELLE_METHODS
} from "../../src/semantic/proofMethods";

describe("Isabelle proof-method metadata", () => {
  const coreMethods: Array<[string, string]> = [
    ["simp", "simplification"],
    ["simp_all", "simplification"],
    ["auto", "automation"],
    ["force", "automation"],
    ["fastforce", "automation"],
    ["clarsimp", "automation"],
    ["arith", "automation"],
    ["blast", "classical"],
    ["fast", "classical"],
    ["clarify", "classical"],
    ["safe", "classical"],
    ["rule", "rule"],
    ["erule", "rule"],
    ["drule", "rule"],
    ["frule", "rule"],
    ["intro", "rule"],
    ["subst", "rule"],
    ["induct", "induction"],
    ["induction", "induction"],
    ["cases", "induction"],
    ["coinduct", "induction"],
    ["metis", "terminal"],
    ["meson", "terminal"],
    ["smt", "terminal"],
    ["assumption", "terminal"],
    ["standard", "structural"]
  ];

  it.each(coreMethods)("knows %s as a %s method", (name, category) => {
    expect(isProofMethod(name)).toBe(true);
    expect(getMethodInfo(name)?.category).toBe(category);
  });

  it("returns undefined for non-methods", () => {
    expect(getMethodInfo("lemma")).toBeUndefined();
    expect(getMethodInfo("definitely_not_a_method")).toBeUndefined();
    expect(isProofMethod("theorem")).toBe(false);
  });

  it("gives every method a non-empty, trimmed description and unique name", () => {
    const names = new Set<string>();
    for (const info of ISABELLE_METHODS.values()) {
      expect(info.description.length).toBeGreaterThan(0);
      expect(info.description.trim()).toBe(info.description);
      expect(names.has(info.name)).toBe(false);
      names.add(info.name);
    }
  });

  it("renders a method hover with role label and description", () => {
    const markdown = buildMethodHoverMarkdown(getMethodInfo("induct")!);
    expect(markdown).toContain("`induct`");
    expect(markdown).toContain("induction");
    expect(markdown).toContain("structural / rule induction");
  });
});

describe("isMethodPosition", () => {
  // Helper: position of the first occurrence of `word` in `line`.
  const at = (line: string, word: string): number => line.indexOf(word);

  it("is true for a method following apply / by / proof", () => {
    expect(isMethodPosition("  apply simp", at("  apply simp", "simp"))).toBe(true);
    expect(isMethodPosition("  by auto", at("  by auto", "auto"))).toBe(true);
    expect(isMethodPosition("proof induct", at("proof induct", "induct"))).toBe(true);
    // `simp` follows the `by`, which is the introducer that matters even though
    // the line also starts with `unfolding`.
    expect(
      isMethodPosition("  unfolding foo_def by simp", at("  unfolding foo_def by simp", "simp"))
    ).toBe(true);
    expect(
      isMethodPosition("  apply (induct xs)", at("  apply (induct xs)", "induct"))
    ).toBe(true);
  });

  it("is false when no introducer precedes the word on the line", () => {
    // `rule` mentioned in a term / comment-free code position with no introducer.
    expect(isMethodPosition("  have rule: True", at("  have rule: True", "rule"))).toBe(false);
    // `cases` as a bare word at the start of a line.
    expect(isMethodPosition("cases x", at("cases x", "cases"))).toBe(false);
    // The introducer itself is not in method position.
    expect(isMethodPosition("  by simp", at("  by simp", "by"))).toBe(false);
  });

  it("does not treat fact-list keywords (unfolding / using / supply) as introducers", () => {
    // `unfolding foo` and `supply bar` take *fact* names, not methods, so the
    // word after them is not in method position.
    expect(isMethodPosition("  unfolding simp", at("  unfolding simp", "simp"))).toBe(false);
    expect(isMethodPosition("  supply simp", at("  supply simp", "simp"))).toBe(false);
    expect(isMethodPosition("  using rule", at("  using rule", "rule"))).toBe(false);
  });

  it("requires the introducer to come before the word, not after", () => {
    const line = "  simp_all by blast";
    // `simp_all` appears before `by`, so it is NOT yet in method position here.
    expect(isMethodPosition(line, at(line, "simp_all"))).toBe(false);
    // `blast` follows `by`, so it is.
    expect(isMethodPosition(line, at(line, "blast"))).toBe(true);
  });
});

describe("isMethodArgumentLabel", () => {
  const endOf = (line: string, word: string): number => line.indexOf(word) + word.length;

  it("is true when the word is immediately followed by a colon", () => {
    const line = "  apply (induct rule: xs.induct)";
    expect(isMethodArgumentLabel(line, endOf(line, "rule"))).toBe(true);
  });

  it("is true with whitespace before the colon", () => {
    const line = "  apply (simp add : defs)";
    expect(isMethodArgumentLabel(line, endOf(line, "add"))).toBe(true);
  });

  it("is false for a method not used as a label", () => {
    expect(isMethodArgumentLabel("  by rule", "  by rule".length)).toBe(false);
    const line = "  apply (rule conjI)";
    expect(isMethodArgumentLabel(line, endOf(line, "rule"))).toBe(false);
  });
});

describe("allMethods", () => {
  it("returns the whole table with no duplicate names", () => {
    const methods = allMethods();
    expect(methods.length).toBe(ISABELLE_METHODS.size);
    const names = methods.map((method) => method.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("simp");
    expect(names).toContain("induct");
    expect(names).toContain("metis");
  });
});

describe("findMethodCompletionContext", () => {
  it("offers completion with a partial query immediately after an introducer", () => {
    const line = "  apply sim";
    expect(findMethodCompletionContext(line, line.length)).toEqual({
      replaceStart: line.indexOf("sim"),
      query: "sim"
    });
  });

  it("offers completion with an empty query right after `by `", () => {
    const line = "  by ";
    expect(findMethodCompletionContext(line, line.length)).toEqual({
      replaceStart: line.length,
      query: ""
    });
  });

  it("offers completion immediately after `apply (`", () => {
    const line = "  apply (ind";
    expect(findMethodCompletionContext(line, line.length)).toEqual({
      replaceStart: line.indexOf("ind"),
      query: "ind"
    });
  });

  it("offers completion after a combinator delimiter (| , ;)", () => {
    const altLine = "  apply (simp | au";
    expect(findMethodCompletionContext(altLine, altLine.length)).toEqual({
      replaceStart: altLine.indexOf("au"),
      query: "au"
    });
    const seqLine = "  apply (rule, sim";
    expect(findMethodCompletionContext(seqLine, seqLine.length)).toEqual({
      replaceStart: seqLine.indexOf("sim"),
      query: "sim"
    });
  });

  it("does NOT offer completion in argument position (after a method's first token)", () => {
    // `apply (induct xs` — `xs` is the induction variable, not a method.
    const inductArg = "  apply (induct x";
    expect(findMethodCompletionContext(inductArg, inductArg.length)).toBeUndefined();
    // `apply (simp add: foo` — after the `add:` label a *fact* is expected.
    const factArg = "  apply (simp add: fo";
    expect(findMethodCompletionContext(factArg, factArg.length)).toBeUndefined();
  });

  it("does NOT offer completion after a closed group or inside focus brackets", () => {
    // `apply (simp) ‹here›` — the group is closed; no method name is expected.
    const closed = "  apply (simp) au";
    expect(findMethodCompletionContext(closed, closed.length)).toBeUndefined();
    // `apply (simp[1]` style goal-restriction focus expects a number, not a method.
    const focus = "  apply (simp[au";
    expect(findMethodCompletionContext(focus, focus.length)).toBeUndefined();
  });

  it("does not offer completion outside method position", () => {
    const haveLine = "  have foo: \"x = y\"";
    expect(findMethodCompletionContext(haveLine, haveLine.length)).toBeUndefined();
    expect(findMethodCompletionContext("lemma bar", 9)).toBeUndefined();
    // `unfolding`/`using`/`supply` introduce facts, not methods.
    const unfolding = "  unfolding fo";
    expect(findMethodCompletionContext(unfolding, unfolding.length)).toBeUndefined();
  });

  it("does not offer completion inside a quoted inner-syntax string", () => {
    const line = "  by simp \"foo ba";
    expect(findMethodCompletionContext(line, line.length)).toBeUndefined();
  });

  it("resumes offering completion after a quoted string closes and a new `by`", () => {
    const line = "  using \"x\" by au";
    expect(findMethodCompletionContext(line, line.length)).toEqual({
      replaceStart: line.indexOf("au"),
      query: "au"
    });
  });
});
