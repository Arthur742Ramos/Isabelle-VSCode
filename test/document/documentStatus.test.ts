import { describe, expect, it } from "vitest";
import { extractCommandSpans } from "../../src/document/commandSpans";
import {
  buildDocumentStatusSnapshot,
  buildDocumentStatusSummary,
  buildDocumentStatusSummaryFromSnapshot,
  DOCUMENT_STATUS_SOURCE,
  DOCUMENT_STATUS_SOURCE_LABEL,
  formatDocumentStatusBarText,
  formatDocumentStatusDetails,
  formatDocumentStatusTooltip
} from "../../src/document/documentStatus";

describe("document status summary", () => {
  const spans = extractCommandSpans(
    "file:///Status.thy",
    [
      "theory Status",
      "imports Main",
      "begin",
      "lemma current: True",
      "  by simp",
      "end"
    ].join("\n"),
    4
  );

  it("summarizes synchronized command spans and the current command", () => {
    const summary = buildDocumentStatusSummary({
      uri: "file:///Status.thy",
      version: 4,
      spans,
      position: { line: 3, character: 8 }
    });

    expect(summary.commandCount).toBe(6);
    expect(summary.statusCounts.pending).toBe(6);
    expect(summary.currentCommand?.label).toBe("lemma current");
    expect(summary.currentCommand?.status).toBe("pending");
    expect(formatDocumentStatusBarText(summary)).toBe("$(symbol-method) Isabelle local: lemma pending");
  });

  it("separates cached document status counts from cursor-specific current command", () => {
    const snapshot = buildDocumentStatusSnapshot({
      uri: "file:///Status.thy",
      version: 4,
      spans
    });

    const lemmaSummary = buildDocumentStatusSummaryFromSnapshot(snapshot, { line: 3, character: 8 });
    const methodSummary = buildDocumentStatusSummaryFromSnapshot(snapshot, { line: 4, character: 4 });

    expect(snapshot.statusCounts.pending).toBe(6);
    expect(lemmaSummary.statusCounts).toEqual(methodSummary.statusCounts);
    expect(lemmaSummary.currentCommand?.kind).toBe("lemma");
    expect(methodSummary.currentCommand?.kind).toBe("by");
  });

  it("labels the source as local syntax-only and does not publish diagnostics", () => {
    const summary = buildDocumentStatusSummary({
      uri: "file:///Status.thy",
      version: 4,
      spans,
      position: { line: 4, character: 4 }
    });

    expect(summary.source).toBe(DOCUMENT_STATUS_SOURCE);
    expect(summary.sourceLabel).toBe(DOCUMENT_STATUS_SOURCE_LABEL);
    expect(summary.diagnostics).toEqual({
      published: false,
      source: "none",
      reason: "This local status surface does not publish Isabelle diagnostics."
    });
    expect(formatDocumentStatusTooltip(summary)).toContain("not PIDE diagnostics");
    expect(formatDocumentStatusDetails(summary)).toContain("Diagnostics: This local status surface does not publish Isabelle diagnostics.");
  });
});
