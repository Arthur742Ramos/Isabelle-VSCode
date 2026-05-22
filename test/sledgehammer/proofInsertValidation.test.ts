import { describe, expect, it } from "vitest";
import {
  computeInsertedEnd,
  countInsertedLines,
  diagnosticKey,
  normalizeMessage,
  shiftBaselineForInsertion,
  validateInsertedProof,
  ValidationDiagnostic
} from "../../src/sledgehammer/proofInsertValidation";

function diag(
  severity: ValidationDiagnostic["severity"],
  startLine: number,
  message: string,
  source = "isabelle"
): ValidationDiagnostic {
  return {
    severity,
    message,
    source,
    range: {
      start: { line: startLine, character: 0 },
      end: { line: startLine, character: 10 }
    }
  };
}

describe("normalizeMessage", () => {
  it("collapses whitespace and trims", () => {
    expect(normalizeMessage("  hello   world\nfoo\tbar  ")).toBe("hello world foo bar");
  });
});

describe("diagnosticKey", () => {
  it("includes severity, source, position, and normalized message", () => {
    const key = diagnosticKey(diag("error", 4, "Failed to apply  initial proof method", "isabelle"));
    expect(key).toContain("error");
    expect(key).toContain("isabelle");
    expect(key).toContain("4");
    expect(key).toContain("Failed to apply initial proof method");
  });

  it("treats absent source as an empty string", () => {
    const a: ValidationDiagnostic = {
      severity: "error",
      message: "boom",
      range: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } }
    };
    const b: ValidationDiagnostic = { ...a, source: "" };
    expect(diagnosticKey(a)).toBe(diagnosticKey(b));
  });
});

describe("shiftBaselineForInsertion", () => {
  it("returns the baseline unchanged when insertedLineCount is zero", () => {
    const baseline = [diag("error", 3, "x")];
    expect(shiftBaselineForInsertion(baseline, 2, 0)).toEqual(baseline);
  });

  it("leaves diagnostics strictly before the insertion line untouched", () => {
    const baseline = [diag("error", 1, "earlier")];
    const result = shiftBaselineForInsertion(baseline, 5, 3);
    expect(result[0]?.range.start.line).toBe(1);
    expect(result[0]?.range.end.line).toBe(1);
  });

  it("shifts diagnostics at or after the insertion line by insertedLineCount", () => {
    const baseline = [diag("error", 5, "later"), diag("warning", 8, "after")];
    const result = shiftBaselineForInsertion(baseline, 5, 2);
    expect(result[0]?.range.start.line).toBe(7);
    expect(result[0]?.range.end.line).toBe(7);
    expect(result[1]?.range.start.line).toBe(10);
    expect(result[1]?.range.end.line).toBe(10);
  });
});

describe("validateInsertedProof", () => {
  it("returns no-regression when no diagnostics changed", () => {
    const baseline = [diag("error", 1, "old")];
    const post = [diag("error", 1, "old")];
    const result = validateInsertedProof({
      baseline,
      post,
      insertionLine: 5,
      insertedLineCount: 1
    });
    expect(result.kind).toBe("no-regression");
  });

  it("flags a new error at the insertion line as a regression", () => {
    const baseline: ValidationDiagnostic[] = [];
    const post = [diag("error", 5, "Failed to apply initial proof method")];
    const result = validateInsertedProof({
      baseline,
      post,
      insertionLine: 5,
      insertedLineCount: 1
    });
    expect(result.kind).toBe("regression");
    if (result.kind === "regression") {
      expect(result.newErrors).toHaveLength(1);
      expect(result.newErrors[0]?.message).toContain("Failed to apply");
    }
  });

  it("flags a new error after the insertion line as a regression", () => {
    const baseline: ValidationDiagnostic[] = [];
    const post = [diag("error", 12, "Outer syntax error")];
    const result = validateInsertedProof({
      baseline,
      post,
      insertionLine: 5,
      insertedLineCount: 2
    });
    expect(result.kind).toBe("regression");
  });

  it("ignores new errors strictly before the insertion line", () => {
    const baseline: ValidationDiagnostic[] = [];
    const post = [diag("error", 2, "Earlier error")];
    const result = validateInsertedProof({
      baseline,
      post,
      insertionLine: 5,
      insertedLineCount: 1
    });
    expect(result.kind).toBe("no-regression");
  });

  it("does not flag a pre-existing baseline error that shifted down past the insertion", () => {
    const baseline = [diag("error", 10, "Pre-existing failure")];
    const post = [diag("error", 12, "Pre-existing failure")];
    const result = validateInsertedProof({
      baseline,
      post,
      insertionLine: 5,
      insertedLineCount: 2
    });
    expect(result.kind).toBe("no-regression");
  });

  it("ignores non-error severities in the post snapshot", () => {
    const baseline: ValidationDiagnostic[] = [];
    const post = [diag("warning", 8, "minor"), diag("info", 9, "note")];
    const result = validateInsertedProof({
      baseline,
      post,
      insertionLine: 5,
      insertedLineCount: 1
    });
    expect(result.kind).toBe("no-regression");
  });

  it("aggregates multiple new errors", () => {
    const baseline: ValidationDiagnostic[] = [];
    const post = [
      diag("error", 5, "first"),
      diag("error", 6, "second"),
      diag("error", 7, "third")
    ];
    const result = validateInsertedProof({
      baseline,
      post,
      insertionLine: 5,
      insertedLineCount: 1
    });
    expect(result.kind).toBe("regression");
    if (result.kind === "regression") {
      expect(result.newErrors).toHaveLength(3);
    }
  });

  it("treats diagnostics from different sources as distinct in dedupe", () => {
    const baseline = [diag("error", 5, "boom", "isabelle build")];
    const post = [
      diag("error", 5, "boom", "isabelle build"),
      diag("error", 5, "boom", "isabelle")
    ];
    const result = validateInsertedProof({
      baseline,
      post,
      insertionLine: 5,
      insertedLineCount: 0
    });
    expect(result.kind).toBe("regression");
    if (result.kind === "regression") {
      expect(result.newErrors).toHaveLength(1);
      expect(result.newErrors[0]?.source).toBe("isabelle");
    }
  });

  it("treats messages with cosmetic whitespace differences as the same diagnostic", () => {
    const baseline = [diag("error", 5, "Failed  to apply method")];
    const post = [diag("error", 5, "Failed to apply method")];
    const result = validateInsertedProof({
      baseline,
      post,
      insertionLine: 5,
      insertedLineCount: 0
    });
    expect(result.kind).toBe("no-regression");
  });
});

describe("countInsertedLines", () => {
  it("returns 0 for a single-line insertion", () => {
    expect(countInsertedLines("by auto")).toBe(0);
  });

  it("counts a single newline as one inserted line", () => {
    expect(countInsertedLines("by auto\n")).toBe(1);
  });

  it("treats CRLF as one inserted line", () => {
    expect(countInsertedLines("by auto\r\n")).toBe(1);
  });

  it("counts multiple newlines correctly", () => {
    expect(countInsertedLines("apply auto\napply blast\n")).toBe(2);
  });
});

describe("computeInsertedEnd", () => {
  it("returns the same-line end when no newlines are present", () => {
    const end = computeInsertedEnd({ line: 3, character: 5 }, "by auto");
    expect(end).toEqual({ line: 3, character: 12 });
  });

  it("ends on the line following the last newline at the post-newline column", () => {
    const end = computeInsertedEnd({ line: 3, character: 5 }, "  apply blast\n");
    expect(end).toEqual({ line: 4, character: 0 });
  });

  it("normalizes CRLF to LF for the position arithmetic", () => {
    const end = computeInsertedEnd({ line: 3, character: 5 }, "by auto\r\n");
    expect(end).toEqual({ line: 4, character: 0 });
  });

  it("counts the column on the last line correctly for multi-line inserts", () => {
    const end = computeInsertedEnd({ line: 2, character: 0 }, "apply auto\napply blast");
    expect(end).toEqual({ line: 3, character: "apply blast".length });
  });
});
