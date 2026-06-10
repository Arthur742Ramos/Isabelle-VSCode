export type BuildDiagnosticSeverity = "error" | "warning";

export interface BuildDiagnostic {
  filePath: string;
  message: string;
  severity: BuildDiagnosticSeverity;
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
}

/**
 * `source` string applied to every `vscode.Diagnostic` published by the
 * CLI-build runner. Surfaced in the Problems panel "Source" column so users
 * can distinguish CLI-build diagnostics from diagnostics owned by other
 * providers (notably the opt-in Isabelle language server, whose source label
 * is supplied by Isabelle's `vscode_server`).
 */
export const BUILD_DIAGNOSTIC_SOURCE = "isabelle build";

/**
 * Name of the `vscode.DiagnosticCollection` owned by `BuildService`. Each
 * VS Code diagnostic collection has its own "owner" identity, so a separate
 * collection (such as one created by the Isabelle LSP client) does not
 * overwrite or replace CLI-build diagnostics for the same file — VS Code
 * aggregates the per-owner diagnostics in the Problems panel.
 *
 * This name must remain distinct from any collection name a future LSP
 * client setup might claim; see `test/lsp/diagnosticsCoexistence.test.ts`.
 */
export const BUILD_DIAGNOSTIC_COLLECTION_NAME = "isabelle-build";

const COLON_LOCATION = /^(.+?\.thy):(\d+):(\d+):\s*(error|warning):\s*(.+)$/i;
const ISABELLE_FILE_LOCATION = /^File "(.+?\.thy)", line (\d+)(?:, characters (\d+)-(\d+))?:\s*$/;
// Isabelle's dominant build-error location: a trailing `(line N of "FILE")`,
// e.g. `*** At command "lemma" (line 12 of "/path/Foo.thy")` or
// `*** Failed to finish proof ... (line 5 of "Foo.thy")`. The message is the
// run of `***`-prefixed lines ending at this location line.
const AT_COMMAND_LOCATION = /\(line (\d+) of "(.+?\.thy)"\)\s*$/;

export function parseBuildDiagnostics(output: string): BuildDiagnostic[] {
  const lines = output.split(/\r?\n/);
  const diagnostics: BuildDiagnostic[] = [];

  for (let index = 0; index < lines.length; index++) {
    const rawLine = lines[index];
    const line = stripMessagePrefix(rawLine);
    const colonLocation = COLON_LOCATION.exec(line);
    if (colonLocation) {
      diagnostics.push({
        filePath: colonLocation[1],
        startLine: toZeroBased(Number(colonLocation[2])),
        startCharacter: toZeroBased(Number(colonLocation[3])),
        endLine: toZeroBased(Number(colonLocation[2])),
        endCharacter: toZeroBased(Number(colonLocation[3])) + 1,
        severity: normalizeSeverity(colonLocation[4]),
        message: colonLocation[5].trim()
      });
      continue;
    }

    const fileLocation = ISABELLE_FILE_LOCATION.exec(line);
    if (fileLocation) {
      const messageLines: string[] = [];
      let cursor = index + 1;
      while (cursor < lines.length && !isLocationLine(stripMessagePrefix(lines[cursor]))) {
        const messageLine = stripMessagePrefix(lines[cursor]).trim();
        if (messageLine.length > 0) {
          messageLines.push(messageLine);
        }
        cursor++;
      }

      const startLine = toZeroBased(Number(fileLocation[2]));
      const startCharacter = fileLocation[3] ? Number(fileLocation[3]) : 0;
      const endCharacter = fileLocation[4] ? Number(fileLocation[4]) : Math.max(startCharacter + 1, 1);

      diagnostics.push({
        filePath: fileLocation[1],
        startLine,
        startCharacter,
        endLine: startLine,
        endCharacter,
        severity: inferSeverity(messageLines),
        message: messageLines.length > 0 ? messageLines.join("\n") : "Isabelle build diagnostic"
      });
      continue;
    }

    // `*** ... (line N of "FILE")` — the message is the run of `***`-prefixed
    // lines immediately preceding (and including) this location line.
    const atCommand = AT_COMMAND_LOCATION.exec(line);
    if (atCommand && rawLine.startsWith("***")) {
      const messageLines = collectAtCommandMessage(lines, index, line);
      const startLine = toZeroBased(Number(atCommand[1]));
      diagnostics.push({
        filePath: atCommand[2],
        startLine,
        startCharacter: 0,
        endLine: startLine,
        endCharacter: 1,
        severity: inferSeverity(messageLines),
        message: messageLines.length > 0 ? messageLines.join("\n") : "Isabelle build diagnostic"
      });
      continue;
    }
  }

  return diagnostics;
}

/**
 * Gather the message for an `... (line N of "FILE")` diagnostic: the contiguous
 * run of `***`-prefixed lines ending at `locationIndex`. The location line's
 * own text (minus the trailing `(line N of "FILE")`) is kept when it carries
 * more than the bare `At command "..."` boilerplate.
 */
function collectAtCommandMessage(lines: string[], locationIndex: number, strippedLocationLine: string): string[] {
  const collected: string[] = [];
  let start = locationIndex;
  while (start > 0 && lines[start - 1].startsWith("***")) {
    start -= 1;
  }
  for (let i = start; i < locationIndex; i++) {
    const text = stripMessagePrefix(lines[i]).trim();
    if (text.length > 0) {
      collected.push(text);
    }
  }
  // Strip the trailing location from the final line; keep any leading text
  // (e.g. "Failed to finish proof") but drop a bare "At command \"...\"".
  const tail = strippedLocationLine.replace(AT_COMMAND_LOCATION, "").trim();
  if (tail.length > 0 && !/^At command\b/i.test(tail)) {
    collected.push(tail);
  }
  return collected;
}

function isLocationLine(line: string): boolean {
  return COLON_LOCATION.test(line) || ISABELLE_FILE_LOCATION.test(line) || AT_COMMAND_LOCATION.test(line);
}

function stripMessagePrefix(line: string): string {
  return line.replace(/^\*{3}\s?/, "");
}

function normalizeSeverity(value: string): BuildDiagnosticSeverity {
  return value.toLowerCase() === "warning" ? "warning" : "error";
}

function inferSeverity(lines: string[]): BuildDiagnosticSeverity {
  return lines.some((line) => /\bwarning\b/i.test(line)) ? "warning" : "error";
}

function toZeroBased(value: number): number {
  return Math.max(value - 1, 0);
}
