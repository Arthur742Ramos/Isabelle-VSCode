import { describe, expect, it } from "vitest";
import { extractCommandSpans } from "../../src/document/commandSpans";
import { extractIsabelleDocumentSymbols } from "../../src/semantic/documentSymbols";
import { workspaceSymbolKind } from "../../src/semantic/workspaceSymbols";
import { IsabelleEntityKind } from "../../src/semantic/theoryEntities";

/**
 * Cross-check that the in-file outline (DocumentSymbolProvider) and the
 * workspace symbol search (WorkspaceSymbolProvider) agree on the symbol kind
 * for the same construct. The two map kinds independently — this guards the
 * drift Copilot flagged on #143, so a change to one must be matched in the
 * other or this test fails.
 *
 * `documentSymbols` maps to its own IsabelleSymbolKind string set; the workspace
 * provider's `workspaceSymbolKind` uses the same vocabulary. For each construct
 * we extract the document symbol's `kind` and compare it to
 * `workspaceSymbolKind(entityKind)`.
 */

// One representative declaration per entity kind, with the name we can look up.
const SAMPLES: Array<{ kind: IsabelleEntityKind; name: string; line: string }> = [
  { kind: "definition", name: "d0", line: "definition d0 where \"d0 = (0::nat)\"" },
  { kind: "abbreviation", name: "ab0", line: "abbreviation ab0 where \"ab0 \\<equiv> 0\"" },
  { kind: "fun", name: "fn0", line: "fun fn0 :: \"nat \\<Rightarrow> nat\" where \"fn0 0 = 0\"" },
  { kind: "function", name: "g0", line: "function g0 :: \"nat \\<Rightarrow> nat\" where \"g0 0 = 0\"" },
  { kind: "primrec", name: "pr0", line: "primrec pr0 :: \"nat \\<Rightarrow> nat\" where \"pr0 0 = 0\"" },
  { kind: "primcorec", name: "pc0", line: "primcorec pc0 :: \"nat\" where \"pc0 = 0\"" },
  { kind: "inductive", name: "ind0", line: "inductive ind0 where \"ind0 0\"" },
  { kind: "inductive_set", name: "is0", line: "inductive_set is0 where \"0 \\<in> is0\"" },
  { kind: "coinductive", name: "ci0", line: "coinductive ci0 where \"ci0 0\"" },
  { kind: "datatype", name: "dt0", line: "datatype dt0 = A | B" },
  { kind: "codatatype", name: "cdt0", line: "codatatype cdt0 = C nat cdt0" },
  { kind: "record", name: "rec0", line: "record rec0 = field0 :: nat" },
  { kind: "typedef", name: "td0", line: "typedef td0 = \"UNIV :: nat set\" by auto" },
  { kind: "typedecl", name: "tdc0", line: "typedecl tdc0" },
  { kind: "type_synonym", name: "ts0", line: "type_synonym ts0 = nat" },
  { kind: "lift_definition", name: "ld0", line: "lift_definition ld0 :: td0 is \"0::nat\" by auto" },
  { kind: "locale", name: "loc0", line: "locale loc0 = fixes p :: nat" },
  { kind: "class", name: "cls0", line: "class cls0 = fixes op0 :: nat" },
  { kind: "theorem", name: "th0", line: "theorem th0: True by simp" },
  { kind: "lemma", name: "lm0", line: "lemma lm0: True by simp" },
  { kind: "corollary", name: "co0", line: "corollary co0: True by simp" },
  { kind: "proposition", name: "pp0", line: "proposition pp0: True by simp" },
  { kind: "schematic_goal", name: "sg0", line: "schematic_goal sg0: \"?P\" by auto" }
];

function documentKindOf(line: string, name: string): string | undefined {
  const spans = extractCommandSpans("file:///Parity.thy", `theory Parity\nimports Main\nbegin\n${line}\nend`, 0);
  const symbols = extractIsabelleDocumentSymbols(spans);
  return symbols.find((s) => s.name === name)?.kind;
}

describe("document vs workspace symbol-kind parity", () => {
  it.each(SAMPLES)("agrees on the kind for $kind", ({ kind, name, line }) => {
    const docKind = documentKindOf(line, name);
    expect(docKind, `document outline did not surface ${kind} ${name}`).toBeDefined();
    expect(workspaceSymbolKind(kind)).toBe(docKind);
  });
});
