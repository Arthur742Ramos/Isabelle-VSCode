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

const COLON_LOCATION = /^(.+?\.thy):(\d+):(\d+):\s*(error|warning):\s*(.+)$/i;
const ISABELLE_FILE_LOCATION = /^File "(.+?\.thy)", line (\d+)(?:, characters (\d+)-(\d+))?:\s*$/;

export function parseBuildDiagnostics(output: string): BuildDiagnostic[] {
  const lines = output.split(/\r?\n/);
  const diagnostics: BuildDiagnostic[] = [];

  for (let index = 0; index < lines.length; index++) {
    const line = stripMessagePrefix(lines[index]);
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
    if (!fileLocation) {
      continue;
    }

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
  }

  return diagnostics;
}

function isLocationLine(line: string): boolean {
  return COLON_LOCATION.test(line) || ISABELLE_FILE_LOCATION.test(line);
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
