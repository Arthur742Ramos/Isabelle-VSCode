import * as path from "path";
import { DiscoveredSession, DiscoveredTheory } from "../protocol/messages";

const SECTION_KEYWORDS = new Set([
  "sessions",
  "directories",
  "theories",
  "document_theories",
  "document_files",
  "export_files"
]);

export function parseRootFile(source: string, rootDirectory: string): DiscoveredSession[] {
  const tokens = tokenize(stripNestedComments(source));
  const sessions: DiscoveredSession[] = [];
  let index = 0;

  while (index < tokens.length) {
    if (tokens[index].value !== "session") {
      index++;
      continue;
    }

    const name = tokens[index + 1]?.value;
    if (!name) {
      break;
    }

    index += 2;
    index = skipBalancedGroups(tokens, index);

    let sessionDirectory = rootDirectory;
    if (tokens[index]?.value === "in") {
      const directory = tokens[index + 1]?.value;
      if (directory) {
        sessionDirectory = path.resolve(rootDirectory, directory);
      }
      index += 2;
    }

    let parent: string | undefined;
    if (tokens[index]?.value === "=") {
      parent = tokens[index + 1]?.value;
      index += 2;
    }

    if (tokens[index]?.value === "+") {
      index++;
    }

    const session: DiscoveredSession = {
      name,
      parent,
      rootDirectory,
      sessionDirectory,
      theories: [],
      importedSessions: [],
      directories: [],
      documentFiles: []
    };

    while (index < tokens.length && tokens[index].value !== "session" && tokens[index].value !== "chapter") {
      const token = tokens[index].value;

      if (token === "sessions") {
        const collected = collectSection(tokens, index + 1);
        session.importedSessions.push(...collected.values.map((value) => value.value));
        index = collected.nextIndex;
        continue;
      }

      if (token === "directories") {
        const collected = collectSection(tokens, index + 1);
        session.directories.push(...collected.values.map((value) => value.value));
        index = collected.nextIndex;
        continue;
      }

      if (token === "theories") {
        const collected = collectSection(tokens, index + 1);
        session.theories.push(...collected.values.map(toTheory));
        index = collected.nextIndex;
        continue;
      }

      if (token === "document_files") {
        const collected = collectSection(tokens, index + 1);
        session.documentFiles.push(...collected.values.map((value) => value.value));
        index = collected.nextIndex;
        continue;
      }

      index++;
    }

    sessions.push(session);
  }

  return sessions;
}

function skipBalancedGroups(tokens: Token[], startIndex: number): number {
  let index = startIndex;

  while (tokens[index]?.value === "(") {
    let depth = 0;
    do {
      if (tokens[index]?.value === "(") {
        depth++;
      } else if (tokens[index]?.value === ")") {
        depth--;
      }
      index++;
    } while (index < tokens.length && depth > 0);
  }

  return index;
}

export function parseRootsFile(source: string): string[] {
  return source
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*/, "").trim())
    .filter((line) => line.length > 0)
    .map(unquote);
}

interface Token {
  value: string;
  quoted: boolean;
}

function collectSection(tokens: Token[], startIndex: number): { values: Token[]; nextIndex: number } {
  const values: Token[] = [];
  let index = skipOptions(tokens, startIndex);

  while (index < tokens.length) {
    const value = tokens[index].value;
    if (value === "session" || value === "chapter" || SECTION_KEYWORDS.has(value)) {
      break;
    }

    if (value !== "(" && value !== ")" && value !== "[" && value !== "]" && value !== ",") {
      values.push(tokens[index]);
    }

    index++;
  }

  return { values, nextIndex: index };
}

function skipOptions(tokens: Token[], startIndex: number): number {
  let index = startIndex;
  while (tokens[index]?.value === "[") {
    let depth = 0;
    do {
      if (tokens[index]?.value === "[") {
        depth++;
      } else if (tokens[index]?.value === "]") {
        depth--;
      }
      index++;
    } while (index < tokens.length && depth > 0);
  }
  return index;
}

function toTheory(token: Token): DiscoveredTheory {
  return {
    name: token.value
  };
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
      tokens.push({ value: parsed.value, quoted: true });
      index = parsed.nextIndex;
      continue;
    }

    if ("=+()[],".includes(char)) {
      tokens.push({ value: char, quoted: false });
      index++;
      continue;
    }

    let end = index + 1;
    while (end < source.length && !/\s/.test(source[end]) && !"=+()[],".includes(source[end])) {
      end++;
    }
    tokens.push({ value: source.slice(index, end), quoted: false });
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

function unquote(value: string): string {
  if (value.startsWith("\"") && value.endsWith("\"")) {
    return value.slice(1, -1);
  }
  return value;
}
