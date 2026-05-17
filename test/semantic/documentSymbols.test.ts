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

  it("maps entity-bearing spans to symbol kinds compatible with vscode.SymbolKind", () => {
    // The IsabelleDocumentSymbolProvider maps these IsabelleSymbolKind strings to
    // vscode.SymbolKind values:
    //   "method"    -> vscode.SymbolKind.Method
    //   "function"  -> vscode.SymbolKind.Function
    //   "class"     -> vscode.SymbolKind.Class
    //   "module"    -> vscode.SymbolKind.Module
    //   "namespace" -> vscode.SymbolKind.Namespace
    const spans = extractCommandSpans(
      "file:///Entities.thy",
      [
        "theory Entities",
        "imports Main",
        "begin",
        "definition d where \"d = True\"",
        "fun f :: \"nat \\<Rightarrow> nat\" where \"f 0 = 0\"",
        "function g :: \"nat \\<Rightarrow> nat\" where \"g 0 = 0\"",
        "primrec p :: \"nat \\<Rightarrow> nat\" where \"p 0 = 0\"",
        "datatype t = Leaf | Node t t",
        "record r = field :: nat",
        "locale L = fixes m :: nat",
        "lemma the_lemma: True",
        "  by simp",
        "theorem the_theorem: True",
        "  by simp",
        "corollary the_corollary: True",
        "  by simp",
        "proposition the_proposition: True",
        "  by simp",
        "schematic_goal sg: \"?P\"",
        "  by auto",
        "end"
      ].join("\n"),
      1
    );

    const named = new Map<string, { detail: string; kind: string }>();
    for (const symbol of extractIsabelleDocumentSymbols(spans)) {
      named.set(symbol.name, { detail: symbol.detail, kind: symbol.kind });
    }

    expect(named.get("d")).toEqual({ detail: "definition", kind: "function" });
    expect(named.get("f")).toEqual({ detail: "fun", kind: "function" });
    expect(named.get("g")).toEqual({ detail: "function", kind: "function" });
    expect(named.get("p")).toEqual({ detail: "primrec", kind: "function" });
    expect(named.get("t")).toEqual({ detail: "datatype", kind: "class" });
    expect(named.get("r")).toEqual({ detail: "record", kind: "class" });
    expect(named.get("L")).toEqual({ detail: "locale", kind: "class" });
    expect(named.get("the_lemma")).toEqual({ detail: "lemma", kind: "method" });
    expect(named.get("the_theorem")).toEqual({ detail: "theorem", kind: "method" });
    expect(named.get("the_corollary")).toEqual({ detail: "corollary", kind: "method" });
    expect(named.get("the_proposition")).toEqual({ detail: "proposition", kind: "method" });
    expect(named.get("sg")).toEqual({ detail: "schematic_goal", kind: "method" });
    expect(named.get("theory")).toEqual({ detail: "theory", kind: "module" });
  });
});
