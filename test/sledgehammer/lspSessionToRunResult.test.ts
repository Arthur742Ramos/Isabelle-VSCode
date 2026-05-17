import { describe, expect, it } from "vitest";
import { SessionUpdate } from "../../src/sledgehammer/LspSledgehammerSession";
import {
  convertSessionUpdateToRunResult,
  isTerminalSessionStatus,
  mapSessionStatusToSledgehammerStatus,
  sendbacksToSuggestions
} from "../../src/sledgehammer/lspSessionToRunResult";

const OPTS = {
  requestId: "sledgehammer-lsp-1",
  uri: "file:///workspace/Demo.thy",
  documentVersion: 42
};

function makeUpdate(overrides: Partial<SessionUpdate> = {}): SessionUpdate {
  return {
    status: "running",
    statusMessage: undefined,
    outputNodes: [],
    sendbacks: [],
    ...overrides
  };
}

describe("mapSessionStatusToSledgehammerStatus", () => {
  it("collapses dispatching and running to the wire 'running' status", () => {
    expect(mapSessionStatusToSledgehammerStatus("dispatching")).toBe("running");
    expect(mapSessionStatusToSledgehammerStatus("running")).toBe("running");
  });

  it("maps finished to completed, cancelled to cancelled, errored to failed", () => {
    expect(mapSessionStatusToSledgehammerStatus("finished")).toBe("completed");
    expect(mapSessionStatusToSledgehammerStatus("cancelled")).toBe("cancelled");
    expect(mapSessionStatusToSledgehammerStatus("errored")).toBe("failed");
  });
});

describe("isTerminalSessionStatus", () => {
  it("treats finished, cancelled, and errored as terminal", () => {
    expect(isTerminalSessionStatus("finished")).toBe(true);
    expect(isTerminalSessionStatus("cancelled")).toBe(true);
    expect(isTerminalSessionStatus("errored")).toBe(true);
  });

  it("treats dispatching and running as non-terminal", () => {
    expect(isTerminalSessionStatus("dispatching")).toBe(false);
    expect(isTerminalSessionStatus("running")).toBe(false);
  });
});

describe("sendbacksToSuggestions", () => {
  it("returns no suggestions for an empty sendback list", () => {
    expect(sendbacksToSuggestions([])).toEqual([]);
  });

  it("maps each sendback to a numbered Suggestion entry carrying the proof text", () => {
    expect(sendbacksToSuggestions(["by auto", "by blast"])).toEqual([
      { label: "Suggestion 1", method: "by auto", proofText: "by auto" },
      { label: "Suggestion 2", method: "by blast", proofText: "by blast" }
    ]);
  });

  it("uses the sendback text verbatim for the method and proofText fields", () => {
    // The two fields exist for separate reasons: method drives the
    // renderer label, proofText drives the existing Insert command.
    // Keep both in lockstep with the upstream sendback string so the
    // insert flow produces the exact proof Isabelle suggested.
    const suggestions = sendbacksToSuggestions(["by (auto simp: foo)"]);
    expect(suggestions[0].method).toBe("by (auto simp: foo)");
    expect(suggestions[0].proofText).toBe("by (auto simp: foo)");
  });
});

describe("convertSessionUpdateToRunResult", () => {
  it("carries through the supplied requestId, uri, and document version", () => {
    const result = convertSessionUpdateToRunResult(makeUpdate(), OPTS);
    expect(result.requestId).toBe("sledgehammer-lsp-1");
    expect(result.uri).toBe("file:///workspace/Demo.thy");
    expect(result.version).toBe(42);
  });

  it("maps the dispatching status with the canonical dispatched message", () => {
    const result = convertSessionUpdateToRunResult(
      makeUpdate({ status: "dispatching" }),
      OPTS
    );
    expect(result.status).toBe("running");
    expect(result.message).toBe(
      "Sledgehammer request dispatched to isabelle vscode_server."
    );
    expect(result.raw).toBe("");
  });

  it("surfaces the upstream PIDE/sledgehammer_status.message in raw + message while running", () => {
    const result = convertSessionUpdateToRunResult(
      makeUpdate({
        status: "running",
        statusMessage: "Waiting for evaluation of context ..."
      }),
      OPTS
    );
    expect(result.raw).toBe("Waiting for evaluation of context ...");
    expect(result.message).toBe("Waiting for evaluation of context ...");
  });

  it("counts proof suggestions in the finished message", () => {
    const one = convertSessionUpdateToRunResult(
      makeUpdate({
        status: "finished",
        statusMessage: "Finished",
        sendbacks: ["by auto"]
      }),
      OPTS
    );
    expect(one.status).toBe("completed");
    expect(one.suggestions).toEqual([
      { label: "Suggestion 1", method: "by auto", proofText: "by auto" }
    ]);
    expect(one.message).toBe("Sledgehammer found 1 proof suggestion.");

    const many = convertSessionUpdateToRunResult(
      makeUpdate({
        status: "finished",
        statusMessage: "Finished",
        sendbacks: ["by auto", "by blast", "by fast"]
      }),
      OPTS
    );
    expect(many.message).toBe("Sledgehammer found 3 proof suggestions.");
  });

  it("falls back to the upstream status when finished without suggestions", () => {
    const result = convertSessionUpdateToRunResult(
      makeUpdate({
        status: "finished",
        statusMessage: "Finished",
        sendbacks: []
      }),
      OPTS
    );
    expect(result.status).toBe("completed");
    expect(result.suggestions).toEqual([]);
    expect(result.message).toBe("Sledgehammer finished: Finished");
  });

  it("uses a default finished message when the upstream status is missing", () => {
    const result = convertSessionUpdateToRunResult(
      makeUpdate({ status: "finished", statusMessage: undefined, sendbacks: [] }),
      OPTS
    );
    expect(result.message).toBe("Sledgehammer finished with no proof suggestions.");
  });

  it("maps a cancelled session to status 'cancelled' with a friendly message", () => {
    const explicit = convertSessionUpdateToRunResult(
      makeUpdate({ status: "cancelled", statusMessage: "Finished" }),
      OPTS
    );
    expect(explicit.status).toBe("cancelled");
    expect(explicit.message).toBe("Sledgehammer cancelled: Finished");

    const implicit = convertSessionUpdateToRunResult(
      makeUpdate({ status: "cancelled", statusMessage: undefined }),
      OPTS
    );
    expect(implicit.message).toBe("Sledgehammer cancelled.");
  });

  it("maps an errored session to status 'failed' with the upstream error in the message", () => {
    const result = convertSessionUpdateToRunResult(
      makeUpdate({ status: "errored", statusMessage: "transport closed" }),
      OPTS
    );
    expect(result.status).toBe("failed");
    expect(result.message).toBe("Sledgehammer LSP error: transport closed");
    expect(result.raw).toBe("transport closed");
  });

  it("uses a default errored message when no statusMessage is set", () => {
    const result = convertSessionUpdateToRunResult(
      makeUpdate({ status: "errored", statusMessage: undefined }),
      OPTS
    );
    expect(result.message).toBe("Sledgehammer LSP error.");
  });

  it("allows documentVersion to be omitted (history replay path may not have one)", () => {
    const result = convertSessionUpdateToRunResult(
      makeUpdate({ status: "running" }),
      { requestId: "sledgehammer-lsp-2", uri: "file:///A.thy" }
    );
    expect(result.version).toBeUndefined();
  });
});
