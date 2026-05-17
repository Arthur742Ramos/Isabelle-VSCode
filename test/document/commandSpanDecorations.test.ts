import { describe, expect, it } from "vitest";
import {
  STATUS_DECORATION_KEYS,
  computeDecorationGroupsForLspState,
  emptyStatusRangeGroups,
  groupCommandSpanRangesByStatus,
  shouldSuppressLocalCommandSpanDecorations
} from "../../src/document/commandSpanDecorationGroups";
import { IsabelleLanguageServerState } from "../../src/lsp/lspTypes";
import { CommandSpan, ProtocolRange } from "../../src/protocol/messages";

function makeRange(line: number, character: number, endLine = line, endCharacter = character + 1): ProtocolRange {
  return {
    start: { line, character },
    end: { line: endLine, character: endCharacter }
  };
}

function makeSpan(
  id: string,
  status: CommandSpan["status"],
  range: ProtocolRange = makeRange(0, 0)
): CommandSpan {
  return { id, kind: "lemma", status, range };
}

describe("groupCommandSpanRangesByStatus", () => {
  it("returns empty arrays for every status when there are no spans", () => {
    const groups = groupCommandSpanRangesByStatus([]);

    expect(Object.keys(groups).sort()).toEqual([...STATUS_DECORATION_KEYS].sort());
    for (const status of STATUS_DECORATION_KEYS) {
      expect(groups[status]).toEqual([]);
    }
    expect(groups).toEqual(emptyStatusRangeGroups());
  });

  it("groups mixed-status spans into the matching status arrays in input order", () => {
    const pendingRange = makeRange(0, 0, 0, 5);
    const runningRange = makeRange(1, 2, 1, 7);
    const finishedRangeA = makeRange(2, 0, 2, 4);
    const finishedRangeB = makeRange(3, 0, 3, 4);
    const failedRange = makeRange(4, 0, 4, 6);

    const spans: CommandSpan[] = [
      makeSpan("a", "pending", pendingRange),
      makeSpan("b", "finished", finishedRangeA),
      makeSpan("c", "running", runningRange),
      makeSpan("d", "failed", failedRange),
      makeSpan("e", "finished", finishedRangeB)
    ];

    const groups = groupCommandSpanRangesByStatus(spans);

    expect(groups.pending).toEqual([pendingRange]);
    expect(groups.running).toEqual([runningRange]);
    expect(groups.finished).toEqual([finishedRangeA, finishedRangeB]);
    expect(groups.failed).toEqual([failedRange]);
    expect(groups.unknown).toEqual([]);
  });

  it("falls back to the unknown bucket for statuses outside the standard set", () => {
    const knownRange = makeRange(0, 0, 0, 3);
    const declaredUnknownRange = makeRange(1, 0, 1, 3);
    const stragglerRange = makeRange(2, 0, 2, 3);

    const spans: CommandSpan[] = [
      makeSpan("a", "pending", knownRange),
      makeSpan("b", "unknown", declaredUnknownRange),
      { id: "c", kind: "lemma", status: "weird-status" as unknown as CommandSpan["status"], range: stragglerRange }
    ];

    const groups = groupCommandSpanRangesByStatus(spans);

    expect(groups.pending).toEqual([knownRange]);
    expect(groups.unknown).toEqual([declaredUnknownRange, stragglerRange]);
    expect(groups.running).toEqual([]);
    expect(groups.finished).toEqual([]);
    expect(groups.failed).toEqual([]);
    expect(Object.keys(groups).sort()).toEqual([...STATUS_DECORATION_KEYS].sort());
  });
});

describe("shouldSuppressLocalCommandSpanDecorations", () => {
  // Local command spans always carry status "pending" because they are
  // a syntactic placeholder, not real PIDE processing state. When the
  // Isabelle language server is running, the LSP's own published
  // diagnostics replace the local "pending" gutter as the source of
  // per-command processing information; the local dashed border would
  // otherwise mislead the user. The suppression policy is binary today:
  // suppress when the LSP is `running`, keep local-only otherwise.

  it("suppresses local decorations exactly when the LSP is running", () => {
    expect(shouldSuppressLocalCommandSpanDecorations("running")).toBe(true);
  });

  it("does not suppress when the LSP is disabled, starting, stopping, or failed", () => {
    const nonRunning: IsabelleLanguageServerState[] = [
      "disabled",
      "starting",
      "stopping",
      "failed"
    ];
    for (const state of nonRunning) {
      expect(shouldSuppressLocalCommandSpanDecorations(state)).toBe(false);
    }
  });

  it("does not suppress when no LSP is wired (state undefined)", () => {
    expect(shouldSuppressLocalCommandSpanDecorations(undefined)).toBe(false);
  });
});

describe("computeDecorationGroupsForLspState", () => {
  const spans: CommandSpan[] = [
    makeSpan("a", "pending", makeRange(0, 0, 0, 5)),
    makeSpan("b", "finished", makeRange(1, 0, 1, 4)),
    makeSpan("c", "failed", makeRange(2, 0, 2, 6))
  ];

  it("delegates to groupCommandSpanRangesByStatus when the LSP is not running", () => {
    const groups = computeDecorationGroupsForLspState(spans, "disabled");
    expect(groups).toEqual(groupCommandSpanRangesByStatus(spans));
  });

  it("returns the empty group shape when the LSP is running (decorations suppressed)", () => {
    const groups = computeDecorationGroupsForLspState(spans, "running");
    expect(groups).toEqual(emptyStatusRangeGroups());
    for (const status of STATUS_DECORATION_KEYS) {
      expect(groups[status]).toEqual([]);
    }
  });

  it("delegates with the same input across each non-running LSP state", () => {
    const expected = groupCommandSpanRangesByStatus(spans);
    const nonRunning: (IsabelleLanguageServerState | undefined)[] = [
      "disabled",
      "starting",
      "stopping",
      "failed",
      undefined
    ];
    for (const state of nonRunning) {
      expect(computeDecorationGroupsForLspState(spans, state)).toEqual(expected);
    }
  });

  it("returns an empty-group shape (not a shared reference) when suppressing", () => {
    // Guard against accidental aliasing of the empty groups object — each
    // call must hand out a fresh copy so callers can mutate it safely.
    const a = computeDecorationGroupsForLspState(spans, "running");
    const b = computeDecorationGroupsForLspState(spans, "running");
    expect(a).not.toBe(b);
    expect(a.pending).not.toBe(b.pending);
  });
});
