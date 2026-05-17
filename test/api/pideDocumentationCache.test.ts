import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PIDE_DOCUMENTATION_REQUEST_METHOD,
  PIDE_DOCUMENTATION_RESPONSE_METHOD,
  PideDocumentationCache,
  PideDocumentationClient,
  PideDocumentationLogger,
  flattenDocumentationForQuickPick,
  parsePideDocumentationResponse,
  stripHtml
} from "../../src/api/PideDocumentationCache";
import {
  IsabelleLanguageServerState,
  IsabelleLanguageServerStatus
} from "../../src/lsp/lspTypes";

interface StubDisposable {
  dispose(): void;
}

class StubClient implements PideDocumentationClient {
  public sentNotifications: { method: string; params?: unknown }[] = [];
  public notificationHandlers = new Map<string, ((params: unknown) => void)[]>();
  public statusListeners: ((status: IsabelleLanguageServerStatus) => void)[] = [];
  public currentStatus: IsabelleLanguageServerStatus = { state: "disabled" };

  public sendNotification(method: string, params?: unknown): void {
    this.sentNotifications.push({ method, params });
  }

  public onNotification(
    method: string,
    handler: (params: unknown) => void
  ): StubDisposable {
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

  public onStatusChange(
    handler: (status: IsabelleLanguageServerStatus) => void
  ): StubDisposable {
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
    for (const handler of this.notificationHandlers.get(PIDE_DOCUMENTATION_RESPONSE_METHOD) ?? []) {
      handler(params);
    }
  }

  public emitStatus(state: IsabelleLanguageServerState): void {
    this.currentStatus = { state };
    for (const handler of this.statusListeners) handler(this.currentStatus);
  }
}

class StubLogger implements PideDocumentationLogger {
  public lines: string[] = [];
  public appendLine(message: string): void {
    this.lines.push(message);
  }
}

describe("stripHtml", () => {
  it("removes simple tags and decodes basic entities", () => {
    expect(stripHtml("<b>Tutorial</b>")).toBe("Tutorial");
    expect(stripHtml("Isar &amp; Ref &lt;1&gt;")).toBe("Isar & Ref <1>");
  });

  it("preserves text when no tags are present", () => {
    expect(stripHtml("plain text")).toBe("plain text");
  });

  it("handles nested tags", () => {
    expect(stripHtml("<i><b>Sledgehammer</b></i>")).toBe("Sledgehammer");
  });
});

describe("parsePideDocumentationResponse", () => {
  it("parses a well-formed payload", () => {
    const parsed = parsePideDocumentationResponse({
      sections: [
        {
          title: "Tutorials",
          important: true,
          entries: [
            { print_html: "<b>tutorial</b>", platform_path: "/iso/Tutorial.pdf" }
          ]
        },
        {
          title: "References",
          important: false,
          entries: [
            { print_html: "Isar-Ref", platform_path: "/iso/Isar-Ref.pdf" },
            { print_html: "Sledgehammer", platform_path: "/iso/Sledgehammer.pdf" }
          ]
        }
      ]
    });
    expect(parsed).toHaveLength(2);
    expect(parsed?.[0].important).toBe(true);
    expect(parsed?.[0].entries[0].label).toBe("tutorial");
    expect(parsed?.[1].entries).toHaveLength(2);
  });

  it("rejects malformed top-level shape", () => {
    expect(parsePideDocumentationResponse(null)).toBeUndefined();
    expect(parsePideDocumentationResponse({})).toBeUndefined();
    expect(parsePideDocumentationResponse({ sections: "no" })).toBeUndefined();
  });

  it("drops malformed sections without failing the whole response", () => {
    const parsed = parsePideDocumentationResponse({
      sections: [
        { title: "ok", important: true, entries: [] },
        { title: "", important: false, entries: [] }, // empty title
        { important: true, entries: [] }, // missing title
        null,
        { title: "missing entries", important: false }
      ]
    });
    expect(parsed?.map((s) => s.title)).toEqual(["ok"]);
  });

  it("treats missing `important` as false", () => {
    const parsed = parsePideDocumentationResponse({
      sections: [{ title: "x", entries: [] }]
    });
    expect(parsed?.[0].important).toBe(false);
  });

  it("drops malformed entries within a section", () => {
    const parsed = parsePideDocumentationResponse({
      sections: [
        {
          title: "s",
          important: false,
          entries: [
            { print_html: "ok", platform_path: "/p/ok.pdf" },
            { print_html: "no path" },
            { platform_path: "/p/no-html.pdf" },
            { print_html: "", platform_path: "/p/empty-html.pdf" },
            { print_html: "empty-path", platform_path: "" }
          ]
        }
      ]
    });
    expect(parsed?.[0].entries.map((e) => e.platformPath)).toEqual(["/p/ok.pdf"]);
  });
});

describe("flattenDocumentationForQuickPick", () => {
  it("places important sections first, alphabetised within importance buckets", () => {
    const flattened = flattenDocumentationForQuickPick([
      {
        title: "References",
        important: false,
        entries: [{ label: "Isar-Ref", printHtml: "", platformPath: "/Isar-Ref.pdf" }]
      },
      {
        title: "Tutorials",
        important: true,
        entries: [{ label: "Tutorial", printHtml: "", platformPath: "/Tutorial.pdf" }]
      },
      {
        title: "Apps",
        important: true,
        entries: [{ label: "Sledgehammer", printHtml: "", platformPath: "/Sledge.pdf" }]
      }
    ]);
    expect(flattened.map((e) => e.section)).toEqual(["Apps", "Tutorials", "References"]);
  });

  it("emits one quickpick entry per documentation entry", () => {
    const flattened = flattenDocumentationForQuickPick([
      {
        title: "A",
        important: false,
        entries: [
          { label: "a1", printHtml: "", platformPath: "/a1" },
          { label: "a2", printHtml: "", platformPath: "/a2" }
        ]
      }
    ]);
    expect(flattened.map((e) => e.label)).toEqual(["a1", "a2"]);
  });

  it("returns empty for an empty section list", () => {
    expect(flattenDocumentationForQuickPick([])).toEqual([]);
  });
});

describe("PideDocumentationCache lifecycle", () => {
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

  it("registers a status listener and a response handler on construction", () => {
    const cache = new PideDocumentationCache(client, logger, fixedClock);
    expect(client.statusListeners).toHaveLength(1);
    expect(client.notificationHandlers.get(PIDE_DOCUMENTATION_RESPONSE_METHOD)).toHaveLength(1);
    cache.dispose();
  });

  it("dispatches immediately when LSP is already running at construction", () => {
    client.currentStatus = { state: "running" };
    const cache = new PideDocumentationCache(client, logger, fixedClock);
    expect(client.sentNotifications.map((n) => n.method)).toEqual([
      PIDE_DOCUMENTATION_REQUEST_METHOD
    ]);
    cache.dispose();
  });

  it("dispatches once per running transition, not on duplicate emissions", () => {
    const cache = new PideDocumentationCache(client, logger, fixedClock);
    client.emitStatus("starting");
    client.emitStatus("running");
    client.emitStatus("running");
    expect(
      client.sentNotifications.filter((n) => n.method === PIDE_DOCUMENTATION_REQUEST_METHOD)
    ).toHaveLength(1);
    cache.dispose();
  });

  it("populates the cache and notifies listeners on a well-formed response", () => {
    const cache = new PideDocumentationCache(client, logger, fixedClock);
    const updates: number[] = [];
    cache.onDidUpdate(() => updates.push(cache.getSections().length));
    client.emitResponse({
      sections: [
        { title: "T", important: true, entries: [{ print_html: "x", platform_path: "/x" }] }
      ]
    });
    expect(cache.hasCachedSections()).toBe(true);
    expect(updates).toEqual([1]);
    expect(cache.getLastUpdatedAt()).toBe("2026-05-17T00:00:00.000Z");
    cache.dispose();
  });

  it("clears cache and notifies on stopping / failed / disabled transitions", () => {
    const cache = new PideDocumentationCache(client, logger, fixedClock);
    client.emitResponse({
      sections: [
        { title: "T", important: true, entries: [{ print_html: "x", platform_path: "/x" }] }
      ]
    });
    const updates: number[] = [];
    cache.onDidUpdate(() => updates.push(cache.getSections().length));
    client.emitStatus("failed");
    expect(cache.hasCachedSections()).toBe(false);
    expect(updates).toEqual([0]);
    cache.dispose();
  });

  it("refresh is a no-op when LSP is not running", () => {
    const cache = new PideDocumentationCache(client, logger, fixedClock);
    cache.refresh();
    expect(client.sentNotifications).toEqual([]);
    cache.dispose();
  });

  it("refresh re-sends the request when LSP is running", () => {
    client.currentStatus = { state: "running" };
    const cache = new PideDocumentationCache(client, logger, fixedClock);
    cache.refresh();
    expect(
      client.sentNotifications.filter((n) => n.method === PIDE_DOCUMENTATION_REQUEST_METHOD)
    ).toHaveLength(2); // one on construction + one on refresh
    cache.dispose();
  });

  it("ignores notifications received after dispose", () => {
    const cache = new PideDocumentationCache(client, logger, fixedClock);
    cache.dispose();
    client.emitResponse({
      sections: [{ title: "T", important: true, entries: [] }]
    });
    expect(cache.getSections()).toEqual([]);
  });
});
