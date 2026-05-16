export interface ParsedTheoryHeader {
  name?: string;
  imports: string[];
}

const IMPORT_STOP_KEYWORDS = new Set(["keywords", "abbrevs", "begin"]);
const PUNCTUATION = new Set(["(", ")", "[", "]", ","]);

interface Token {
  value: string;
}

export function parseTheoryHeader(source: string): ParsedTheoryHeader {
  const tokens = tokenize(stripNestedComments(stripBom(source)));
  if (tokens[0]?.value !== "theory") {
    return { imports: [] };
  }

  const name = tokens[1]?.value;
  const beginIndex = tokens.findIndex((token, index) => index > 1 && token.value === "begin");
  const importsIndex = tokens.findIndex(
    (token, index) => index > 1 && token.value === "imports" && (beginIndex === -1 || index < beginIndex)
  );
  if (importsIndex === -1) {
    return { name, imports: [] };
  }

  const imports: string[] = [];
  for (let index = importsIndex + 1; index < tokens.length; index++) {
    const token = tokens[index].value;
    if (IMPORT_STOP_KEYWORDS.has(token)) {
      break;
    }
    if (!PUNCTUATION.has(token)) {
      imports.push(token);
    }
  }

  return { name, imports };
}

function stripBom(source: string): string {
  return source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
}

function stripNestedComments(source: string): string {
  let result = "";
  let depth = 0;

  for (let index = 0; index < source.length; index++) {
    const current = source[index];
    const next = source[index + 1];

    if (current === "(" && next === "*") {
      depth++;
      index++;
      continue;
    }

    if (current === "*" && next === ")" && depth > 0) {
      depth--;
      index++;
      continue;
    }

    if (depth === 0) {
      result += current;
    }
  }

  return result;
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index];

    if (/\s/.test(char)) {
      index++;
      continue;
    }

    if (char === "\"") {
      const parsed = readQuoted(source, index);
      tokens.push({ value: parsed.value });
      index = parsed.nextIndex;
      continue;
    }

    if ("()[],".includes(char)) {
      tokens.push({ value: char });
      index++;
      continue;
    }

    let end = index + 1;
    while (end < source.length && !/\s/.test(source[end]) && !"()[],".includes(source[end])) {
      end++;
    }
    tokens.push({ value: source.slice(index, end) });
    index = end;
  }

  return tokens;
}

function readQuoted(source: string, startIndex: number): { value: string; nextIndex: number } {
  let value = "";
  let index = startIndex + 1;

  while (index < source.length) {
    const char = source[index];
    if (char === "\\" && index + 1 < source.length) {
      value += source[index + 1];
      index += 2;
      continue;
    }
    if (char === "\"") {
      return { value, nextIndex: index + 1 };
    }
    value += char;
    index++;
  }

  return { value, nextIndex: index };
}
