import { describe, expect, it } from "vitest";
import { extractCommandSpans } from "../../src/document/commandSpans";
import { extractIsabelleDocumentSymbols } from "../../src/semantic/documentSymbols";

describe("extractIsabelleDocumentSymbols", () => {
  it("extracts named declarations and nests proof steps under their statement", () => {
    const spans = extractCommandSpans(
      "file:///Symbols.thy",
      [
        "theory Symbols",
        "imports Main",
        "begin",
        "",
        "definition answer :: nat where \"answer = 42\"",
        "",
        "lemma answer_positive: \"answer > 0\"",
        "proof -",
        "  have local_fact: \"answer = 42\"",
        "    by simp",
        "  show ?thesis",
        "    sorry",
        "qed",
        "",
        "end"
      ].join("\n"),
      1
    );

    const symbols = extractIsabelleDocumentSymbols(spans);

    expect(symbols.map((symbol) => [symbol.name, symbol.detail, symbol.kind])).toEqual([
      ["theory", "theory", "module"],
      ["begin", "begin", "namespace"],
      ["answer", "definition", "function"],
      ["answer_positive", "lemma", "method"],
      ["end", "end", "namespace"]
    ]);
    expect(symbols[3].children.map((symbol) => [symbol.name, symbol.detail])).toEqual([
      ["proof", "proof"],
      ["local_fact", "have"],
      ["by", "by"],
      ["show", "show"],
      ["sorry", "sorry"],
      ["qed", "qed"]
    ]);
    expect(symbols[3].range.end).toEqual({ line: 14, character: 0 });
  });

  it("skips anonymous statements while preserving named declarations", () => {
    const spans = extractCommandSpans(
      "file:///Anonymous.thy",
      [
        "theory Anonymous",
        "imports Main",
        "begin",
        "lemma \"True\"",
        "  by simp",
        "lemma named: True",
        "  by simp",
        "end"
      ].join("\n"),
      1
    );

    expect(extractIsabelleDocumentSymbols(spans).map((symbol) => symbol.name)).toEqual([
      "theory",
      "begin",
      "named",
      "end"
    ]);
  });
});
