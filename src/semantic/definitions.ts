import { CommandSpan, ProtocolPosition } from "../protocol/messages";
import { containsPosition } from "../document/commandSpans";
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
  const candidates = currentIndex >= 0 ? spans.slice(0, currentIndex + 1).reverse() : spans;

  const span = candidates
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
