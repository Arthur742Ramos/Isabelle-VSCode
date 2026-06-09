import { describe, expect, it } from "vitest";
import {
  buildProofGapDiagnostics,
  findProofGapDiagnostics,
  maskNonProofText,
  PROOF_GAP_DIAGNOSTIC_COLLECTION_NAME,
  PROOF_GAP_DIAGNOSTIC_SOURCE,
  scanProofGaps
} from "../../src/audit/proofGapScanner";

describe("maskNonProofText", () => {
  it("preserves length and newlines", () => {
    const source = 'lemma foo\n  by (* x *) auto\n';
    const masked = maskNonProofText(source);
    expect(masked.length).toBe(source.length);
    expect(masked.split("\n").length).toBe(source.split("\n").length);
  });

  it("blanks line comments content but keeps code", () => {
    const masked = maskNonProofText("a (* sorry *) b");
    expect(masked).toBe("a" + " ".repeat(13) + "b");
    expect(masked).not.toContain("sorry");
  });

  it("handles nested comments", () => {
    const masked = maskNonProofText("x (* a (* sorry *) b *) y");
    expect(masked).not.toContain("sorry");
    expect(masked.startsWith("x ")).toBe(true);
    expect(masked.endsWith(" y")).toBe(true);
  });

  it("blanks ASCII cartouches including the delimiters", () => {
    const source = "text \\<open>sorry inside\\<close> oops";
    const masked = maskNonProofText(source);
    expect(masked).not.toContain("sorry");
    expect(masked).toContain("oops");
    expect(masked.length).toBe(source.length);
  });

  it("blanks Unicode cartouches", () => {
    const source = "text \u2039contains sorry\u203a after";
    const masked = maskNonProofText(source);
    expect(masked).not.toContain("sorry");
    expect(masked).toContain("after");
    expect(masked.length).toBe(source.length);
  });

  it("handles nested cartouches", () => {
    const source = "a \u2039outer \\<open>sorry\\<close> still\u203a b";
    const masked = maskNonProofText(source);
    expect(masked).not.toContain("sorry");
    expect(masked).not.toContain("still");
    expect(masked.startsWith("a ")).toBe(true);
    expect(masked.endsWith(" b")).toBe(true);
  });

  it("blanks string literals and honours escaped quotes", () => {
    const source = 'foo "a sorry \\" still" bar';
    const masked = maskNonProofText(source);
    expect(masked).not.toContain("sorry");
    expect(masked).not.toContain("still");
    expect(masked.startsWith("foo ")).toBe(true);
    expect(masked.endsWith(" bar")).toBe(true);
    expect(masked.length).toBe(source.length);
  });

  it("does not treat a trailing backslash in a string as an escape that swallows the close quote", () => {
    // A backslash as the final character of source must consume only itself.
    const masked = maskNonProofText('"abc\\');
    expect(masked.length).toBe(5);
  });
});

describe("scanProofGaps", () => {
  it("detects a bare sorry with offset and position", () => {
    const findings = scanProofGaps("lemma foo: True\n  by sorry\n");
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: "sorry", length: 5, line: 1, character: 5 });
    expect(findings[0].offset).toBe("lemma foo: True\n  by ".length);
  });

  it("detects oops", () => {
    const findings = scanProofGaps("lemma foo: True\noops\n");
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: "oops", length: 4, line: 1, character: 0 });
  });

  it("detects multiple gaps in document order", () => {
    const findings = scanProofGaps("by sorry\n\nlemma g oops\n");
    expect(findings.map((finding) => finding.kind)).toEqual(["sorry", "oops"]);
  });

  it("does not match tokens that merely contain sorry/oops", () => {
    const findings = scanProofGaps("sorryx mysorry sorry' oopsy noops");
    expect(findings).toHaveLength(0);
  });

  it("does not match qualified names ending in .sorry", () => {
    const findings = scanProofGaps("term Foo.sorry\n");
    expect(findings).toHaveLength(0);
  });

  it("does not match identifiers built from symbol escapes ending in sorry/oops", () => {
    // On-disk Isabelle spelling: subscripted / Greek identifiers glue together.
    expect(scanProofGaps("term x\\<^sub>sorry\n")).toHaveLength(0);
    expect(scanProofGaps("term \\<alpha>oops\n")).toHaveLength(0);
  });

  it("does not match sorry embedded in a rendered Unicode identifier", () => {
    expect(scanProofGaps("term \u03b1sorry\n")).toHaveLength(0);
  });

  it("still flags a standalone sorry that merely follows a symbol-escaped identifier", () => {
    const findings = scanProofGaps("lemma \\<alpha>: True by sorry\n");
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe("sorry");
  });

  it("ignores sorry inside comments", () => {
    expect(scanProofGaps("by auto (* sorry here *)\n")).toHaveLength(0);
  });

  it("ignores sorry inside cartouches and strings", () => {
    expect(scanProofGaps('text \\<open>sorry\\<close>\n')).toHaveLength(0);
    expect(scanProofGaps('lemma x: "P sorry Q"\n')).toHaveLength(0);
    expect(scanProofGaps("text \u2039sorry\u203a\n")).toHaveLength(0);
  });

  it("computes line/character correctly across CRLF newlines", () => {
    const findings = scanProofGaps("lemma a\r\n  oops\r\n");
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: "oops", line: 1, character: 2 });
  });
});

describe("buildProofGapDiagnostics", () => {
  it("maps sorry to a warning and oops to information", () => {
    const diagnostics = buildProofGapDiagnostics(scanProofGaps("by sorry\noops\n"));
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0].severity).toBe("warning");
    expect(diagnostics[0].message).toContain("unsound");
    expect(diagnostics[1].severity).toBe("information");
    expect(diagnostics[1].message).toContain("abandons");
  });

  it("carries through positional data", () => {
    const diagnostics = findProofGapDiagnostics("  by sorry");
    expect(diagnostics[0]).toMatchObject({ kind: "sorry", line: 0, character: 5, length: 5 });
  });
});

describe("exported constants", () => {
  it("uses distinct diagnostic owner identities", () => {
    expect(PROOF_GAP_DIAGNOSTIC_SOURCE).toBe("isabelle proof-gap");
    expect(PROOF_GAP_DIAGNOSTIC_COLLECTION_NAME).toBe("isabelle-proof-gaps");
  });
});
