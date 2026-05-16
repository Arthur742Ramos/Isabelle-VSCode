import { describe, expect, it } from "vitest";
import { getCommandInfo, getSymbolInfo } from "../../src/semantic/isabelleSyntax";

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
