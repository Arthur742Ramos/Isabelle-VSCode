export interface TextRange {
  start: number;
  end: number;
}

export function findSymbolEscapeRange(lineText: string, character: number): TextRange | undefined {
  const regex = /\\<[^>]+>/g;
  let match = regex.exec(lineText);

  while (match) {
    const start = match.index;
    const end = start + match[0].length;
    if (character >= start && character < end) {
      return { start, end };
    }
    match = regex.exec(lineText);
  }

  return undefined;
}
