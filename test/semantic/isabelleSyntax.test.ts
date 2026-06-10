import { describe, expect, it } from "vitest";
import {
  getCommandInfo,
  getSymbolInfo,
  isCommandKeyword,
  isDeclarationCommand,
  isDiagnosticCommand,
  isMlCommand,
  isProofStatementCommand,
  isProofStepCommand,
  isProofTerminalCommand,
  isTheoryStructureCommand,
  ISABELLE_COMMANDS
} from "../../src/semantic/isabelleSyntax";

describe("isabelle syntax metadata", () => {
  it("describes known commands", () => {
    expect(getCommandInfo("lemma")).toMatchObject({
      keyword: "lemma",
      declaresName: true
    });
  });

  it("describes known Isabelle symbols", () => {
    expect(getSymbolInfo("\\<forall>")).toMatchObject({
      glyph: "∀",
      description: "Universal quantifier"
    });
  });
});

describe("expanded outer-syntax command vocabulary", () => {
  // Commands an AFP / HOL theory routinely uses that the foundation must
  // recognise for highlighting, hover, command-spans, and the outline.
  const coreVocabulary: Array<[string, string]> = [
    ["typedef", "declaration"],
    ["typedecl", "declaration"],
    ["type_synonym", "declaration"],
    ["codatatype", "declaration"],
    ["primcorec", "declaration"],
    ["inductive_set", "declaration"],
    ["coinductive", "declaration"],
    ["lift_definition", "declaration"],
    ["consts", "declaration"],
    ["axiomatization", "declaration"],
    ["lemmas", "declaration"],
    ["named_theorems", "declaration"],
    ["declare", "declaration"],
    ["notation", "declaration"],
    ["no_notation", "declaration"],
    ["syntax", "declaration"],
    ["translations", "declaration"],
    ["hide_const", "declaration"],
    ["default_sort", "declaration"],
    ["bundle", "declaration"],
    ["unbundle", "declaration"],
    ["method_setup", "declaration"],
    ["class", "context"],
    ["instantiation", "context"],
    ["experiment", "context"],
    ["instance", "statement"],
    ["subclass", "statement"],
    ["interpretation", "statement"],
    ["sublocale", "statement"],
    ["global_interpretation", "statement"],
    ["termination", "statement"],
    ["chapter", "theory"],
    ["paragraph", "theory"],
    ["text_raw", "theory"],
    ["interpret", "proof"],
    ["subgoal", "proof"],
    ["supply", "proof"],
    ["define", "proof"],
    ["consider", "proof"],
    ["value", "diagnostic"],
    ["term", "diagnostic"],
    ["thm", "diagnostic"],
    ["find_theorems", "diagnostic"],
    ["find_consts", "diagnostic"],
    ["sledgehammer", "diagnostic"],
    ["nitpick", "diagnostic"],
    ["export_code", "diagnostic"],
    ["ML", "ml"],
    ["ML_file", "ml"]
  ];

  it.each(coreVocabulary)("recognises %s with category %s", (keyword, category) => {
    expect(isCommandKeyword(keyword)).toBe(true);
    expect(getCommandInfo(keyword)?.category).toBe(category);
  });

  it("gives every command a non-empty human-readable description", () => {
    for (const info of ISABELLE_COMMANDS.values()) {
      expect(info.description.length).toBeGreaterThan(0);
      expect(info.description.trim()).toBe(info.description);
    }
  });

  it("keeps every keyword unique in the table", () => {
    const keywords = [...ISABELLE_COMMANDS.values()].map((info) => info.keyword);
    expect(new Set(keywords).size).toBe(keywords.length);
  });

  it("only marks name-declaring commands with declaresName", () => {
    // Diagnostic and ML commands never bind a navigable name.
    expect(getCommandInfo("value")?.declaresName).toBeUndefined();
    expect(getCommandInfo("ML")?.declaresName).toBeUndefined();
    expect(getCommandInfo("declare")?.declaresName).toBeUndefined();
    // Specifications and goals do.
    expect(getCommandInfo("typedef")?.declaresName).toBe(true);
    expect(getCommandInfo("lift_definition")?.declaresName).toBe(true);
  });

  it("classifies the new categories via the predicate helpers", () => {
    expect(isDiagnosticCommand("value")).toBe(true);
    expect(isDiagnosticCommand("lemma")).toBe(false);
    expect(isMlCommand("ML")).toBe(true);
    expect(isMlCommand("value")).toBe(false);
    expect(isDeclarationCommand("typedef")).toBe(true);
    expect(isTheoryStructureCommand("chapter")).toBe(true);
    expect(isProofStatementCommand("interpretation")).toBe(true);
    expect(isProofStepCommand("subgoal")).toBe(true);
    expect(isProofTerminalCommand("done")).toBe(true);
  });

  it("does not regress the original core commands", () => {
    for (const keyword of [
      "theory",
      "imports",
      "begin",
      "end",
      "lemma",
      "definition",
      "fun",
      "proof",
      "qed",
      "by",
      "sorry",
      "oops"
    ]) {
      expect(isCommandKeyword(keyword)).toBe(true);
    }
  });
});
