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
  commentDepth: number;
}

const WORD = /^[A-Za-z_][A-Za-z0-9_']*/;
const IGNORED_DECLARATION_NAMES = new Set(["fixes", "assumes", "shows", "where", "if", "for"]);

export function extractCommandSpans(uri: string, text: string, version: number): CommandSpan[] {
  const lines = text.split("\n");
  const starts: ParsedCommandStart[] = [];
  let commentDepth = 0;

  for (let line = 0; line < lines.length; line++) {
    const result = scanLineForCommand(lines[line], commentDepth);
    commentDepth = result.commentDepth;
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

export function startsBeforeOrAt(start: ProtocolPosition, position: ProtocolPosition): boolean {
  return start.line < position.line || (start.line === position.line && start.character <= position.character);
}

export function startsAfter(start: ProtocolPosition, position: ProtocolPosition): boolean {
  return start.line > position.line || (start.line === position.line && start.character > position.character);
}

function endsAfter(end: ProtocolPosition, position: ProtocolPosition): boolean {
  return end.line > position.line || (end.line === position.line && end.character > position.character);
}

function scanLineForCommand(line: string, initialCommentDepth: number): LineScanResult {
  let commentDepth = initialCommentDepth;
  let inString = false;
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

    if (line.startsWith("(*", index)) {
      commentDepth++;
      index += 2;
      continue;
    }

    const character = line[index];
    if (character === "\"") {
      sawCode = true;
      inString = true;
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

  return { command, commentDepth };
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
