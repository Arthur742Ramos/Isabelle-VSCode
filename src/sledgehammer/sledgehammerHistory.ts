import { CommandSpan, SledgehammerRunResult, SledgehammerStatus } from "../protocol/messages";

export interface SledgehammerHistoryEntry {
  requestId: string;
  uri: string;
  version?: number;
  status: SledgehammerStatus;
  suggestionCount: number;
  message?: string;
  commandSummary?: string;
  sessionName?: string;
  isabelleExecutablePath?: string;
  startedAt: string;
  finishedAt?: string;
}

export interface SledgehammerHistoryStart {
  requestId: string;
  uri: string;
  version?: number;
  sessionName?: string;
  isabelleExecutablePath?: string;
  commandSummary?: string;
  startedAt: string;
}

const DEFAULT_MAX_ENTRIES = 20;

export class SledgehammerHistory {
  private readonly entries: SledgehammerHistoryEntry[] = [];
  private readonly maxEntries: number;

  public constructor(maxEntries: number = DEFAULT_MAX_ENTRIES) {
    if (!Number.isFinite(maxEntries) || maxEntries <= 0) {
      throw new Error(`SledgehammerHistory maxEntries must be a positive integer, got ${maxEntries}.`);
    }
    this.maxEntries = Math.floor(maxEntries);
  }

  public recordStart(entry: SledgehammerHistoryStart): SledgehammerHistoryEntry {
    if (!entry.requestId) {
      throw new Error("SledgehammerHistory.recordStart requires a non-empty requestId.");
    }

    const stored: SledgehammerHistoryEntry = {
      requestId: entry.requestId,
      uri: entry.uri,
      version: entry.version,
      status: "running",
      suggestionCount: 0,
      sessionName: entry.sessionName,
      isabelleExecutablePath: entry.isabelleExecutablePath,
      commandSummary: entry.commandSummary,
      startedAt: entry.startedAt
    };

    const existingIndex = this.entries.findIndex((existing) => existing.requestId === entry.requestId);
    if (existingIndex >= 0) {
      this.entries.splice(existingIndex, 1);
    }
    this.entries.unshift(stored);
    this.truncate();
    return cloneEntry(stored);
  }

  public recordResult(
    requestId: string,
    result: SledgehammerRunResult,
    finishedAt: string
  ): SledgehammerHistoryEntry | undefined {
    const entry = this.findEntry(requestId);
    if (!entry) {
      return undefined;
    }

    entry.status = result.status;
    entry.suggestionCount = result.suggestions.length;
    entry.message = result.message;
    entry.finishedAt = finishedAt;
    if (result.version !== undefined) {
      entry.version = result.version;
    }
    if (!entry.commandSummary && result.command) {
      entry.commandSummary = summarizeCommand(result.command);
    }
    return cloneEntry(entry);
  }

  public recordCancellation(
    requestId: string,
    message: string,
    finishedAt: string
  ): SledgehammerHistoryEntry | undefined {
    const entry = this.findEntry(requestId);
    if (!entry) {
      return undefined;
    }
    entry.status = "cancelled";
    entry.message = message;
    entry.finishedAt = finishedAt;
    return cloneEntry(entry);
  }

  public recordFailure(
    requestId: string,
    message: string,
    finishedAt: string
  ): SledgehammerHistoryEntry | undefined {
    const entry = this.findEntry(requestId);
    if (!entry) {
      return undefined;
    }
    entry.status = "failed";
    entry.message = message;
    entry.finishedAt = finishedAt;
    return cloneEntry(entry);
  }

  public list(): readonly SledgehammerHistoryEntry[] {
    return this.entries.map(cloneEntry);
  }

  public find(requestId: string): SledgehammerHistoryEntry | undefined {
    const entry = this.findEntry(requestId);
    return entry ? cloneEntry(entry) : undefined;
  }

  public clear(): void {
    this.entries.length = 0;
  }

  private findEntry(requestId: string): SledgehammerHistoryEntry | undefined {
    return this.entries.find((entry) => entry.requestId === requestId);
  }

  private truncate(): void {
    if (this.entries.length > this.maxEntries) {
      this.entries.length = this.maxEntries;
    }
  }
}

function summarizeCommand(command: CommandSpan): string {
  return command.name ? `${command.kind} ${command.name}` : command.kind;
}

function cloneEntry(entry: SledgehammerHistoryEntry): SledgehammerHistoryEntry {
  return { ...entry };
}
