// Cache + parser for the Isabelle documentation library reported by
// `isabelle vscode_server` over the upstream `PIDE/documentation_*`
// LSP notifications.
//
// Background (`mirror-isabelle@ce22e9ea` `src/Tools/VSCode/src/lsp.scala:704-728`):
//
//   client -> server: PIDE/documentation_request   (notification, no params)
//   server -> client: PIDE/documentation_response
//                     {
//                       sections: [
//                         {
//                           title: string,
//                           important: boolean,
//                           entries: [
//                             {
//                               print_html: string,   // GUI-styled display name
//                               platform_path: string // OS-native file path
//                             },
//                             ...
//                           ]
//                         },
//                         ...
//                       ]
//                     }
//
// The Isabelle distribution ships a curated set of PDFs (Tutorial,
// Isar-Ref, Sledgehammer, etc.) plus a few HTML manuals. The
// `platform_path` resolves to one of those files on disk; opening it
// with the OS's default application (the `Isabelle: Browse Isabelle
// Documentation` command does exactly that via
// `vscode.env.openExternal`) gives the user a one-shot way to jump
// into Isabelle's own documentation without leaving the editor.
//
// `vscode`-free: injectable client + logger shapes that the production
// `IsabelleLanguageClient` already satisfies structurally. Tests pass
// small in-memory stubs.

import {
  IsabelleLanguageServerState,
  IsabelleLanguageServerStatus
} from "../lsp/lspTypes";

export const PIDE_DOCUMENTATION_REQUEST_METHOD = "PIDE/documentation_request";
export const PIDE_DOCUMENTATION_RESPONSE_METHOD = "PIDE/documentation_response";

export interface PideDocumentationDisposable {
  dispose(): void;
}

export interface PideDocumentationLogger {
  appendLine(message: string): void;
}

export interface PideDocumentationClient {
  sendNotification(method: string, params?: unknown): void;
  onNotification(
    method: string,
    handler: (params: unknown) => void
  ): PideDocumentationDisposable;
  onStatusChange(
    handler: (status: IsabelleLanguageServerStatus) => void
  ): PideDocumentationDisposable;
  getStatus(): IsabelleLanguageServerStatus;
}

export interface PideDocumentationEntry {
  /** Plain-text display name (HTML tags stripped from `print_html`). */
  readonly label: string;
  /** Raw `print_html` field from the upstream payload, kept for callers
   * that want to render it back as HTML. */
  readonly printHtml: string;
  /** Absolute OS-native path the user should open. */
  readonly platformPath: string;
}

export interface PideDocumentationSection {
  readonly title: string;
  readonly important: boolean;
  readonly entries: readonly PideDocumentationEntry[];
}

export class PideDocumentationCache implements PideDocumentationDisposable {
  private cachedSections: readonly PideDocumentationSection[] = [];
  private lastUpdatedAt: string | undefined;
  private lastObservedState: IsabelleLanguageServerState | undefined;
  private disposed = false;
  private readonly listeners = new Set<() => void>();
  private readonly responseSubscription: PideDocumentationDisposable;
  private readonly statusSubscription: PideDocumentationDisposable;

  public constructor(
    private readonly client: PideDocumentationClient,
    private readonly logger: PideDocumentationLogger,
    private readonly clock: () => Date = () => new Date()
  ) {
    this.responseSubscription = client.onNotification(
      PIDE_DOCUMENTATION_RESPONSE_METHOD,
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

  public getSections(): readonly PideDocumentationSection[] {
    return this.cachedSections;
  }

  public getLastUpdatedAt(): string | undefined {
    return this.lastUpdatedAt;
  }

  public hasCachedSections(): boolean {
    return this.cachedSections.length > 0;
  }

  /**
   * Force-refresh the cache by re-sending the request. No-op when the
   * LSP is not `running` (the server cannot reply). Caller-driven
   * refresh is useful for the "Refresh Isabelle Documentation" UI flow.
   */
  public refresh(): void {
    if (this.disposed) return;
    if (this.lastObservedState !== "running") return;
    this.dispatchRequest();
  }

  public onDidUpdate(listener: () => void): PideDocumentationDisposable {
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
      if (this.cachedSections.length > 0 || this.lastUpdatedAt !== undefined) {
        this.cachedSections = [];
        this.lastUpdatedAt = undefined;
        this.notifyListeners();
      }
    }
  }

  private dispatchRequest(): void {
    if (this.disposed) return;
    try {
      this.client.sendNotification(PIDE_DOCUMENTATION_REQUEST_METHOD);
    } catch (error) {
      this.logger.appendLine(
        `PIDE documentation cache: failed to send ${PIDE_DOCUMENTATION_REQUEST_METHOD}: ${errorMessage(error)}`
      );
    }
  }

  private handleResponse(params: unknown): void {
    if (this.disposed) return;
    const parsed = parsePideDocumentationResponse(params);
    if (!parsed) {
      this.logger.appendLine(
        `PIDE documentation cache: ignored malformed ${PIDE_DOCUMENTATION_RESPONSE_METHOD} payload`
      );
      return;
    }
    this.cachedSections = parsed;
    this.lastUpdatedAt = this.clock().toISOString();
    const totalEntries = parsed.reduce((sum, s) => sum + s.entries.length, 0);
    this.logger.appendLine(
      `PIDE documentation cache: received ${parsed.length} section(s) and ${totalEntries} entry(ies) from ${PIDE_DOCUMENTATION_RESPONSE_METHOD}`
    );
    this.notifyListeners();
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        this.logger.appendLine(
          `PIDE documentation cache: listener threw: ${errorMessage(error)}`
        );
      }
    }
  }
}

/**
 * Parse a `PIDE/documentation_response` payload into a strongly-typed
 * section list. Returns `undefined` if the top-level shape is wrong.
 * Malformed individual sections / entries are dropped silently.
 *
 * Pure helper exposed for tests.
 */
export function parsePideDocumentationResponse(
  value: unknown
): readonly PideDocumentationSection[] | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  const rawSections = candidate.sections;
  if (!Array.isArray(rawSections)) return undefined;
  const out: PideDocumentationSection[] = [];
  for (const rawSection of rawSections) {
    const parsed = parseSection(rawSection);
    if (parsed) out.push(parsed);
  }
  return out;
}

function parseSection(value: unknown): PideDocumentationSection | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  const title = candidate.title;
  if (typeof title !== "string" || title.length === 0) return undefined;
  const important = candidate.important === true;
  const rawEntries = candidate.entries;
  if (!Array.isArray(rawEntries)) return undefined;
  const entries: PideDocumentationEntry[] = [];
  for (const rawEntry of rawEntries) {
    const parsed = parseEntry(rawEntry);
    if (parsed) entries.push(parsed);
  }
  return { title, important, entries };
}

function parseEntry(value: unknown): PideDocumentationEntry | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  const printHtml = candidate.print_html;
  const platformPath = candidate.platform_path;
  if (typeof printHtml !== "string" || printHtml.length === 0) return undefined;
  if (typeof platformPath !== "string" || platformPath.length === 0) return undefined;
  return {
    label: stripHtml(printHtml).trim() || printHtml,
    printHtml,
    platformPath
  };
}

/**
 * Crude HTML stripper for `print_html` so we can use it as a plain
 * quick-pick label. The upstream emits tags like `<b>...</b>` /
 * `<i>...</i>` / `&amp;` rather than arbitrary HTML; we do not need
 * a full HTML parser. Pure helper exposed for tests.
 */
export function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * Group cached sections into a flat list of `{ label, detail, path }`
 * tuples suitable for a `vscode.QuickPick`. "Important" sections
 * (Isabelle marks Tutorial / Isar-Ref / etc. as important) come
 * first. Pure helper exposed for tests.
 */
export interface PideDocumentationQuickPickItem {
  readonly label: string;
  readonly section: string;
  readonly important: boolean;
  readonly platformPath: string;
}

export function flattenDocumentationForQuickPick(
  sections: readonly PideDocumentationSection[]
): readonly PideDocumentationQuickPickItem[] {
  const ordered = [...sections].sort((a, b) => {
    if (a.important === b.important) return a.title.localeCompare(b.title);
    return a.important ? -1 : 1;
  });
  const out: PideDocumentationQuickPickItem[] = [];
  for (const section of ordered) {
    for (const entry of section.entries) {
      out.push({
        label: entry.label,
        section: section.title,
        important: section.important,
        platformPath: entry.platformPath
      });
    }
  }
  return out;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
