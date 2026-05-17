import { CommandSpan, ProtocolPosition } from "../protocol/messages";
import { getCommandInfo, isCommandKeyword } from "../semantic/isabelleSyntax";

interface ParsedCommandStart {
  keyword: string;
  name?: string;
  line: number;
  character: number;
}

interface LineScanResult {
  command?: Omit<ParsedCommandStart, "line">;
  state: ScanState;
}

interface ScanState {
  commentDepth: number;
  inString: boolean;
  cartoucheDepth: number;
}

const WORD = /^[A-Za-z_][A-Za-z0-9_']*/;
const IGNORED_DECLARATION_NAMES = new Set(["fixes", "assumes", "shows", "where", "if", "for"]);
const CARTOUCHE_OPEN = "\u2039";
const CARTOUCHE_CLOSE = "\u203A";

export function extractCommandSpans(uri: string, text: string, version: number): CommandSpan[] {
  const lines = text.split("\n");
  const starts: ParsedCommandStart[] = [];
  let state: ScanState = { commentDepth: 0, inString: false, cartoucheDepth: 0 };

  for (let line = 0; line < lines.length; line++) {
    const result = scanLineForCommand(lines[line], state);
    state = result.state;
    if (result.command) {
      starts.push({ ...result.command, line });
    }
  }

  return starts.map((start, index) => {
    const next = starts[index + 1];
    const end = next
      ? { line: next.line, character: next.character }
      : { line: lines.length - 1, character: lines[lines.length - 1]?.length ?? 0 };

    return {
      id: `${uri}:${version}:${index}`,
      kind: start.keyword,
      name: start.name,
      status: "pending",
      range: {
        start: { line: start.line, character: start.character },
        end
      }
    };
  });
}

export function containsPosition(span: CommandSpan, position: ProtocolPosition): boolean {
  return startsBeforeOrAt(span.range.start, position) && endsAfter(span.range.end, position);
}

export function findCommandSpanAtOrBefore(
  spans: readonly CommandSpan[],
  position: ProtocolPosition
): CommandSpan | undefined {
  return spans.find((span) => containsPosition(span, position))
    ?? findLast(spans, (span) => startsBeforeOrAt(span.range.start, position));
}

export function startsBeforeOrAt(start: ProtocolPosition, position: ProtocolPosition): boolean {
  return start.line < position.line || (start.line === position.line && start.character <= position.character);
}

export function startsAfter(start: ProtocolPosition, position: ProtocolPosition): boolean {
  return start.line > position.line || (start.line === position.line && start.character > position.character);
}

function endsAfter(end: ProtocolPosition, position: ProtocolPosition): boolean {
  return end.line > position.line || (end.line === position.line && end.character > position.character);
}

function findLast<T>(items: readonly T[], predicate: (item: T) => boolean): T | undefined {
  for (let index = items.length - 1; index >= 0; index--) {
    if (predicate(items[index])) {
      return items[index];
    }
  }
  return undefined;
}

function scanLineForCommand(line: string, initialState: ScanState): LineScanResult {
  let commentDepth = initialState.commentDepth;
  let inString = initialState.inString;
  let cartoucheDepth = initialState.cartoucheDepth;
  let command: Omit<ParsedCommandStart, "line"> | undefined;
  let sawCode = false;

  for (let index = 0; index < line.length;) {
    if (commentDepth > 0) {
      if (line.startsWith("(*", index)) {
        commentDepth++;
        index += 2;
      } else if (line.startsWith("*)", index)) {
        commentDepth--;
        index += 2;
      } else {
        index++;
      }
      continue;
    }

    if (inString) {
      if (line[index] === "\\") {
        index += 2;
      } else if (line[index] === "\"") {
        inString = false;
        index++;
      } else {
        index++;
      }
      continue;
    }

    if (cartoucheDepth > 0) {
      if (line.startsWith("\\<open>", index)) {
        cartoucheDepth++;
        index += "\\<open>".length;
      } else if (line.startsWith("\\<close>", index)) {
        cartoucheDepth = Math.max(0, cartoucheDepth - 1);
        index += "\\<close>".length;
      } else if (line[index] === CARTOUCHE_OPEN) {
        cartoucheDepth++;
        index++;
      } else if (line[index] === CARTOUCHE_CLOSE) {
        cartoucheDepth = Math.max(0, cartoucheDepth - 1);
        index++;
      } else {
        index++;
      }
      continue;
    }

    if (line.startsWith("(*", index)) {
      commentDepth++;
      index += 2;
      continue;
    }

    if (line.startsWith("\\<open>", index)) {
      sawCode = true;
      cartoucheDepth++;
      index += "\\<open>".length;
      continue;
    }

    const character = line[index];
    if (character === "\"") {
      sawCode = true;
      inString = true;
      index++;
      continue;
    }

    if (character === CARTOUCHE_OPEN) {
      sawCode = true;
      cartoucheDepth++;
      index++;
      continue;
    }

    if (/\s/.test(character)) {
      index++;
      continue;
    }

    if (!sawCode) {
      sawCode = true;
      const match = WORD.exec(line.slice(index));
      if (match && isCommandKeyword(match[0])) {
        command = {
          keyword: match[0],
          name: commandNameAfter(line, index + match[0].length),
          character: index
        };
      }
    }

    index++;
  }

  return {
    command,
    state: {
      commentDepth,
      inString,
      cartoucheDepth
    }
  };
}

function commandNameAfter(line: string, offset: number): string | undefined {
  const commandInfo = getCommandInfo(line.slice(0, offset).trim().split(/\s+/).pop() ?? "");
  if (!commandInfo?.declaresName) {
    return undefined;
  }

  const rest = line.slice(offset).trimStart();
  const match = WORD.exec(rest);
  if (!match || IGNORED_DECLARATION_NAMES.has(match[0])) {
    return undefined;
  }
  return match[0];
}
