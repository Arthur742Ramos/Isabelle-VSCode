import { describe, expect, it } from "vitest";
import {
  DynamicOutputClient,
  DynamicOutputDisposable,
  DynamicOutputLogger,
  DynamicOutputUpdate,
  DynamicOutputUpdateHandler,
  PIDE_DYNAMIC_OUTPUT_METHOD,
  PideDynamicOutputSession
} from "../../src/proof/PideDynamicOutputSession";

class FakeClient implements DynamicOutputClient {
  public handlers = new Map<string, Set<(params: unknown) => void>>();

  public onNotification(
    method: string,
    handler: (params: unknown) => void
  ): DynamicOutputDisposable {
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

class CollectingLogger implements DynamicOutputLogger {
  public readonly messages: string[] = [];
  public appendLine(message: string): void {
    this.messages.push(message);
  }
}

function record(): {
  updates: DynamicOutputUpdate[];
  handler: DynamicOutputUpdateHandler;
} {
  const updates: DynamicOutputUpdate[] = [];
  return {
    updates,
    handler: (update) => {
      updates.push(update);
    }
  };
}

describe("PideDynamicOutputSession", () => {
  it("subscribes to PIDE/dynamic_output on construction", () => {
    const client = new FakeClient();
    const session = new PideDynamicOutputSession(client, new CollectingLogger(), () => {});
    expect(client.handlers.get(PIDE_DYNAMIC_OUTPUT_METHOD)?.size).toBe(1);
    session.dispose();
  });

  it("emits an initial empty update synchronously", () => {
    const client = new FakeClient();
    const { updates, handler } = record();
    const session = new PideDynamicOutputSession(client, new CollectingLogger(), handler);
    expect(updates).toHaveLength(1);
    expect(updates[0].outputNodes).toEqual([]);
    expect(updates[0].lastReceivedAt).toBeUndefined();
    session.dispose();
  });

  it("parses an inbound payload through the shared PIDE XML parser", () => {
    const client = new FakeClient();
    const { updates, handler } = record();
    const session = new PideDynamicOutputSession(
      client,
      new CollectingLogger(),
      handler,
      () => new Date("2026-05-17T12:00:00.000Z")
    );
    client.emit(PIDE_DYNAMIC_OUTPUT_METHOD, {
      content: "<information_message>cursor: <sendback>by auto</sendback></information_message>"
    });
    const last = updates[updates.length - 1];
    expect(last.outputNodes).toEqual([
      {
        kind: "information",
        children: [
          { kind: "text", text: "cursor: " },
          { kind: "sendback", text: "by auto" }
        ]
      }
    ]);
    expect(last.lastReceivedAt).toBe("2026-05-17T12:00:00.000Z");
    expect(session.getOutputNodes()).toEqual(last.outputNodes);
    expect(session.getLastReceivedAt()).toBe("2026-05-17T12:00:00.000Z");
    session.dispose();
  });

  it("replaces, does not append, on successive snapshots", () => {
    // Matching the state_output and sledgehammer_output semantics —
    // the upstream is single-slot caret-driven, each notification
    // carries the latest cumulative content.
    const client = new FakeClient();
    const { updates, handler } = record();
    const session = new PideDynamicOutputSession(client, new CollectingLogger(), handler);
    client.emit(PIDE_DYNAMIC_OUTPUT_METHOD, {
      content: "<information_message>first</information_message>"
    });
    client.emit(PIDE_DYNAMIC_OUTPUT_METHOD, {
      content: "<warning_message>second</warning_message>"
    });
    const last = updates[updates.length - 1];
    expect(last.outputNodes).toEqual([
      { kind: "warning", children: [{ kind: "text", text: "second" }] }
    ]);
    session.dispose();
  });

  it("ignores empty-content payloads gracefully (parser yields no nodes)", () => {
    const client = new FakeClient();
    const { updates, handler } = record();
    const session = new PideDynamicOutputSession(client, new CollectingLogger(), handler);
    client.emit(PIDE_DYNAMIC_OUTPUT_METHOD, { content: "" });
    const last = updates[updates.length - 1];
    expect(last.outputNodes).toEqual([]);
    // lastReceivedAt is set even for empty content — the notification did arrive.
    expect(last.lastReceivedAt).toBeDefined();
    session.dispose();
  });

  it("ignores malformed payloads and logs once per drop", () => {
    const client = new FakeClient();
    const logger = new CollectingLogger();
    const { updates, handler } = record();
    const session = new PideDynamicOutputSession(client, logger, handler);
    const baseline = updates.length;
    client.emit(PIDE_DYNAMIC_OUTPUT_METHOD, { content: 42 });
    client.emit(PIDE_DYNAMIC_OUTPUT_METHOD, null);
    client.emit(PIDE_DYNAMIC_OUTPUT_METHOD, undefined);
    client.emit(PIDE_DYNAMIC_OUTPUT_METHOD, {});
    expect(updates.length).toBe(baseline);
    expect(logger.messages.filter((m) => m.includes("ignored malformed")).length).toBe(4);
    expect(session.getOutputNodes()).toEqual([]);
    session.dispose();
  });

  it("releases its subscription on dispose and ignores subsequent emissions", () => {
    const client = new FakeClient();
    const { updates, handler } = record();
    const session = new PideDynamicOutputSession(client, new CollectingLogger(), handler);
    expect(client.handlers.get(PIDE_DYNAMIC_OUTPUT_METHOD)?.size).toBe(1);
    session.dispose();
    expect(client.handlers.get(PIDE_DYNAMIC_OUTPUT_METHOD)?.size ?? 0).toBe(0);
    const lengthAfterDispose = updates.length;
    // Re-subscribe directly to confirm the session itself does not
    // re-add the handler if a stale emit somehow reaches us.
    client.emit(PIDE_DYNAMIC_OUTPUT_METHOD, { content: "<information_message>x</information_message>" });
    expect(updates.length).toBe(lengthAfterDispose);
  });

  it("dispose is idempotent", () => {
    const client = new FakeClient();
    const session = new PideDynamicOutputSession(client, new CollectingLogger(), () => {});
    session.dispose();
    expect(() => session.dispose()).not.toThrow();
  });

  it("logs but does not throw when the onUpdate handler throws", () => {
    const client = new FakeClient();
    const logger = new CollectingLogger();
    const session = new PideDynamicOutputSession(client, logger, () => {
      throw new Error("UI broke");
    });
    expect(logger.messages.some((m) => m.includes("UI broke"))).toBe(true);
    expect(() =>
      client.emit(PIDE_DYNAMIC_OUTPUT_METHOD, {
        content: "<information_message>x</information_message>"
      })
    ).not.toThrow();
    // Two throws now logged (initial emit + the notification emit).
    expect(logger.messages.filter((m) => m.includes("UI broke")).length).toBeGreaterThanOrEqual(2);
    session.dispose();
  });
});
