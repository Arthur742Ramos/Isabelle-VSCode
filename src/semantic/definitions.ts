import { CommandSpan, ProtocolPosition } from "../protocol/messages";
import { getCommandInfo } from "./isabelleSyntax";

const WORD = /[A-Za-z_][A-Za-z0-9_']*/g;

export interface NamedDeclaration {
  name: string;
  span: CommandSpan;
}

export function findDeclarationByName(
  name: string,
  spans: CommandSpan[],
  position?: ProtocolPosition
): NamedDeclaration | undefined {
  const currentIndex = position ? spans.findIndex((span) => containsPosition(span, position)) : -1;
  const beforeCurrent = currentIndex >= 0 ? spans.slice(0, currentIndex + 1).reverse() : [];
  const afterCurrent = currentIndex >= 0 ? spans.slice(currentIndex + 1) : spans;

  const span = [...beforeCurrent, ...afterCurrent]
    .filter(isNavigableDeclaration)
    .find((candidate) => candidate.name === name);
  return span ? { name, span } : undefined;
}

export function wordAt(text: string, character: number): { word: string; start: number; end: number } | undefined {
  for (const match of text.matchAll(WORD)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (start <= character && character <= end) {
      return { word: match[0], start, end };
    }
  }
  return undefined;
}

function isNavigableDeclaration(span: CommandSpan): boolean {
  if (!span.name) {
    return false;
  }
  const category = getCommandInfo(span.kind)?.category;
  return category === "declaration" || category === "statement" || category === "context" || category === "proof";
}

function containsPosition(span: CommandSpan, position: ProtocolPosition): boolean {
  return startsBeforeOrAt(span.range.start, position) && endsAfter(span.range.end, position);
}

function startsBeforeOrAt(start: ProtocolPosition, position: ProtocolPosition): boolean {
  return start.line < position.line || (start.line === position.line && start.character <= position.character);
}

function endsAfter(end: ProtocolPosition, position: ProtocolPosition): boolean {
  return end.line > position.line || (end.line === position.line && end.character > position.character);
}
