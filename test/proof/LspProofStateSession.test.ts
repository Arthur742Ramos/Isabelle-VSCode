import { describe, expect, it } from "vitest";
import {
  LspProofStateSession,
  PIDE_STATE_AUTO_UPDATE_METHOD,
  PIDE_STATE_EXIT_METHOD,
  PIDE_STATE_INIT_METHOD,
  PIDE_STATE_LOCATE_METHOD,
  PIDE_STATE_OUTPUT_METHOD,
  PIDE_STATE_SET_MARGIN_METHOD,
  PIDE_STATE_UPDATE_METHOD,
  ProofStateDisposable,
  ProofStateLogger,
  ProofStateLspClient,
  ProofStateUpdate,
  ProofStateUpdateHandler
} from "../../src/proof/LspProofStateSession";

class FakeClient implements ProofStateLspClient {
  public readonly sent: { method: string; params: unknown }[] = [];
  public handlers = new Map<string, Set<(params: unknown) => void>>();
  /**
   * Queued reply for the next sendRequest call. Use:
   *   - { state_id: <number> } for a happy-path init
   *   - { reject: <Error> } to force a rejection
   *   - { malformed: true } to return a missing-state_id object
   */
  public nextRequestReply: unknown = { state_id: 42 };
  public sendThrowOnce: Error | undefined;
  public requestThrowOnce: Error | undefined;
  /** When true, sendRequest does not resolve until manuallyResolve is called. */
  public deferRequest = false;
  private pendingResolve: ((value: unknown) => void) | undefined;
  private pendingReject: ((reason: unknown) => void) | undefined;

  public sendNotification(method: string, params?: unknown): void {
    if (this.sendThrowOnce) {
      const err = this.sendThrowOnce;
      this.sendThrowOnce = undefined;
      throw err;
    }
    this.sent.push({ method, params });
  }

  public sendRequest<T>(_method: string, _params?: unknown): Promise<T> {
    if (this.requestThrowOnce) {
      const err = this.requestThrowOnce;
      this.requestThrowOnce = undefined;
      return Promise.reject(err);
    }
    if (this.deferRequest) {
      return new Promise<T>((resolve, reject) => {
        this.pendingResolve = (v) => resolve(v as T);
        this.pendingReject = reject;
      });
    }
    const reply = this.nextRequestReply;
    if (typeof reply === "object" && reply !== null && "reject" in (reply as object)) {
      return Promise.reject((reply as { reject: unknown }).reject);
    }
    if (typeof reply === "object" && reply !== null && "malformed" in (reply as object)) {
      return Promise.resolve({} as T);
    }
    return Promise.resolve(reply as T);
  }

  public resolveDeferredRequest(value: unknown): void {
    this.pendingResolve?.(value);
    this.pendingResolve = undefined;
    this.pendingReject = undefined;
  }

  public rejectDeferredRequest(reason: unknown): void {
    this.pendingReject?.(reason);
    this.pendingResolve = undefined;
    this.pendingReject = undefined;
  }

  public onNotification(
    method: string,
    handler: (params: unknown) => void
  ): ProofStateDisposable {
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

class CollectingLogger implements ProofStateLogger {
  public readonly messages: string[] = [];
  public appendLine(message: string): void {
    this.messages.push(message);
  }
}

function record(): { updates: ProofStateUpdate[]; handler: ProofStateUpdateHandler } {
  const updates: ProofStateUpdate[] = [];
  return {
    updates,
    handler: (update) => {
      updates.push(update);
    }
  };
}

async function flushMicrotasks(): Promise<void> {
  // Two ticks to settle resolved promises + their .then chains.
  await Promise.resolve();
  await Promise.resolve();
}

describe("LspProofStateSession", () => {
  describe("initialise", () => {
    it("subscribes to PIDE/state_output and sends PIDE/state_init", async () => {
      const client = new FakeClient();
      const session = new LspProofStateSession(client, new CollectingLogger(), () => {});
      await flushMicrotasks();
      expect(client.handlers.get(PIDE_STATE_OUTPUT_METHOD)?.size).toBe(1);
      expect(session.getStateId()).toBe(42);
      expect(session.getStatus()).toBe("active");
      session.dispose();
    });

    it("emits an initial 'initializing' update synchronously before the init reply arrives", () => {
      const client = new FakeClient();
      client.deferRequest = true;
      const { updates, handler } = record();
      const session = new LspProofStateSession(client, new CollectingLogger(), handler);
      // No microtask flush; the init request is still pending.
      expect(updates.length).toBeGreaterThan(0);
      expect(updates[updates.length - 1].status).toBe("initializing");
      expect(updates[updates.length - 1].outputNodes).toEqual([]);
      expect(updates[updates.length - 1].autoUpdate).toBe(true);
      session.dispose();
    });

    it("transitions to 'active' after the init reply", async () => {
      const client = new FakeClient();
      const { updates, handler } = record();
      const session = new LspProofStateSession(client, new CollectingLogger(), handler);
      await flushMicrotasks();
      const last = updates[updates.length - 1];
      expect(last.status).toBe("active");
      session.dispose();
    });

    it("transitions to 'errored' when sendRequest rejects with descriptive logging", async () => {
      const client = new FakeClient();
      const logger = new CollectingLogger();
      const { updates, handler } = record();
      client.nextRequestReply = { reject: new Error("server inactive") };
      const session = new LspProofStateSession(client, logger, handler);
      await flushMicrotasks();
      const last = updates[updates.length - 1];
      expect(last.status).toBe("errored");
      expect(last.errorMessage).toBe("server inactive");
      expect(logger.messages.some((m) => m.includes("server inactive"))).toBe(true);
      session.dispose();
    });

    it("transitions to 'errored' when the init reply is malformed", async () => {
      const client = new FakeClient();
      const { updates, handler } = record();
      client.nextRequestReply = { malformed: true };
      const session = new LspProofStateSession(client, new CollectingLogger(), handler);
      await flushMicrotasks();
      const last = updates[updates.length - 1];
      expect(last.status).toBe("errored");
      expect(last.errorMessage).toMatch(/Malformed/);
      session.dispose();
    });

    it("ignores a late init reply that arrives after dispose", async () => {
      const client = new FakeClient();
      client.deferRequest = true;
      const { updates, handler } = record();
      const session = new LspProofStateSession(client, new CollectingLogger(), handler);
      session.dispose();
      const countAfterDispose = updates.length;
      client.resolveDeferredRequest({ state_id: 7 });
      await flushMicrotasks();
      // Only the dispose-triggered "stopped" emission should have fired
      // — the late init reply should not transition us back to active.
      expect(session.getStatus()).not.toBe("active");
      // No extra "active" update appended.
      const activeAfter = updates.slice(countAfterDispose).filter((u) => u.status === "active");
      expect(activeAfter.length).toBe(0);
    });
  });

  describe("PIDE/state_output handling", () => {
    it("parses the Isabelle XML markup payload via the existing parser", async () => {
      const client = new FakeClient();
      const { updates, handler } = record();
      const session = new LspProofStateSession(client, new CollectingLogger(), handler);
      await flushMicrotasks();
      client.emit(PIDE_STATE_OUTPUT_METHOD, {
        id: 42,
        content:
          "<information_message>Goal: <sendback>by auto</sendback></information_message>",
        auto_update: true
      });
      const last = updates[updates.length - 1];
      expect(last.outputNodes).toEqual([
        {
          kind: "information",
          children: [
            { kind: "text", text: "Goal: " },
            { kind: "sendback", text: "by auto" }
          ]
        }
      ]);
      session.dispose();
    });

    it("replaces, does not append, on successive output snapshots", async () => {
      const client = new FakeClient();
      const { updates, handler } = record();
      const session = new LspProofStateSession(client, new CollectingLogger(), handler);
      await flushMicrotasks();
      client.emit(PIDE_STATE_OUTPUT_METHOD, {
        id: 42,
        content: "<information_message>first</information_message>",
        auto_update: true
      });
      client.emit(PIDE_STATE_OUTPUT_METHOD, {
        id: 42,
        content: "<warning_message>second</warning_message>",
        auto_update: true
      });
      const last = updates[updates.length - 1];
      expect(last.outputNodes).toEqual([
        {
          kind: "warning",
          children: [{ kind: "text", text: "second" }]
        }
      ]);
      session.dispose();
    });

    it("filters output by state_id and ignores notifications for other panels", async () => {
      const client = new FakeClient();
      const { updates, handler } = record();
      const session = new LspProofStateSession(client, new CollectingLogger(), handler);
      await flushMicrotasks();
      const updatesBefore = updates.length;
      client.emit(PIDE_STATE_OUTPUT_METHOD, {
        id: 999, // not our state_id
        content: "<information_message>other</information_message>",
        auto_update: true
      });
      expect(updates.length).toBe(updatesBefore);
      expect(session.getStateId()).toBe(42);
      session.dispose();
    });

    it("reflects the server's auto_update flag into subsequent updates", async () => {
      const client = new FakeClient();
      const { updates, handler } = record();
      const session = new LspProofStateSession(client, new CollectingLogger(), handler);
      await flushMicrotasks();
      client.emit(PIDE_STATE_OUTPUT_METHOD, {
        id: 42,
        content: "<information_message>x</information_message>",
        auto_update: false
      });
      expect(updates[updates.length - 1].autoUpdate).toBe(false);
      expect(session.getAutoUpdate()).toBe(false);
      session.dispose();
    });

    it("ignores malformed output payloads and logs once", async () => {
      const client = new FakeClient();
      const logger = new CollectingLogger();
      const session = new LspProofStateSession(client, logger, () => {});
      await flushMicrotasks();
      client.emit(PIDE_STATE_OUTPUT_METHOD, { id: 42, content: 1, auto_update: true });
      client.emit(PIDE_STATE_OUTPUT_METHOD, { id: 42, content: "x" });
      client.emit(PIDE_STATE_OUTPUT_METHOD, null);
      expect(logger.messages.filter((m) => m.includes("ignored malformed")).length).toBe(3);
      session.dispose();
    });
  });

  describe("client-driven notifications", () => {
    it("sends PIDE/state_update on requestUpdate when active", async () => {
      const client = new FakeClient();
      const session = new LspProofStateSession(client, new CollectingLogger(), () => {});
      await flushMicrotasks();
      session.requestUpdate();
      expect(client.sent).toContainEqual({
        method: PIDE_STATE_UPDATE_METHOD,
        params: { id: 42 }
      });
      session.dispose();
    });

    it("sends PIDE/state_locate on requestLocate when active", async () => {
      const client = new FakeClient();
      const session = new LspProofStateSession(client, new CollectingLogger(), () => {});
      await flushMicrotasks();
      session.requestLocate();
      expect(client.sent).toContainEqual({
        method: PIDE_STATE_LOCATE_METHOD,
        params: { id: 42 }
      });
      session.dispose();
    });

    it("sends PIDE/state_auto_update and reflects the new value immediately", async () => {
      const client = new FakeClient();
      const { updates, handler } = record();
      const session = new LspProofStateSession(client, new CollectingLogger(), handler);
      await flushMicrotasks();
      session.setAutoUpdate(false);
      expect(client.sent).toContainEqual({
        method: PIDE_STATE_AUTO_UPDATE_METHOD,
        params: { id: 42, enabled: false }
      });
      expect(updates[updates.length - 1].autoUpdate).toBe(false);
      expect(session.getAutoUpdate()).toBe(false);
      session.dispose();
    });

    it("sends PIDE/state_set_margin for finite positive margins, rejects others", async () => {
      const client = new FakeClient();
      const session = new LspProofStateSession(client, new CollectingLogger(), () => {});
      await flushMicrotasks();
      session.setMargin(80);
      session.setMargin(0); // rejected
      session.setMargin(-10); // rejected
      session.setMargin(NaN); // rejected
      session.setMargin(Infinity); // rejected
      const marginCalls = client.sent.filter((s) => s.method === PIDE_STATE_SET_MARGIN_METHOD);
      expect(marginCalls).toEqual([
        { method: PIDE_STATE_SET_MARGIN_METHOD, params: { id: 42, margin: 80 } }
      ]);
      session.dispose();
    });

    it("does not send notifications before init completes", () => {
      const client = new FakeClient();
      client.deferRequest = true;
      const session = new LspProofStateSession(client, new CollectingLogger(), () => {});
      session.requestUpdate();
      session.requestLocate();
      session.setAutoUpdate(false);
      session.setMargin(80);
      expect(
        client.sent.filter((s) => s.method !== PIDE_STATE_INIT_METHOD).length
      ).toBe(0);
      session.dispose();
    });

    it("does not send notifications after dispose", async () => {
      const client = new FakeClient();
      const session = new LspProofStateSession(client, new CollectingLogger(), () => {});
      await flushMicrotasks();
      session.dispose();
      const sentBefore = client.sent.length;
      session.requestUpdate();
      session.setAutoUpdate(false);
      session.setMargin(50);
      expect(client.sent.length).toBe(sentBefore);
    });

    it("logs but does not throw when sendNotification throws", async () => {
      const client = new FakeClient();
      const logger = new CollectingLogger();
      const session = new LspProofStateSession(client, logger, () => {});
      await flushMicrotasks();
      client.sendThrowOnce = new Error("transport closed");
      session.requestUpdate();
      expect(logger.messages.some((m) => m.includes("transport closed"))).toBe(true);
      session.dispose();
    });
  });

  describe("dispose", () => {
    it("sends PIDE/state_exit with the captured state_id and releases the output subscription", async () => {
      const client = new FakeClient();
      const session = new LspProofStateSession(client, new CollectingLogger(), () => {});
      await flushMicrotasks();
      expect(client.handlers.get(PIDE_STATE_OUTPUT_METHOD)?.size).toBe(1);
      session.dispose();
      expect(client.sent).toContainEqual({
        method: PIDE_STATE_EXIT_METHOD,
        params: { id: 42 }
      });
      expect(client.handlers.get(PIDE_STATE_OUTPUT_METHOD)?.size ?? 0).toBe(0);
    });

    it("emits a terminal 'stopped' update on the first dispose", async () => {
      const client = new FakeClient();
      const { updates, handler } = record();
      const session = new LspProofStateSession(client, new CollectingLogger(), handler);
      await flushMicrotasks();
      session.dispose();
      expect(updates[updates.length - 1].status).toBe("stopped");
    });

    it("preserves the 'errored' status if dispose runs after a failed init", async () => {
      const client = new FakeClient();
      const { updates, handler } = record();
      client.nextRequestReply = { reject: new Error("boom") };
      const session = new LspProofStateSession(client, new CollectingLogger(), handler);
      await flushMicrotasks();
      expect(session.getStatus()).toBe("errored");
      session.dispose();
      // Last emitted update on dispose should still reflect 'errored',
      // not overwrite it to 'stopped' — losing the error class would
      // hide the cause from the UI.
      expect(updates[updates.length - 1].status).toBe("errored");
    });

    it("dispose is idempotent (no extra exit notification)", async () => {
      const client = new FakeClient();
      const session = new LspProofStateSession(client, new CollectingLogger(), () => {});
      await flushMicrotasks();
      session.dispose();
      const exitCountAfterFirst = client.sent.filter((s) => s.method === PIDE_STATE_EXIT_METHOD).length;
      expect(() => session.dispose()).not.toThrow();
      expect(client.sent.filter((s) => s.method === PIDE_STATE_EXIT_METHOD).length).toBe(exitCountAfterFirst);
    });

    it("never sends PIDE/state_exit when init failed (no state_id was captured)", async () => {
      const client = new FakeClient();
      client.nextRequestReply = { reject: new Error("boom") };
      const session = new LspProofStateSession(client, new CollectingLogger(), () => {});
      await flushMicrotasks();
      session.dispose();
      expect(client.sent.filter((s) => s.method === PIDE_STATE_EXIT_METHOD).length).toBe(0);
    });

    it("logs but does not throw when sendNotification throws on the exit path", async () => {
      const client = new FakeClient();
      const logger = new CollectingLogger();
      const session = new LspProofStateSession(client, logger, () => {});
      await flushMicrotasks();
      client.sendThrowOnce = new Error("transport gone");
      expect(() => session.dispose()).not.toThrow();
      expect(logger.messages.some((m) => m.includes("transport gone"))).toBe(true);
    });
  });

  describe("error resilience", () => {
    it("logs but does not throw when the onUpdate handler throws", async () => {
      const client = new FakeClient();
      const logger = new CollectingLogger();
      const session = new LspProofStateSession(client, logger, () => {
        throw new Error("UI broke");
      });
      await flushMicrotasks();
      expect(logger.messages.some((m) => m.includes("UI broke"))).toBe(true);
      session.dispose();
    });
  });
});
