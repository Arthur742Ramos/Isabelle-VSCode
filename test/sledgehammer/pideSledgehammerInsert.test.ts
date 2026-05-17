import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SessionClient,
  SessionDisposable
} from "../../src/sledgehammer/LspSledgehammerSession";
import {
  PIDE_SLEDGEHAMMER_INSERT_METHOD,
  PIDE_SLEDGEHAMMER_SENDBACK_METHOD,
  requestPideInsert,
  validatePideInsertPayload
} from "../../src/sledgehammer/pideSledgehammerInsert";

class FakeClient implements SessionClient {
  public readonly sent: { method: string; params: unknown }[] = [];
  public readonly handlers = new Map<string, Set<(params: unknown) => void>>();
  public sendThrowOnce: Error | undefined;
  public subscribeThrowOnce: Error | undefined;

  public sendNotification(method: string, params?: unknown): void {
    if (this.sendThrowOnce) {
      const err = this.sendThrowOnce;
      this.sendThrowOnce = undefined;
      throw err;
    }
    this.sent.push({ method, params });
  }

  public onNotification(
    method: string,
    handler: (params: unknown) => void
  ): SessionDisposable {
    if (this.subscribeThrowOnce) {
      const err = this.subscribeThrowOnce;
      this.subscribeThrowOnce = undefined;
      throw err;
    }
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

const URI = "file:///workspace/Demo.thy";

describe("validatePideInsertPayload", () => {
  it("accepts a well-formed payload with the expected URI", () => {
    const result = validatePideInsertPayload(
      { uri: URI, line: 5, character: 4, text: "by auto" },
      URI
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload).toEqual({
        uri: URI,
        line: 5,
        character: 4,
        text: "by auto"
      });
    }
  });

  it("accepts zero-based positions at the document origin", () => {
    const result = validatePideInsertPayload(
      { uri: URI, line: 0, character: 0, text: "" },
      URI
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a payload that is not an object", () => {
    for (const value of [null, undefined, "", 42, []]) {
      const result = validatePideInsertPayload(value, URI);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toMatch(/Malformed/);
      }
    }
  });

  it("rejects a payload missing any required field or with the wrong type", () => {
    const cases: unknown[] = [
      { uri: URI, line: 0, character: 0 }, // missing text
      { uri: URI, line: 0, text: "" }, // missing character
      { uri: URI, character: 0, text: "" }, // missing line
      { line: 0, character: 0, text: "" }, // missing uri
      { uri: URI, line: "0", character: 0, text: "" }, // line as string
      { uri: URI, line: 0, character: "0", text: "" }, // character as string
      { uri: 42, line: 0, character: 0, text: "" } // uri as number
    ];
    for (const value of cases) {
      const result = validatePideInsertPayload(value, URI);
      expect(result.ok).toBe(false);
    }
  });

  it("rejects a URI mismatch with a descriptive reason", () => {
    const result = validatePideInsertPayload(
      { uri: "file:///different.thy", line: 0, character: 0, text: "" },
      URI
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/URI mismatch/);
      expect(result.reason).toContain(URI);
      expect(result.reason).toContain("file:///different.thy");
    }
  });

  it("rejects negative or non-integer positions", () => {
    const cases: { line: number; character: number }[] = [
      { line: -1, character: 0 },
      { line: 0, character: -1 },
      { line: 1.5, character: 0 },
      { line: 0, character: 2.7 }
    ];
    for (const { line, character } of cases) {
      const result = validatePideInsertPayload(
        { uri: URI, line, character, text: "" },
        URI
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toMatch(/Invalid position/);
      }
    }
  });

  it("rejects non-finite positions (NaN, Infinity)", () => {
    for (const value of [
      { uri: URI, line: NaN, character: 0, text: "" },
      { uri: URI, line: 0, character: Infinity, text: "" }
    ]) {
      const result = validatePideInsertPayload(value, URI);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toMatch(/Non-finite/);
      }
    }
  });
});

describe("requestPideInsert", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("subscribes to PIDE/sledgehammer_insert before sending the sendback", () => {
    // Capture the order of operations: subscribe must happen first so
    // we don't miss a synchronous reply (rare in practice but the
    // upstream notification stream is serial and we have no
    // correlation id to retry on).
    const client = new FakeClient();
    const sequence: string[] = [];

    const originalSubscribe = client.onNotification.bind(client);
    const originalSend = client.sendNotification.bind(client);
    client.onNotification = (method, handler) => {
      sequence.push(`subscribe:${method}`);
      return originalSubscribe(method, handler);
    };
    client.sendNotification = (method, params) => {
      sequence.push(`send:${method}`);
      originalSend(method, params);
    };

    void requestPideInsert(client, "by auto", { uri: URI });
    expect(sequence).toEqual([
      `subscribe:${PIDE_SLEDGEHAMMER_INSERT_METHOD}`,
      `send:${PIDE_SLEDGEHAMMER_SENDBACK_METHOD}`
    ]);
  });

  it("sends PIDE/sledgehammer_sendback with the proof text payload", () => {
    const client = new FakeClient();
    void requestPideInsert(client, "by (auto simp: foo)", { uri: URI });
    expect(client.sent).toEqual([
      {
        method: PIDE_SLEDGEHAMMER_SENDBACK_METHOD,
        params: { text: "by (auto simp: foo)" }
      }
    ]);
  });

  it("resolves with the validated payload when the server replies", async () => {
    const client = new FakeClient();
    const promise = requestPideInsert(client, "by auto", { uri: URI });
    client.emit(PIDE_SLEDGEHAMMER_INSERT_METHOD, {
      uri: URI,
      line: 5,
      character: 4,
      text: "by auto"
    });
    const result = await promise;
    expect(result).toEqual({
      ok: true,
      payload: { uri: URI, line: 5, character: 4, text: "by auto" }
    });
  });

  it("releases the subscription after resolving", async () => {
    const client = new FakeClient();
    const promise = requestPideInsert(client, "by auto", { uri: URI });
    expect(client.handlers.get(PIDE_SLEDGEHAMMER_INSERT_METHOD)?.size).toBe(1);
    client.emit(PIDE_SLEDGEHAMMER_INSERT_METHOD, {
      uri: URI,
      line: 0,
      character: 0,
      text: ""
    });
    await promise;
    expect(client.handlers.get(PIDE_SLEDGEHAMMER_INSERT_METHOD)?.size ?? 0).toBe(0);
  });

  it("times out after timeoutMs when the server never replies", async () => {
    const client = new FakeClient();
    const promise = requestPideInsert(client, "by auto", {
      uri: URI,
      timeoutMs: 1000
    });
    vi.advanceTimersByTime(1000);
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/Timed out/);
      expect(result.reason).toContain("1000");
    }
    expect(client.handlers.get(PIDE_SLEDGEHAMMER_INSERT_METHOD)?.size ?? 0).toBe(0);
  });

  it("uses the default 5000 ms timeout when not specified", async () => {
    const client = new FakeClient();
    const promise = requestPideInsert(client, "by auto", { uri: URI });
    vi.advanceTimersByTime(4999);
    // Not yet timed out.
    let settled = false;
    promise.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    vi.advanceTimersByTime(1);
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("5000");
    }
  });

  it("waits past a malformed reply and eventually times out (no correlation id)", async () => {
    const client = new FakeClient();
    const promise = requestPideInsert(client, "by auto", {
      uri: URI,
      timeoutMs: 1000
    });
    // Emit a stray malformed reply — the helper drops it but keeps
    // listening, matching the upstream single-slot semantics where
    // there's no way to tell whose reply this was.
    client.emit(PIDE_SLEDGEHAMMER_INSERT_METHOD, { uri: URI, line: -1, character: 0, text: "" });
    client.emit(PIDE_SLEDGEHAMMER_INSERT_METHOD, "totally bogus");
    vi.advanceTimersByTime(1000);
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/Timed out/);
    }
  });

  it("accepts a valid reply that arrives after one malformed one", async () => {
    const client = new FakeClient();
    const promise = requestPideInsert(client, "by auto", {
      uri: URI,
      timeoutMs: 1000
    });
    client.emit(PIDE_SLEDGEHAMMER_INSERT_METHOD, { wrong: "shape" });
    client.emit(PIDE_SLEDGEHAMMER_INSERT_METHOD, {
      uri: URI,
      line: 7,
      character: 0,
      text: "by blast"
    });
    const result = await promise;
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.text).toBe("by blast");
    }
  });

  it("returns a typed failure when sendNotification throws", async () => {
    const client = new FakeClient();
    client.sendThrowOnce = new Error("transport closed");
    const result = await requestPideInsert(client, "by auto", {
      uri: URI,
      timeoutMs: 1000
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/Failed to send/);
      expect(result.reason).toMatch(/transport closed/);
    }
  });

  it("returns a typed failure when onNotification throws on subscribe", async () => {
    const client = new FakeClient();
    client.subscribeThrowOnce = new Error("registry full");
    const result = await requestPideInsert(client, "by auto", {
      uri: URI,
      timeoutMs: 1000
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/Failed to subscribe/);
      expect(result.reason).toMatch(/registry full/);
    }
  });
});
