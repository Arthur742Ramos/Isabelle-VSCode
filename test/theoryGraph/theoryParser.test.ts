import { describe, expect, it } from "vitest";
import { parseTheoryHeader } from "../../src/theoryGraph/theoryParser";

describe("parseTheoryHeader", () => {
  it("extracts imports from the theory header and stops before keywords", () => {
    const header = parseTheoryHeader(
      `\uFEFF(* leading (* nested *) comment *)
      theory Graph
        imports Main "../Common/Helper" HOL-Library.Multiset
        keywords "graph" :: thy_decl
      begin
        imports Body_Token
      end`
    );

    expect(header).toEqual({
      name: "Graph",
      imports: ["Main", "../Common/Helper", "HOL-Library.Multiset"]
    });
  });

  it("stops import collection before abbrevs and begin", () => {
    expect(
      parseTheoryHeader(`
        theory Abbrevs imports Base abbrevs x = y begin end
      `)
    ).toEqual({
      name: "Abbrevs",
      imports: ["Base"]
    });

    expect(parseTheoryHeader("theory Empty begin imports Not_Header end")).toEqual({
      name: "Empty",
      imports: []
    });
  });
});
