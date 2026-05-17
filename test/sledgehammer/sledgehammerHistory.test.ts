import { describe, expect, it } from "vitest";
import { SledgehammerRunResult } from "../../src/protocol/messages";
import { SledgehammerHistory } from "../../src/sledgehammer/sledgehammerHistory";

function buildResult(overrides: Partial<SledgehammerRunResult> = {}): SledgehammerRunResult {
  return {
    requestId: "sledgehammer-1",
    uri: "file:///A.thy",
    status: "completed",
    suggestions: [],
    raw: "ok",
    ...overrides
  };
}

describe("SledgehammerHistory", () => {
  it("records a started entry and returns it as the most recent", () => {
    const history = new SledgehammerHistory();

    const entry = history.recordStart({
      requestId: "sledgehammer-1",
      uri: "file:///A.thy",
      version: 3,
      sessionName: "HOL",
      isabelleExecutablePath: "isabelle",
      startedAt: "2026-01-01T00:00:00.000Z"
    });

    expect(entry.status).toBe("running");
    expect(entry.suggestionCount).toBe(0);
    expect(entry.version).toBe(3);
    expect(entry.sessionName).toBe("HOL");
    expect(history.list()).toHaveLength(1);
    expect(history.list()[0].requestId).toBe("sledgehammer-1");
  });

  it("lists entries with the most recent first and updates results", () => {
    const history = new SledgehammerHistory();

    history.recordStart({
      requestId: "sledgehammer-1",
      uri: "file:///A.thy",
      startedAt: "2026-01-01T00:00:00.000Z"
    });
    history.recordStart({
      requestId: "sledgehammer-2",
      uri: "file:///B.thy",
      startedAt: "2026-01-01T00:00:01.000Z"
    });

    const updated = history.recordResult(
      "sledgehammer-1",
      buildResult({
        requestId: "sledgehammer-1",
        status: "completed",
        suggestions: [
          { proofText: "by auto" },
          { proofText: "by simp" }
        ],
        message: "found 2 proofs",
        version: 7,
        command: { id: "c1", kind: "lemma", name: "foo", status: "pending", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } }
      }),
      "2026-01-01T00:00:02.000Z"
    );

    expect(updated?.status).toBe("completed");
    expect(updated?.suggestionCount).toBe(2);
    expect(updated?.message).toBe("found 2 proofs");
    expect(updated?.finishedAt).toBe("2026-01-01T00:00:02.000Z");
    expect(updated?.version).toBe(7);
    expect(updated?.commandSummary).toBe("lemma foo");

    const list = history.list();
    expect(list.map((entry) => entry.requestId)).toEqual(["sledgehammer-2", "sledgehammer-1"]);
    expect(list[1].status).toBe("completed");
    expect(list[1].suggestionCount).toBe(2);
  });

  it("falls back to the command kind when no name is available", () => {
    const history = new SledgehammerHistory();
    history.recordStart({
      requestId: "sledgehammer-1",
      uri: "file:///A.thy",
      startedAt: "2026-01-01T00:00:00.000Z"
    });

    const updated = history.recordResult(
      "sledgehammer-1",
      buildResult({
        command: { id: "c1", kind: "show", status: "pending", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } }
      }),
      "2026-01-01T00:00:01.000Z"
    );

    expect(updated?.commandSummary).toBe("show");
  });

  it("records cancellations and failures", () => {
    const history = new SledgehammerHistory();
    history.recordStart({
      requestId: "sledgehammer-1",
      uri: "file:///A.thy",
      startedAt: "2026-01-01T00:00:00.000Z"
    });
    history.recordStart({
      requestId: "sledgehammer-2",
      uri: "file:///B.thy",
      startedAt: "2026-01-01T00:00:01.000Z"
    });

    const cancelled = history.recordCancellation("sledgehammer-1", "user cancelled", "2026-01-01T00:00:02.000Z");
    const failed = history.recordFailure("sledgehammer-2", "backend exploded", "2026-01-01T00:00:03.000Z");

    expect(cancelled?.status).toBe("cancelled");
    expect(cancelled?.message).toBe("user cancelled");
    expect(cancelled?.finishedAt).toBe("2026-01-01T00:00:02.000Z");

    expect(failed?.status).toBe("failed");
    expect(failed?.message).toBe("backend exploded");
    expect(failed?.finishedAt).toBe("2026-01-01T00:00:03.000Z");
  });

  it("returns undefined when recording results for unknown request ids", () => {
    const history = new SledgehammerHistory();
    const result = buildResult();

    expect(history.recordResult("missing", result, "2026-01-01T00:00:00.000Z")).toBeUndefined();
    expect(history.recordCancellation("missing", "n/a", "2026-01-01T00:00:00.000Z")).toBeUndefined();
    expect(history.recordFailure("missing", "n/a", "2026-01-01T00:00:00.000Z")).toBeUndefined();
    expect(history.list()).toHaveLength(0);
  });

  it("truncates the history to the configured cap, keeping the most recent entries", () => {
    const history = new SledgehammerHistory(3);
    for (let index = 1; index <= 5; index += 1) {
      history.recordStart({
        requestId: `sledgehammer-${index}`,
        uri: `file:///A${index}.thy`,
        startedAt: `2026-01-01T00:00:0${index}.000Z`
      });
    }

    const ids = history.list().map((entry) => entry.requestId);
    expect(ids).toEqual(["sledgehammer-5", "sledgehammer-4", "sledgehammer-3"]);
  });

  it("re-records the same requestId without duplicating", () => {
    const history = new SledgehammerHistory();
    history.recordStart({ requestId: "sledgehammer-1", uri: "file:///A.thy", startedAt: "2026-01-01T00:00:00.000Z" });
    history.recordStart({ requestId: "sledgehammer-2", uri: "file:///B.thy", startedAt: "2026-01-01T00:00:01.000Z" });
    history.recordStart({ requestId: "sledgehammer-1", uri: "file:///A.thy", startedAt: "2026-01-01T00:00:02.000Z" });

    const ids = history.list().map((entry) => entry.requestId);
    expect(ids).toEqual(["sledgehammer-1", "sledgehammer-2"]);
    expect(history.find("sledgehammer-1")?.startedAt).toBe("2026-01-01T00:00:02.000Z");
  });

  it("finds entries by request id and returns defensive copies", () => {
    const history = new SledgehammerHistory();
    history.recordStart({ requestId: "sledgehammer-1", uri: "file:///A.thy", startedAt: "2026-01-01T00:00:00.000Z" });

    const found = history.find("sledgehammer-1");
    expect(found?.requestId).toBe("sledgehammer-1");
    expect(history.find("missing")).toBeUndefined();

    if (found) {
      found.status = "failed";
    }
    expect(history.find("sledgehammer-1")?.status).toBe("running");
  });

  it("clears the history", () => {
    const history = new SledgehammerHistory();
    history.recordStart({ requestId: "sledgehammer-1", uri: "file:///A.thy", startedAt: "2026-01-01T00:00:00.000Z" });
    history.recordStart({ requestId: "sledgehammer-2", uri: "file:///B.thy", startedAt: "2026-01-01T00:00:01.000Z" });

    history.clear();
    expect(history.list()).toHaveLength(0);
    expect(history.find("sledgehammer-1")).toBeUndefined();
  });

  it("rejects invalid max entry caps", () => {
    expect(() => new SledgehammerHistory(0)).toThrow();
    expect(() => new SledgehammerHistory(-1)).toThrow();
    expect(() => new SledgehammerHistory(Number.NaN)).toThrow();
  });

  it("requires a non-empty requestId at recordStart", () => {
    const history = new SledgehammerHistory();
    expect(() =>
      history.recordStart({ requestId: "", uri: "file:///A.thy", startedAt: "2026-01-01T00:00:00.000Z" })
    ).toThrow();
  });
});
