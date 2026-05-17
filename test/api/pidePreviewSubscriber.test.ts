import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PIDE_PREVIEW_REQUEST_METHOD,
  PIDE_PREVIEW_RESPONSE_METHOD,
  PidePreviewClient,
  PidePreviewLogger,
  PidePreviewSnapshot,
  PidePreviewSubscriber,
  isEmptyPreviewSnapshot,
  parsePidePreviewResponse
} from "../../src/api/PidePreviewSubscriber";
import {
  IsabelleLanguageServerState,
  IsabelleLanguageServerStatus
} from "../../src/lsp/lspTypes";

interface StubDisposable {
  dispose(): void;
}

class StubClient implements PidePreviewClient {
  public sentNotifications: { method: string; params?: unknown }[] = [];
  public notificationHandlers = new Map<string, ((params: unknown) => void)[]>();
  public statusListeners: ((status: IsabelleLanguageServerStatus) => void)[] = [];
  public currentStatus: IsabelleLanguageServerStatus = { state: "disabled" };
  public sendThrows = false;

  public sendNotification(method: string, params?: unknown): void {
    if (this.sendThrows) throw new Error("send blew up");
    this.sentNotifications.push({ method, params });
  }

  public onNotification(method: string, handler: (params: unknown) => void): StubDisposable {
    const list = this.notificationHandlers.get(method) ?? [];
    list.push(handler);
    this.notificationHandlers.set(method, list);
    return {
      dispose: () => {
        const current = this.notificationHandlers.get(method) ?? [];
        this.notificationHandlers.set(method, current.filter((h) => h !== handler));
      }
    };
  }

  public onStatusChange(handler: (status: IsabelleLanguageServerStatus) => void): StubDisposable {
    this.statusListeners.push(handler);
    return {
      dispose: () => {
        this.statusListeners = this.statusListeners.filter((h) => h !== handler);
      }
    };
  }

  public getStatus(): IsabelleLanguageServerStatus {
    return this.currentStatus;
  }

  public emitResponse(params: unknown): void {
    for (const handler of this.notificationHandlers.get(PIDE_PREVIEW_RESPONSE_METHOD) ?? []) {
      handler(params);
    }
  }

  public emitStatus(state: IsabelleLanguageServerState): void {
    this.currentStatus = { state };
    for (const handler of this.statusListeners) handler(this.currentStatus);
  }
}

class StubLogger implements PidePreviewLogger {
  public lines: string[] = [];
  public appendLine(message: string): void {
    this.lines.push(message);
  }
}

describe("parsePidePreviewResponse", () => {
  const at = new Date("2026-05-17T00:00:00.000Z");

  it("parses a well-formed payload", () => {
    const parsed = parsePidePreviewResponse(
      { uri: "file:///abs/Foo.thy", column: 2, label: "Foo", content: "<p>hi</p>" },
      at
    );
    expect(parsed).toEqual({
      uri: "file:///abs/Foo.thy",
      column: 2,
      label: "Foo",
      content: "<p>hi</p>",
      receivedAt: "2026-05-17T00:00:00.000Z"
    });
  });

  it("rejects payloads missing required string fields", () => {
    expect(parsePidePreviewResponse({ column: 1, label: "L", content: "" }, at)).toBeUndefined();
    expect(parsePidePreviewResponse({ uri: "", column: 1, label: "L", content: "" }, at)).toBeUndefined();
    expect(parsePidePreviewResponse({ uri: "u", column: 1, label: 5, content: "" }, at)).toBeUndefined();
    expect(parsePidePreviewResponse({ uri: "u", column: 1, label: "L" }, at)).toBeUndefined();
  });

  it("rejects payloads with non-integer column", () => {
    expect(parsePidePreviewResponse({ uri: "u", column: 1.5, label: "L", content: "" }, at)).toBeUndefined();
    expect(parsePidePreviewResponse({ uri: "u", column: "1", label: "L", content: "" }, at)).toBeUndefined();
    expect(parsePidePreviewResponse({ uri: "u", column: Number.NaN, label: "L", content: "" }, at)).toBeUndefined();
  });

  it("accepts an empty content string", () => {
    const parsed = parsePidePreviewResponse(
      { uri: "u", column: 1, label: "", content: "" },
      at
    );
    expect(parsed).toBeDefined();
    expect(parsed?.content).toBe("");
  });

  it("rejects non-object payloads", () => {
    expect(parsePidePreviewResponse(null, at)).toBeUndefined();
    expect(parsePidePreviewResponse("string", at)).toBeUndefined();
  });
});

describe("isEmptyPreviewSnapshot", () => {
  function snap(content: string): PidePreviewSnapshot {
    return { uri: "u", column: 1, label: "L", content, receivedAt: "" };
  }

  it("returns true for whitespace-only content", () => {
    expect(isEmptyPreviewSnapshot(snap(""))).toBe(true);
    expect(isEmptyPreviewSnapshot(snap("   \n\t"))).toBe(true);
  });

  it("returns true for self-closing body", () => {
    expect(isEmptyPreviewSnapshot(snap("<body/>"))).toBe(true);
    expect(isEmptyPreviewSnapshot(snap("<body />"))).toBe(true);
  });

  it("returns true for empty body element", () => {
    expect(isEmptyPreviewSnapshot(snap("<body></body>"))).toBe(true);
    expect(isEmptyPreviewSnapshot(snap("<body>   </body>"))).toBe(true);
  });

  it("returns false for content with actual HTML", () => {
    expect(isEmptyPreviewSnapshot(snap("<body><h1>theory</h1></body>"))).toBe(false);
    expect(isEmptyPreviewSnapshot(snap("<p>hi</p>"))).toBe(false);
  });

  it("treats comment-only content as empty", () => {
    expect(isEmptyPreviewSnapshot(snap("<!-- nothing here -->"))).toBe(true);
  });
});

describe("PidePreviewSubscriber lifecycle", () => {
  let client: StubClient;
  let logger: StubLogger;
  const fixedClock = () => new Date("2026-05-17T00:00:00.000Z");

  beforeEach(() => {
    client = new StubClient();
    logger = new StubLogger();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a response handler and status listener on construction", () => {
    const sub = new PidePreviewSubscriber(client, logger, fixedClock);
    expect(client.notificationHandlers.get(PIDE_PREVIEW_RESPONSE_METHOD)).toHaveLength(1);
    expect(client.statusListeners).toHaveLength(1);
    sub.dispose();
  });

  it("does NOT auto-dispatch a request on construction (caller-driven)", () => {
    client.currentStatus = { state: "running" };
    const sub = new PidePreviewSubscriber(client, logger, fixedClock);
    expect(client.sentNotifications).toEqual([]);
    sub.dispose();
  });

  it("requestPreview sends the notification when LSP is running", () => {
    client.currentStatus = { state: "running" };
    const sub = new PidePreviewSubscriber(client, logger, fixedClock);
    expect(sub.requestPreview("file:///a/Foo.thy", 2)).toBe(true);
    expect(client.sentNotifications).toEqual([
      { method: PIDE_PREVIEW_REQUEST_METHOD, params: { uri: "file:///a/Foo.thy", column: 2 } }
    ]);
    sub.dispose();
  });

  it("requestPreview is a no-op when LSP is not running", () => {
    const sub = new PidePreviewSubscriber(client, logger, fixedClock);
    expect(sub.requestPreview("file:///a", 1)).toBe(false);
    expect(client.sentNotifications).toEqual([]);
    sub.dispose();
  });

  it("requestPreview returns false and logs when sendNotification throws", () => {
    client.currentStatus = { state: "running" };
    client.sendThrows = true;
    const sub = new PidePreviewSubscriber(client, logger, fixedClock);
    expect(sub.requestPreview("u", 1)).toBe(false);
    expect(logger.lines.some((l) => l.includes("failed to send"))).toBe(true);
    sub.dispose();
  });

  it("caches the latest snapshot and notifies subscribers", () => {
    client.currentStatus = { state: "running" };
    const sub = new PidePreviewSubscriber(client, logger, fixedClock);
    const received: PidePreviewSnapshot[] = [];
    sub.onSnapshot((s) => received.push(s));
    client.emitResponse({ uri: "u", column: 2, label: "Foo", content: "<p>hi</p>" });
    expect(received).toHaveLength(1);
    expect(sub.getLatest()?.label).toBe("Foo");
    sub.dispose();
  });

  it("ignores malformed responses and logs", () => {
    const sub = new PidePreviewSubscriber(client, logger, fixedClock);
    client.emitResponse({ uri: "u", column: "no", label: "L", content: "" });
    expect(sub.getLatest()).toBeUndefined();
    expect(logger.lines.some((l) => l.includes("ignored malformed"))).toBe(true);
    sub.dispose();
  });

  it("clears cached snapshot on stopping / failed / disabled transitions", () => {
    client.currentStatus = { state: "running" };
    const sub = new PidePreviewSubscriber(client, logger, fixedClock);
    client.emitResponse({ uri: "u", column: 1, label: "L", content: "<p>x</p>" });
    expect(sub.getLatest()).toBeDefined();
    client.emitStatus("failed");
    expect(sub.getLatest()).toBeUndefined();
    sub.dispose();
  });

  it("listener errors are caught and logged without breaking other listeners", () => {
    client.currentStatus = { state: "running" };
    const sub = new PidePreviewSubscriber(client, logger, fixedClock);
    const reached: string[] = [];
    sub.onSnapshot(() => {
      throw new Error("boom");
    });
    sub.onSnapshot((s) => reached.push(s.label));
    client.emitResponse({ uri: "u", column: 1, label: "Foo", content: "<p>x</p>" });
    expect(reached).toEqual(["Foo"]);
    expect(logger.lines.some((l) => l.includes("snapshot listener threw"))).toBe(true);
    sub.dispose();
  });

  it("dispose unwires both subscriptions and clears listener set", () => {
    const sub = new PidePreviewSubscriber(client, logger, fixedClock);
    sub.onSnapshot(() => {});
    sub.dispose();
    expect(client.notificationHandlers.get(PIDE_PREVIEW_RESPONSE_METHOD)).toEqual([]);
    expect(client.statusListeners).toEqual([]);
    client.emitResponse({ uri: "u", column: 1, label: "L", content: "<p>x</p>" });
    expect(sub.getLatest()).toBeUndefined();
  });
});
