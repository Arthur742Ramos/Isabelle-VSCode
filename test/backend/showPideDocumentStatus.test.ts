import { describe, expect, it } from "vitest";
import {
  formatErrorMessages,
  formatPideDocumentStatus
} from "../../src/backend/showPideDocumentStatus";
import { CheckWithPideResult } from "../../src/protocol/messages";

function base(overrides: Partial<CheckWithPideResult> = {}): CheckWithPideResult {
  return {
    uri: "file:///workspace/Smoke.thy",
    theoryName: "Smoke",
    status: "pide-ok",
    bridge: "pide-enabled",
    message: "PIDE check OK (1 node(s), 3041 ms)",
    ...overrides
  };
}

describe("formatPideDocumentStatus", () => {
  it("renders info severity for pide-ok with node + timing summary", () => {
    const formatted = formatPideDocumentStatus(
      base({ ok: true, nodeCount: 1, elapsedMs: 3041 })
    );
    expect(formatted.severity).toBe("info");
    expect(formatted.title).toContain("Smoke");
    expect(formatted.title).toContain("1 node");
    expect(formatted.title).toContain("3041 ms");
  });

  it("renders error severity for pide-errors with sample error messages", () => {
    const formatted = formatPideDocumentStatus(
      base({
        status: "pide-errors",
        bridge: "pide-enabled",
        ok: false,
        nodeCount: 1,
        errorCount: 2,
        errorMessages: ["Failed: simp", "Type error in lemma foo"]
      })
    );
    expect(formatted.severity).toBe("error");
    expect(formatted.title).toContain("2 errors");
    expect(formatted.detail).toContain("Failed: simp");
    expect(formatted.detail).toContain("Type error in lemma foo");
  });

  it("renders warning severity with reason hint for pide-unavailable session-not-selected", () => {
    const formatted = formatPideDocumentStatus(
      base({
        status: "pide-unavailable",
        bridge: "local-syntax",
        reason: "session-not-selected",
        message: "Select an active session."
      })
    );
    expect(formatted.severity).toBe("warning");
    expect(formatted.detail).toContain("Select an active session.");
    expect(formatted.detail).toContain("Isabelle: Select Active Session");
  });

  it("renders error severity with hint for pide-failed environment-init", () => {
    const formatted = formatPideDocumentStatus(
      base({
        status: "pide-failed",
        bridge: "local-syntax",
        reason: "environment-init",
        message: "Environment.init failed."
      })
    );
    expect(formatted.severity).toBe("error");
    expect(formatted.detail).toContain("Environment.init failed.");
    expect(formatted.detail).toContain("Cygwin");
  });

  it("renders warning severity for pide-cancelled without a remediation hint", () => {
    const formatted = formatPideDocumentStatus(
      base({
        status: "pide-cancelled",
        bridge: "local-syntax",
        message: "PIDE warmup cancelled."
      })
    );
    expect(formatted.severity).toBe("warning");
    expect(formatted.detail).toBe("PIDE warmup cancelled.");
  });

  it("falls back to a generic warning for unrecognised status codes", () => {
    const formatted = formatPideDocumentStatus(
      base({ status: "future-status" as unknown as CheckWithPideResult["status"] })
    );
    expect(formatted.severity).toBe("warning");
    expect(formatted.title).toContain("unrecognised");
  });
});

describe("formatErrorMessages", () => {
  it("returns (none) for an empty list", () => {
    expect(formatErrorMessages([])).toBe("(none)");
  });

  it("numbers each entry and prefixes with two spaces", () => {
    const formatted = formatErrorMessages(["first", "second"]);
    expect(formatted).toContain("  [1] first");
    expect(formatted).toContain("  [2] second");
  });

  it("truncates with an overflow tail when there are more than `limit` entries", () => {
    const formatted = formatErrorMessages(["a", "b", "c", "d"], 2);
    expect(formatted).toContain("[1] a");
    expect(formatted).toContain("[2] b");
    expect(formatted).toContain("... and 2 more");
    expect(formatted).not.toContain("[3]");
  });
});
