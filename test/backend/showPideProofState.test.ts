import { describe, expect, it } from "vitest";
import { formatPideProofState } from "../../src/backend/showPideProofState";
import { ProofStateWithPideResult } from "../../src/protocol/messages";

function base(overrides: Partial<ProofStateWithPideResult> = {}): ProofStateWithPideResult {
  return {
    uri: "file:///workspace/Smoke.thy",
    theoryName: "Smoke",
    status: "ready",
    bridge: "pide-enabled",
    context: [],
    goals: [],
    raw: "",
    message: "PIDE snapshot ready",
    ...overrides
  };
}

describe("formatPideProofState", () => {
  it("renders info severity with command kind in title when status is ready", () => {
    const formatted = formatPideProofState(
      base({
        command: { id: "x", kind: "lemma", status: "finished" },
        goals: [{ index: 1, text: "1. True" }]
      })
    );
    expect(formatted.severity).toBe("info");
    expect(formatted.title).toContain("lemma");
    expect(formatted.title).toContain("Smoke");
  });

  it("calls out (from cache) in the title when fromCache=true", () => {
    const formatted = formatPideProofState(
      base({ fromCache: true, command: { id: "x", kind: "by", status: "finished" } })
    );
    expect(formatted.title).toContain("(from cache)");
  });

  it("renders warning severity for warmup-cancelled", () => {
    const formatted = formatPideProofState(
      base({
        status: "unavailable",
        bridge: "local-syntax",
        reason: "warmup-cancelled",
        message: "Cancelled."
      })
    );
    expect(formatted.severity).toBe("warning");
    expect(formatted.detail).toContain("re-bootstrap");
  });

  it("renders error severity with hint for session-not-selected", () => {
    const formatted = formatPideProofState(
      base({
        status: "unavailable",
        bridge: "local-syntax",
        reason: "session-not-selected",
        message: "Select a session."
      })
    );
    expect(formatted.severity).toBe("error");
    expect(formatted.detail).toContain("Isabelle: Select Active Session");
  });

  it("renders generic error when reason is missing", () => {
    const formatted = formatPideProofState(
      base({
        status: "unavailable",
        bridge: "local-syntax",
        message: "Unknown failure"
      })
    );
    expect(formatted.severity).toBe("error");
    expect(formatted.detail).toBe("Unknown failure");
  });
});
