import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PIDE_ABBREVS_REQUEST_METHOD,
  PIDE_ABBREVS_RESPONSE_METHOD,
  PideAbbrevsCache,
  PideAbbrevsClient,
  PideAbbrevsLogger,
  computeTriggerCharacters,
  findPideAbbrevPrefixMatch,
  parsePideAbbrevsResponse
} from "../../src/semantic/PideAbbrevsCache";
import {
  IsabelleLanguageServerState,
  IsabelleLanguageServerStatus
} from "../../src/lsp/lspTypes";

interface StubDisposable {
  dispose(): void;
}

class StubClient implements PideAbbrevsClient {
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
        this.notificationHandlers.set(
          method,
          current.filter((h) => h !== handler)
        );
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
    for (const handler of this.notificationHandlers.get(PIDE_ABBREVS_RESPONSE_METHOD) ?? []) {
      handler(params);
    }
  }

  public emitStatus(state: IsabelleLanguageServerState): void {
    this.currentStatus = { state };
    for (const handler of this.statusListeners) handler(this.currentStatus);
  }
}

class StubLogger implements PideAbbrevsLogger {
  public lines: string[] = [];
  public appendLine(message: string): void {
    this.lines.push(message);
  }
}

describe("parsePideAbbrevsResponse", () => {
  it("parses a well-formed list of pairs", () => {
    const parsed = parsePideAbbrevsResponse({
      abbrevs: [
        ["\\<lambda>", "λ"],
        ["==>", "⟹"],
        ["[|", "⟦"]
      ]
    });
    expect(parsed).toHaveLength(3);
    expect(parsed?.[0]).toEqual({ abbrev: "\\<lambda>", expansion: "λ" });
  });

  it("dedupes by abbreviation, last-write-wins", () => {
    const parsed = parsePideAbbrevsResponse({
      abbrevs: [
        ["\\<lambda>", "old"],
        ["\\<lambda>", "λ"]
      ]
    });
    expect(parsed).toHaveLength(1);
    expect(parsed?.[0].expansion).toBe("λ");
  });

  it("rejects payloads with non-array abbrevs", () => {
    expect(parsePideAbbrevsResponse({ abbrevs: "nope" })).toBeUndefined();
    expect(parsePideAbbrevsResponse(null)).toBeUndefined();
    expect(parsePideAbbrevsResponse(42)).toBeUndefined();
  });

  it("drops malformed entries within a well-formed list", () => {
    const parsed = parsePideAbbrevsResponse({
      abbrevs: [
        ["a", "α"],
        ["b"],
        [3, "c"],
        ["d", 4],
        ["", "empty"],
        ["e", ""],
        ["f", "φ"]
      ]
    });
    expect(parsed?.map((e) => e.abbrev).sort()).toEqual(["a", "f"]);
  });

  it("returns empty array for an empty abbrevs list", () => {
    expect(parsePideAbbrevsResponse({ abbrevs: [] })).toEqual([]);
  });
});

describe("computeTriggerCharacters", () => {
  it("returns the sorted set of leading characters", () => {
    const triggers = computeTriggerCharacters([
      { abbrev: "\\<lambda>", expansion: "λ" },
      { abbrev: "==>", expansion: "⟹" },
      { abbrev: "[|", expansion: "⟦" },
      { abbrev: "=>", expansion: "⇒" }
    ]);
    expect(triggers).toEqual(["=", "[", "\\"]);
  });

  it("returns empty for an empty list", () => {
    expect(computeTriggerCharacters([])).toEqual([]);
  });

  it("dedupes characters", () => {
    const triggers = computeTriggerCharacters([
      { abbrev: "==>", expansion: "⟹" },
      { abbrev: "=>", expansion: "⇒" },
      { abbrev: "===", expansion: "≡" }
    ]);
    expect(triggers).toEqual(["="]);
  });
});

describe("findPideAbbrevPrefixMatch", () => {
  const ABBREVS = [
    { abbrev: "\\<lambda>", expansion: "λ" },
    { abbrev: "\\<forall>", expansion: "∀" },
    { abbrev: "\\<exists>", expansion: "∃" },
    { abbrev: "==>", expansion: "⟹" },
    { abbrev: "=>", expansion: "⇒" },
    { abbrev: "<=>", expansion: "⟷" }
  ];

  it("returns no match when abbrevs are empty", () => {
    expect(findPideAbbrevPrefixMatch([], "==>", 3)).toBeUndefined();
  });

  it("returns no match when cursor is at start of line", () => {
    expect(findPideAbbrevPrefixMatch(ABBREVS, "==>", 0)).toBeUndefined();
  });

  it("returns no match when the character before the cursor is whitespace", () => {
    expect(findPideAbbrevPrefixMatch(ABBREVS, " ==> ", 5)).toBeUndefined();
  });

  it("matches the longest prefix that starts at least one abbreviation", () => {
    const match = findPideAbbrevPrefixMatch(ABBREVS, "==>", 3);
    expect(match).toBeDefined();
    expect(match?.prefix).toBe("==>");
    expect(match?.start).toBe(0);
    expect(match?.matches.map((e) => e.expansion)).toEqual(["⟹"]);
  });

  it("matches a partial prefix that begins multiple abbreviations", () => {
    const match = findPideAbbrevPrefixMatch(ABBREVS, "==", 2);
    expect(match?.prefix).toBe("==");
    expect(match?.matches.map((e) => e.abbrev).sort()).toEqual(["==>"]);
  });

  it("matches the longest backward prefix within a longer line", () => {
    const line = "  thm foo by ==>";
    const match = findPideAbbrevPrefixMatch(ABBREVS, line, line.length);
    expect(match?.prefix).toBe("==>");
    expect(match?.start).toBe(line.length - 3);
  });

  it("includes the lambda abbreviation when matching \\<lam", () => {
    const line = "lemma foo: \\<lam";
    const match = findPideAbbrevPrefixMatch(ABBREVS, line, line.length);
    expect(match?.prefix).toBe("\\<lam");
    expect(match?.matches.map((e) => e.abbrev)).toContain("\\<lambda>");
  });

  it("returns undefined when the typed prefix matches no abbreviation", () => {
    expect(findPideAbbrevPrefixMatch(ABBREVS, "xyz", 3)).toBeUndefined();
  });

  it("returns multiple matches when several abbreviations share the prefix", () => {
    const match = findPideAbbrevPrefixMatch(ABBREVS, "\\<", 2);
    const abbrevs = match?.matches.map((e) => e.abbrev).sort();
    expect(abbrevs).toEqual(["\\<exists>", "\\<forall>", "\\<lambda>"]);
  });
});

describe("PideAbbrevsCache lifecycle", () => {
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
    const cache = new PideAbbrevsCache(client, logger, fixedClock);
    expect(client.statusListeners).toHaveLength(1);
    expect(client.notificationHandlers.get(PIDE_ABBREVS_RESPONSE_METHOD)).toHaveLength(1);
    cache.dispose();
  });

  it("dispatches the request immediately when the LSP is already running at construction time", () => {
    client.currentStatus = { state: "running" };
    const cache = new PideAbbrevsCache(client, logger, fixedClock);
    expect(client.sentNotifications.map((n) => n.method)).toEqual([
      PIDE_ABBREVS_REQUEST_METHOD
    ]);
    cache.dispose();
  });

  it("dispatches the request on the running transition, not on subsequent unrelated transitions", () => {
    const cache = new PideAbbrevsCache(client, logger, fixedClock);
    client.emitStatus("starting");
    client.emitStatus("running");
    client.emitStatus("running"); // duplicate, no extra dispatch
    expect(
      client.sentNotifications.filter((n) => n.method === PIDE_ABBREVS_REQUEST_METHOD)
    ).toHaveLength(1);
    cache.dispose();
  });

  it("populates the cache when a well-formed response arrives", () => {
    const cache = new PideAbbrevsCache(client, logger, fixedClock);
    client.emitResponse({
      abbrevs: [
        ["\\<lambda>", "λ"],
        ["==>", "⟹"]
      ]
    });
    expect(cache.hasCachedAbbrevs()).toBe(true);
    expect(cache.getAbbrevs()).toHaveLength(2);
    expect(cache.getTriggerCharacters().sort()).toEqual(["=", "\\"]);
    expect(cache.getLastUpdatedAt()).toBe("2026-05-17T00:00:00.000Z");
    cache.dispose();
  });

  it("clears the cache on stopping / failed / disabled transitions", () => {
    const cache = new PideAbbrevsCache(client, logger, fixedClock);
    client.emitResponse({ abbrevs: [["a", "α"]] });
    expect(cache.hasCachedAbbrevs()).toBe(true);
    client.emitStatus("failed");
    expect(cache.hasCachedAbbrevs()).toBe(false);
    expect(cache.getTriggerCharacters()).toEqual([]);
    cache.dispose();
  });

  it("notifies onDidUpdate listeners on response and on cache-clearing transitions", () => {
    const cache = new PideAbbrevsCache(client, logger, fixedClock);
    const updates: number[] = [];
    cache.onDidUpdate(() => updates.push(cache.getAbbrevs().length));
    client.emitResponse({ abbrevs: [["a", "α"]] });
    client.emitStatus("running");
    client.emitStatus("failed");
    expect(updates).toEqual([1, 0]);
    cache.dispose();
  });

  it("does NOT fire onDidUpdate when an already-empty cache transitions away from running", () => {
    const cache = new PideAbbrevsCache(client, logger, fixedClock);
    const updates: number[] = [];
    cache.onDidUpdate(() => updates.push(cache.getAbbrevs().length));
    client.emitStatus("failed");
    expect(updates).toEqual([]);
    cache.dispose();
  });

  it("logs malformed responses without throwing or polluting the cache", () => {
    const cache = new PideAbbrevsCache(client, logger, fixedClock);
    client.emitResponse({ abbrevs: "not an array" });
    expect(cache.hasCachedAbbrevs()).toBe(false);
    expect(logger.lines.some((l) => l.includes("ignored malformed"))).toBe(true);
    cache.dispose();
  });

  it("ignores notifications after dispose", () => {
    const cache = new PideAbbrevsCache(client, logger, fixedClock);
    cache.dispose();
    client.emitResponse({ abbrevs: [["a", "α"]] });
    expect(cache.getAbbrevs()).toEqual([]);
    expect(client.notificationHandlers.get(PIDE_ABBREVS_RESPONSE_METHOD)).toEqual([]);
  });
});
