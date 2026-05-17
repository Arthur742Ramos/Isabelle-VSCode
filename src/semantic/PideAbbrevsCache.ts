// Cache for the Isabelle symbol abbreviation table reported by
// `isabelle vscode_server` over the upstream `PIDE/abbrevs_response`
// LSP notification.
//
// Background (`mirror-isabelle@ce22e9ea` `src/Tools/VSCode/src/lsp.scala:697-701`):
//
//   client -> server: PIDE/abbrevs_request      (notification, no params)
//   server -> client: PIDE/abbrevs_response
//                     { abbrevs: [[abbrev, expansion], ...] }
//
// Each pair maps a user-typed token (e.g. `\<lambda>`, `==>`, `[|`) to
// the Isabelle symbol the user really wants (e.g. `λ`, `⟹`, `⟦`).
// The list is large (~hundreds of entries) and rarely changes; we
// build it once per LSP `running` transition and let the completion
// provider consult it synchronously.
//
// This module is `vscode`-free: it takes injectable client + logger
// shapes that the production `IsabelleLanguageClient` already
// satisfies structurally. Tests pass small in-memory stubs.

import {
  IsabelleLanguageServerState,
  IsabelleLanguageServerStatus
} from "../lsp/lspTypes";

export const PIDE_ABBREVS_REQUEST_METHOD = "PIDE/abbrevs_request";
export const PIDE_ABBREVS_RESPONSE_METHOD = "PIDE/abbrevs_response";

export interface PideAbbrevsDisposable {
  dispose(): void;
}

export interface PideAbbrevsLogger {
  appendLine(message: string): void;
}

export interface PideAbbrevsClient {
  sendNotification(method: string, params?: unknown): void;
  onNotification(
    method: string,
    handler: (params: unknown) => void
  ): PideAbbrevsDisposable;
  onStatusChange(
    handler: (status: IsabelleLanguageServerStatus) => void
  ): PideAbbrevsDisposable;
  getStatus(): IsabelleLanguageServerStatus;
}

export interface PideAbbrev {
  readonly abbrev: string;
  readonly expansion: string;
}

/**
 * Subscribes to `PIDE/abbrevs_response` and dispatches
 * `PIDE/abbrevs_request` whenever the language client transitions
 * into `running`. Exposes the most recent abbreviation list
 * synchronously via {@link getAbbrevs} and a precomputed sorted
 * trigger-character set via {@link getTriggerCharacters} so the
 * completion provider can register with the correct trigger set
 * once and refresh on cache update.
 *
 * The cache survives language-client restart cycles because the
 * underlying `IsabelleLanguageClient.onNotification` registry
 * (PR #31) replays handlers across restarts. The status listener
 * re-dispatches the request on every fresh `running` transition.
 */
export class PideAbbrevsCache implements PideAbbrevsDisposable {
  private cachedAbbrevs: readonly PideAbbrev[] = [];
  private cachedTriggerCharacters: readonly string[] = [];
  private lastUpdatedAt: string | undefined;
  private lastObservedState: IsabelleLanguageServerState | undefined;
  private disposed = false;
  private readonly listeners = new Set<() => void>();
  private readonly responseSubscription: PideAbbrevsDisposable;
  private readonly statusSubscription: PideAbbrevsDisposable;

  public constructor(
    private readonly client: PideAbbrevsClient,
    private readonly logger: PideAbbrevsLogger,
    private readonly clock: () => Date = () => new Date()
  ) {
    this.responseSubscription = client.onNotification(
      PIDE_ABBREVS_RESPONSE_METHOD,
      (params) => this.handleResponse(params)
    );
    this.statusSubscription = client.onStatusChange((status) =>
      this.handleStatusChange(status)
    );

    const initial = client.getStatus();
    this.lastObservedState = initial.state;
    if (initial.state === "running") {
      this.dispatchRequest();
    }
  }

  /** Snapshot of the most recent abbreviation list; empty until first response. */
  public getAbbrevs(): readonly PideAbbrev[] {
    return this.cachedAbbrevs;
  }

  /**
   * Sorted, deduplicated list of single-character trigger candidates
   * derived from the leading character of each cached abbreviation.
   * Used by the completion provider to register itself with the
   * correct trigger-character set so VS Code calls back even when
   * the user types a non-word character.
   */
  public getTriggerCharacters(): readonly string[] {
    return this.cachedTriggerCharacters;
  }

  public getLastUpdatedAt(): string | undefined {
    return this.lastUpdatedAt;
  }

  public hasCachedAbbrevs(): boolean {
    return this.cachedAbbrevs.length > 0;
  }

  /**
   * Register a listener that fires every time the cache is updated by
   * a fresh `PIDE/abbrevs_response`. Used by the completion provider
   * to invalidate its precomputed lookups.
   */
  public onDidUpdate(listener: () => void): PideAbbrevsDisposable {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      }
    };
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.responseSubscription.dispose();
    this.statusSubscription.dispose();
    this.listeners.clear();
  }

  private handleStatusChange(status: IsabelleLanguageServerStatus): void {
    if (this.disposed) return;
    const previous = this.lastObservedState;
    this.lastObservedState = status.state;

    if (status.state === "running" && previous !== "running") {
      this.dispatchRequest();
      return;
    }

    if (
      status.state === "stopping" ||
      status.state === "failed" ||
      status.state === "disabled"
    ) {
      if (this.cachedAbbrevs.length > 0 || this.lastUpdatedAt !== undefined) {
        this.cachedAbbrevs = [];
        this.cachedTriggerCharacters = [];
        this.lastUpdatedAt = undefined;
        this.notifyListeners();
      }
    }
  }

  private dispatchRequest(): void {
    if (this.disposed) return;
    try {
      this.client.sendNotification(PIDE_ABBREVS_REQUEST_METHOD);
    } catch (error) {
      this.logger.appendLine(
        `PIDE abbrevs cache: failed to send ${PIDE_ABBREVS_REQUEST_METHOD}: ${errorMessage(error)}`
      );
    }
  }

  private handleResponse(params: unknown): void {
    if (this.disposed) return;
    const parsed = parsePideAbbrevsResponse(params);
    if (!parsed) {
      this.logger.appendLine(
        `PIDE abbrevs cache: ignored malformed ${PIDE_ABBREVS_RESPONSE_METHOD} payload`
      );
      return;
    }
    this.cachedAbbrevs = parsed;
    this.cachedTriggerCharacters = computeTriggerCharacters(parsed);
    this.lastUpdatedAt = this.clock().toISOString();
    this.logger.appendLine(
      `PIDE abbrevs cache: received ${parsed.length} abbreviation(s) from ${PIDE_ABBREVS_RESPONSE_METHOD}`
    );
    this.notifyListeners();
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        this.logger.appendLine(
          `PIDE abbrevs cache: listener threw: ${errorMessage(error)}`
        );
      }
    }
  }
}

/**
 * Parse a `PIDE/abbrevs_response` payload. Returns `undefined` for
 * structurally malformed payloads, or the deduplicated list of
 * abbreviations (later entries override earlier duplicates so the
 * server's last-write-wins shape matches the spec).
 */
export function parsePideAbbrevsResponse(value: unknown): readonly PideAbbrev[] | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  const raw = candidate.abbrevs;
  if (!Array.isArray(raw)) return undefined;
  const seen = new Map<string, string>();
  for (const item of raw) {
    if (!Array.isArray(item) || item.length < 2) continue;
    const [abbrev, expansion] = item;
    if (typeof abbrev !== "string" || abbrev.length === 0) continue;
    if (typeof expansion !== "string" || expansion.length === 0) continue;
    seen.set(abbrev, expansion);
  }
  const out: PideAbbrev[] = [];
  for (const [abbrev, expansion] of seen.entries()) {
    out.push({ abbrev, expansion });
  }
  return out;
}

/**
 * Compute the sorted set of leading characters across all
 * abbreviations. Used to register the completion provider's trigger
 * character set. Pure helper exposed for tests.
 */
export function computeTriggerCharacters(
  abbrevs: readonly PideAbbrev[]
): readonly string[] {
  const set = new Set<string>();
  for (const { abbrev } of abbrevs) {
    if (abbrev.length === 0) continue;
    set.add(abbrev.charAt(0));
  }
  return Array.from(set).sort();
}

/**
 * Given the current line text and cursor character offset, find the
 * longest backward-running prefix that matches the start of at least
 * one cached abbreviation. Returns the matching abbreviations plus
 * the start position of the prefix (so the completion provider can
 * build a replacement range), or `undefined` if there is no match.
 *
 * Pure helper: only depends on the abbreviations list, the line text,
 * and the cursor position. Tested in isolation.
 *
 * Behavior:
 *   - Walks backward up to `MAX_ABBREV_LENGTH` characters.
 *   - At each candidate prefix, checks whether at least one
 *     abbreviation starts with that prefix. The LONGEST such prefix
 *     wins so the user gets the most specific completion.
 *   - The empty-prefix case is rejected (cursor not in an abbreviation).
 *   - Whitespace and end-of-line at the cursor return undefined
 *     (the user is not actively typing an abbreviation).
 */
export interface PideAbbrevPrefixMatch {
  /** Inclusive 0-based character offset on the line where the prefix starts. */
  readonly start: number;
  /** Substring of the line from start to the cursor, the user-typed prefix. */
  readonly prefix: string;
  /** Abbreviations whose `abbrev` field starts with the prefix. */
  readonly matches: readonly PideAbbrev[];
}

const MAX_ABBREV_LENGTH = 32;

export function findPideAbbrevPrefixMatch(
  abbrevs: readonly PideAbbrev[],
  lineText: string,
  cursorChar: number
): PideAbbrevPrefixMatch | undefined {
  if (abbrevs.length === 0) return undefined;
  if (cursorChar <= 0 || cursorChar > lineText.length) return undefined;

  const charBefore = lineText.charAt(cursorChar - 1);
  if (charBefore === " " || charBefore === "\t" || charBefore === "") {
    return undefined;
  }

  const maxBack = Math.min(MAX_ABBREV_LENGTH, cursorChar);
  let bestStart: number | undefined;
  let bestMatches: PideAbbrev[] | undefined;
  for (let length = maxBack; length >= 1; length -= 1) {
    const start = cursorChar - length;
    const prefix = lineText.substring(start, cursorChar);
    if (/^\s/.test(prefix)) continue;
    const matches: PideAbbrev[] = [];
    for (const entry of abbrevs) {
      if (entry.abbrev.startsWith(prefix)) {
        matches.push(entry);
      }
    }
    if (matches.length > 0) {
      bestStart = start;
      bestMatches = matches;
      break;
    }
  }
  if (bestStart === undefined || bestMatches === undefined) return undefined;
  return {
    start: bestStart,
    prefix: lineText.substring(bestStart, cursorChar),
    matches: bestMatches
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
