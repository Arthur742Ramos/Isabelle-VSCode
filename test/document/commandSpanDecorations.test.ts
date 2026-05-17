import { describe, expect, it } from "vitest";
import {
  STATUS_DECORATION_KEYS,
  emptyStatusRangeGroups,
  groupCommandSpanRangesByStatus
} from "../../src/document/commandSpanDecorationGroups";
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
