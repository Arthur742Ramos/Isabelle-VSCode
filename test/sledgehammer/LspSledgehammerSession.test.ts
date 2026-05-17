import { describe, expect, it } from "vitest";
import {
  LspSledgehammerSession,
  PIDE_CARET_UPDATE_METHOD,
  PIDE_FINISHED_STATUS_MESSAGE,
  PIDE_SLEDGEHAMMER_CANCEL_METHOD,
  PIDE_SLEDGEHAMMER_OUTPUT_METHOD,
  PIDE_SLEDGEHAMMER_REQUEST_METHOD,
  PIDE_SLEDGEHAMMER_STATUS_METHOD,
  SessionClient,
  SessionDisposable,
  SessionInputs,
  SessionLogger,
  SessionUpdate,
  SessionUpdateHandler
} from "../../src/sledgehammer/LspSledgehammerSession";
import { SledgehammerSettings } from "../../src/sledgehammer/sledgehammerSettings";

/**
 * Minimal in-memory test double for the language-client subset the
 * session uses. Records every outbound notification and exposes
 * helpers to inject inbound notifications synchronously.
 */
class FakeClient implements SessionClient {
  public readonly sent: { method: string; params: unknown }[] = [];
  public readonly handlers = new Map<string, Set<(params: unknown) => void>>();
  public sendNotificationThrowOnce: Error | undefined;

  public sendNotification(method: string, params?: unknown): void {
    if (this.sendNotificationThrowOnce) {
      const err = this.sendNotificationThrowOnce;
      this.sendNotificationThrowOnce = undefined;
      throw err;
    }
    this.sent.push({ method, params });
  }

  public onNotification(
    method: string,
    handler: (params: unknown) => void
  ): SessionDisposable {
    let set = this.handlers.get(method);
    if (!set) {
      set = new Set();
      this.handlers.set(method, set);
    }
    set.add(handler);
    return {
      dispose: () => {
        set?.delete(handler);
      }
    };
  }

  public emit(method: string, params: unknown): void {
    const set = this.handlers.get(method);
    if (!set) return;
    for (const handler of [...set]) {
      handler(params);
    }
  }
}

class CollectingLogger implements SessionLogger {
  public readonly messages: string[] = [];
  public appendLine(message: string): void {
    this.messages.push(message);
  }
}

const DEFAULT_SETTINGS: SledgehammerSettings = {
  provers: "",
  isar: false,
  try0: true
};

function makeInputs(overrides: Partial<SessionInputs> = {}): SessionInputs {
  return {
    uri: "file:///workspace/Demo.thy",
    position: { line: 5, character: 4 },
    settings: DEFAULT_SETTINGS,
    fallbackProvers: "cvc5 verit z3",
    ...overrides
  };
}

function record(): { updates: SessionUpdate[]; handler: SessionUpdateHandler } {
  const updates: SessionUpdate[] = [];
  return {
    updates,
    handler: (update) => {
      updates.push(update);
    }
  };
}

describe("LspSledgehammerSession", () => {
  describe("dispatch", () => {
    it("subscribes to status and output before sending the request", () => {
      const client = new FakeClient();
      const session = new LspSledgehammerSession(
        client,
        new CollectingLogger(),
        makeInputs(),
        () => {}
      );
      expect(client.handlers.get(PIDE_SLEDGEHAMMER_STATUS_METHOD)?.size).toBe(1);
      expect(client.handlers.get(PIDE_SLEDGEHAMMER_OUTPUT_METHOD)?.size).toBe(1);
      session.dispose();
    });

    it("sends PIDE/caret_update then PIDE/sledgehammer_request in that order", () => {
      const client = new FakeClient();
      const session = new LspSledgehammerSession(
        client,
        new CollectingLogger(),
        makeInputs(),
        () => {}
      );
      expect(client.sent.map((s) => s.method)).toEqual([
        PIDE_CARET_UPDATE_METHOD,
        PIDE_SLEDGEHAMMER_REQUEST_METHOD
      ]);
      session.dispose();
    });

    it("populates PIDE/caret_update with uri, line, character, and focus=true by default", () => {
      const client = new FakeClient();
      const session = new LspSledgehammerSession(
        client,
        new CollectingLogger(),
        makeInputs(),
        () => {}
      );
      expect(client.sent[0]).toEqual({
        method: PIDE_CARET_UPDATE_METHOD,
        params: {
          uri: "file:///workspace/Demo.thy",
          line: 5,
          character: 4,
          focus: true
        }
      });
      session.dispose();
    });

    it("honors an explicit focus=false caller override on the caret update", () => {
      const client = new FakeClient();
      const session = new LspSledgehammerSession(
        client,
        new CollectingLogger(),
        makeInputs({ focus: false }),
        () => {}
      );
      expect(client.sent[0]?.params).toMatchObject({ focus: false });
      session.dispose();
    });

    it("uses settings.provers when set and bypasses the fallback list", () => {
      const client = new FakeClient();
      const session = new LspSledgehammerSession(
        client,
        new CollectingLogger(),
        makeInputs({
          settings: { provers: " cvc5  verit ", isar: true, try0: false },
          fallbackProvers: "z3 e"
        }),
        () => {}
      );
      expect(client.sent[1]).toEqual({
        method: PIDE_SLEDGEHAMMER_REQUEST_METHOD,
        params: { provers: "cvc5 verit", isar: true, try0: false }
      });
      session.dispose();
    });

    it("uses the cached fallback list when settings.provers is empty", () => {
      const client = new FakeClient();
      const session = new LspSledgehammerSession(
        client,
        new CollectingLogger(),
        makeInputs(),
        () => {}
      );
      expect(client.sent[1]?.params).toEqual({
        provers: "cvc5 verit z3",
        isar: false,
        try0: true
      });
      session.dispose();
    });

    it("emits a dispatching update before any server reply arrives", () => {
      const client = new FakeClient();
      const { updates, handler } = record();
      const session = new LspSledgehammerSession(
        client,
        new CollectingLogger(),
        makeInputs(),
        handler
      );
      expect(updates.length).toBeGreaterThan(0);
      expect(updates[updates.length - 1].status).toBe("dispatching");
      expect(updates[updates.length - 1].outputNodes).toEqual([]);
      expect(updates[updates.length - 1].sendbacks).toEqual([]);
      session.dispose();
    });

    it("transitions to errored and logs when sendNotification throws on caret_update", () => {
      const client = new FakeClient();
      const logger = new CollectingLogger();
      const { updates, handler } = record();
      client.sendNotificationThrowOnce = new Error("transport closed");
      const session = new LspSledgehammerSession(
        client,
        logger,
        makeInputs(),
        handler
      );
      expect(updates[updates.length - 1].status).toBe("errored");
      expect(updates[updates.length - 1].statusMessage).toBe("transport closed");
      expect(logger.messages.some((m) => m.includes("transport closed"))).toBe(true);
      session.dispose();
    });
  });

  describe("status notifications", () => {
    it("advances from dispatching to running on the first non-finished status", () => {
      const client = new FakeClient();
      const { updates, handler } = record();
      const session = new LspSledgehammerSession(
        client,
        new CollectingLogger(),
        makeInputs(),
        handler
      );
      client.emit(PIDE_SLEDGEHAMMER_STATUS_METHOD, {
        message: "Waiting for evaluation of context ..."
      });
      expect(updates[updates.length - 1].status).toBe("running");
      expect(updates[updates.length - 1].statusMessage).toBe(
        "Waiting for evaluation of context ..."
      );
      session.dispose();
    });

    it("transitions to finished on the Finished status message", () => {
      const client = new FakeClient();
      const { updates, handler } = record();
      const session = new LspSledgehammerSession(
        client,
        new CollectingLogger(),
        makeInputs(),
        handler
      );
      client.emit(PIDE_SLEDGEHAMMER_STATUS_METHOD, { message: "Sledgehammering ..." });
      client.emit(PIDE_SLEDGEHAMMER_STATUS_METHOD, { message: PIDE_FINISHED_STATUS_MESSAGE });
      expect(updates[updates.length - 1].status).toBe("finished");
      expect(session.getStatus()).toBe("finished");
      session.dispose();
    });

    it("ignores a malformed status payload but logs once per drop", () => {
      const client = new FakeClient();
      const logger = new CollectingLogger();
      const session = new LspSledgehammerSession(
        client,
        logger,
        makeInputs(),
        () => {}
      );
      client.emit(PIDE_SLEDGEHAMMER_STATUS_METHOD, { message: 42 });
      client.emit(PIDE_SLEDGEHAMMER_STATUS_METHOD, null);
      expect(
        logger.messages.filter((m) => m.includes("ignored malformed")).length
      ).toBe(2);
      // Session stayed in dispatching since no valid status arrived.
      expect(session.getStatus()).toBe("dispatching");
      session.dispose();
    });
  });

  describe("output notifications", () => {
    it("parses the live-probe error_message payload into segments and sendbacks", () => {
      const client = new FakeClient();
      const { updates, handler } = record();
      const session = new LspSledgehammerSession(
        client,
        new CollectingLogger(),
        makeInputs(),
        handler
      );
      client.emit(PIDE_SLEDGEHAMMER_OUTPUT_METHOD, {
        content: "<error_message>Unknown proof context</error_message>"
      });
      const latest = updates[updates.length - 1];
      expect(latest.outputNodes).toEqual([
        {
          kind: "error",
          children: [{ kind: "text", text: "Unknown proof context" }]
        }
      ]);
      expect(latest.sendbacks).toEqual([]);
      session.dispose();
    });

    it("replaces, does not append, when a second output snapshot arrives", () => {
      // Upstream emits each PIDE/sledgehammer_output as the latest
      // cumulative snapshot driven by Isabelle's Query_Operation
      // consume_output. The session must NOT concatenate snapshots.
      const client = new FakeClient();
      const { updates, handler } = record();
      const session = new LspSledgehammerSession(
        client,
        new CollectingLogger(),
        makeInputs(),
        handler
      );
      client.emit(PIDE_SLEDGEHAMMER_OUTPUT_METHOD, { content: "" });
      client.emit(PIDE_SLEDGEHAMMER_OUTPUT_METHOD, {
        content: "<information_message>Try this: <sendback>by auto</sendback></information_message>"
      });
      const latest = updates[updates.length - 1];
      expect(latest.outputNodes).toEqual([
        {
          kind: "information",
          children: [
            { kind: "text", text: "Try this: " },
            { kind: "sendback", text: "by auto" }
          ]
        }
      ]);
      expect(latest.sendbacks).toEqual(["by auto"]);
      session.dispose();
    });

    it("ignores a malformed output payload and logs", () => {
      const client = new FakeClient();
      const logger = new CollectingLogger();
      const session = new LspSledgehammerSession(
        client,
        logger,
        makeInputs(),
        () => {}
      );
      client.emit(PIDE_SLEDGEHAMMER_OUTPUT_METHOD, { content: 42 });
      client.emit(PIDE_SLEDGEHAMMER_OUTPUT_METHOD, undefined);
      expect(
        logger.messages.filter((m) => m.includes("ignored malformed")).length
      ).toBe(2);
      session.dispose();
    });
  });

  describe("cancellation", () => {
    it("sends PIDE/sledgehammer_cancel on cancel() and surfaces the request immediately", () => {
      const client = new FakeClient();
      const { updates, handler } = record();
      const session = new LspSledgehammerSession(
        client,
        new CollectingLogger(),
        makeInputs(),
        handler
      );
      const updatesBefore = updates.length;
      session.cancel();
      expect(
        client.sent.some((s) => s.method === PIDE_SLEDGEHAMMER_CANCEL_METHOD)
      ).toBe(true);
      expect(updates.length).toBeGreaterThan(updatesBefore);
      session.dispose();
    });

    it("transitions to 'cancelled' on the next Finished status after cancel", () => {
      const client = new FakeClient();
      const { updates, handler } = record();
      const session = new LspSledgehammerSession(
        client,
        new CollectingLogger(),
        makeInputs(),
        handler
      );
      client.emit(PIDE_SLEDGEHAMMER_STATUS_METHOD, { message: "Sledgehammering ..." });
      session.cancel();
      client.emit(PIDE_SLEDGEHAMMER_STATUS_METHOD, { message: PIDE_FINISHED_STATUS_MESSAGE });
      expect(updates[updates.length - 1].status).toBe("cancelled");
      expect(session.getStatus()).toBe("cancelled");
      session.dispose();
    });

    it("is a no-op once a terminal status has been reached", () => {
      const client = new FakeClient();
      const session = new LspSledgehammerSession(
        client,
        new CollectingLogger(),
        makeInputs(),
        () => {}
      );
      client.emit(PIDE_SLEDGEHAMMER_STATUS_METHOD, { message: PIDE_FINISHED_STATUS_MESSAGE });
      const sentBefore = client.sent.length;
      session.cancel();
      expect(client.sent.length).toBe(sentBefore);
      expect(session.getStatus()).toBe("finished");
      session.dispose();
    });

    it("logs and survives when sendNotification throws on cancel", () => {
      const client = new FakeClient();
      const logger = new CollectingLogger();
      const session = new LspSledgehammerSession(
        client,
        logger,
        makeInputs(),
        () => {}
      );
      client.sendNotificationThrowOnce = new Error("transport closed");
      // The throw fires on the FIRST send (caret_update), so consume it
      // and start a fresh session for the cancel test.
      session.dispose();

      const client2 = new FakeClient();
      const session2 = new LspSledgehammerSession(
        client2,
        logger,
        makeInputs(),
        () => {}
      );
      client2.sendNotificationThrowOnce = new Error("write after end");
      session2.cancel();
      expect(logger.messages.some((m) => m.includes("write after end"))).toBe(true);
      session2.dispose();
    });
  });

  describe("lifecycle", () => {
    it("releases status and output subscriptions on dispose", () => {
      const client = new FakeClient();
      const session = new LspSledgehammerSession(
        client,
        new CollectingLogger(),
        makeInputs(),
        () => {}
      );
      expect(client.handlers.get(PIDE_SLEDGEHAMMER_STATUS_METHOD)?.size).toBe(1);
      expect(client.handlers.get(PIDE_SLEDGEHAMMER_OUTPUT_METHOD)?.size).toBe(1);
      session.dispose();
      expect(client.handlers.get(PIDE_SLEDGEHAMMER_STATUS_METHOD)?.size ?? 0).toBe(0);
      expect(client.handlers.get(PIDE_SLEDGEHAMMER_OUTPUT_METHOD)?.size ?? 0).toBe(0);
    });

    it("dispose is idempotent", () => {
      const client = new FakeClient();
      const session = new LspSledgehammerSession(
        client,
        new CollectingLogger(),
        makeInputs(),
        () => {}
      );
      session.dispose();
      expect(() => session.dispose()).not.toThrow();
    });

    it("ignores late status notifications after dispose", () => {
      const client = new FakeClient();
      const { updates, handler } = record();
      const session = new LspSledgehammerSession(
        client,
        new CollectingLogger(),
        makeInputs(),
        handler
      );
      const updatesBefore = updates.length;
      session.dispose();
      // The registry-based subscription is gone after dispose, so this
      // emit reaches no handler. Belt-and-braces double-check.
      client.emit(PIDE_SLEDGEHAMMER_STATUS_METHOD, { message: "Sledgehammering ..." });
      expect(updates.length).toBe(updatesBefore);
    });

    it("logs but does not throw when the onUpdate handler throws", () => {
      const client = new FakeClient();
      const logger = new CollectingLogger();
      const session = new LspSledgehammerSession(
        client,
        logger,
        makeInputs(),
        () => {
          throw new Error("UI broke");
        }
      );
      expect(logger.messages.some((m) => m.includes("UI broke"))).toBe(true);
      // Subsequent emits still attempt to deliver and still log.
      client.emit(PIDE_SLEDGEHAMMER_STATUS_METHOD, { message: PIDE_FINISHED_STATUS_MESSAGE });
      expect(
        logger.messages.filter((m) => m.includes("UI broke")).length
      ).toBeGreaterThanOrEqual(2);
      session.dispose();
    });
  });
});
