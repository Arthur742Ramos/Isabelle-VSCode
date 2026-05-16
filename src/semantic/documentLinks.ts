import * as path from "path";
import { DiscoveredSession } from "../protocol/messages";
import { ProtocolRange } from "../protocol/messages";

export interface IsabelleImportLink {
  name: string;
  range: ProtocolRange;
  targetPath: string;
}

interface HeaderToken {
  value: string;
  range: ProtocolRange;
}

interface TheoryRecord {
  sessionName: string;
  theoryName: string;
  path: string;
}

const IMPORT_STOP_KEYWORDS = new Set(["keywords", "abbrevs", "begin"]);
const PUNCTUATION = new Set(["(", ")", "[", "]", ","]);

export function extractImportTokens(source: string): Array<{ name: string; range: ProtocolRange }> {
  const tokens = tokenizeHeader(source);
  if (tokens[0]?.value !== "theory") {
    return [];
  }

  const beginIndex = tokens.findIndex((token, index) => index > 1 && token.value === "begin");
  const importsIndex = tokens.findIndex(
    (token, index) => index > 1 && token.value === "imports" && (beginIndex === -1 || index < beginIndex)
  );
  if (importsIndex === -1) {
    return [];
  }

  const imports: Array<{ name: string; range: ProtocolRange }> = [];
  for (let index = importsIndex + 1; index < tokens.length; index++) {
    const token = tokens[index];
    if (IMPORT_STOP_KEYWORDS.has(token.value)) {
      break;
    }
    if (!PUNCTUATION.has(token.value)) {
      imports.push({ name: token.value, range: token.range });
    }
  }

  return imports;
}

export function extractImportLinks(
  source: string,
  sourcePath: string | undefined,
  sessions: DiscoveredSession[]
): IsabelleImportLink[] {
  return extractImportTokens(source)
    .map((importToken) => {
      const targetPath = resolveImportTargetPath(importToken.name, sourcePath, sessions);
      return targetPath
        ? {
            ...importToken,
            targetPath
          }
        : undefined;
    })
    .filter(isImportLink);
}

export function resolveImportTargetPath(
  importName: string,
  sourcePath: string | undefined,
  sessions: DiscoveredSession[]
): string | undefined {
  const theories = collectTheories(sessions);
  const byNormalizedPath = new Map(
    theories.map((theory) => [normalizePath(theory.path), theory])
  );
  const sessionsByName = new Map(sessions.map((session) => [session.name, session]));
  const source = sourcePath ? byNormalizedPath.get(normalizePath(sourcePath)) : undefined;

  if (sourcePath && /[\\/]/.test(importName)) {
    const withExtension = path.extname(importName) === ".thy" ? importName : `${importName}.thy`;
    const candidate = path.resolve(path.dirname(sourcePath), withExtension);
    const discovered = byNormalizedPath.get(normalizePath(candidate));
    if (discovered) {
      return discovered.path;
    }
  }

  const qualified = splitKnownSessionPrefix(importName, sessionsByName);
  if (qualified) {
    return findInSession(theories, qualified.sessionName, qualified.theoryName, source?.path);
  }

  if (source) {
    return (
      findInSession(theories, source.sessionName, importName, source.path) ??
      findInRelatedSessions(theories, sessionsByName, source.sessionName, importName)
    );
  }

  return findUniqueGlobal(theories, importName);
}

function tokenizeHeader(source: string): HeaderToken[] {
  const tokens: HeaderToken[] = [];
  const position = { line: 0, character: 0 };
  let index = 0;
  let commentDepth = 0;

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (index === 0 && char === "\uFEFF") {
      advance(char, position);
      index++;
      continue;
    }

    if (commentDepth > 0) {
      if (char === "(" && next === "*") {
        commentDepth++;
        advance("(*", position);
        index += 2;
      } else if (char === "*" && next === ")") {
        commentDepth--;
        advance("*)", position);
        index += 2;
      } else {
        advance(char, position);
        index++;
      }
      continue;
    }

    if (char === "(" && next === "*") {
      commentDepth++;
      advance("(*", position);
      index += 2;
      continue;
    }

    if (/\s/.test(char)) {
      advance(char, position);
      index++;
      continue;
    }

    if (char === "\"") {
      const token = readQuotedToken(source, index, position);
      tokens.push(token.token);
      index = token.nextIndex;
      continue;
    }

    if (PUNCTUATION.has(char)) {
      const start = copyPosition(position);
      advance(char, position);
      tokens.push({ value: char, range: { start, end: copyPosition(position) } });
      index++;
      continue;
    }

    const start = copyPosition(position);
    let value = "";
    while (
      index < source.length &&
      !/\s/.test(source[index]) &&
      !PUNCTUATION.has(source[index]) &&
      !(source[index] === "(" && source[index + 1] === "*")
    ) {
      value += source[index];
      advance(source[index], position);
      index++;
    }
    tokens.push({ value, range: { start, end: copyPosition(position) } });
  }

  return tokens;
}

function readQuotedToken(
  source: string,
  startIndex: number,
  position: { line: number; character: number }
): { token: HeaderToken; nextIndex: number } {
  advance("\"", position);
  let index = startIndex + 1;
  const start = copyPosition(position);
  let value = "";

  while (index < source.length) {
    const char = source[index];
    if (char === "\\" && index + 1 < source.length) {
      value += source[index + 1];
      advance(source.slice(index, index + 2), position);
      index += 2;
      continue;
    }
    if (char === "\"") {
      const end = copyPosition(position);
      advance("\"", position);
      return {
        token: { value, range: { start, end } },
        nextIndex: index + 1
      };
    }
    value += char;
    advance(char, position);
    index++;
  }

  return {
    token: { value, range: { start, end: copyPosition(position) } },
    nextIndex: index
  };
}

function collectTheories(sessions: DiscoveredSession[]): TheoryRecord[] {
  return sessions.flatMap((session) =>
    session.theories.flatMap((theory) => {
      if (typeof theory.path !== "string" || theory.path.length === 0) {
        return [];
      }
      return [{
        sessionName: session.name,
        theoryName: theory.name,
        path: theory.path
      }];
    })
  );
}

function splitKnownSessionPrefix(
  importName: string,
  sessionsByName: Map<string, DiscoveredSession>
): { sessionName: string; theoryName: string } | undefined {
  for (const sessionName of [...sessionsByName.keys()].sort((left, right) => right.length - left.length)) {
    const prefix = `${sessionName}.`;
    if (importName.startsWith(prefix)) {
      return {
        sessionName,
        theoryName: importName.slice(prefix.length)
      };
    }
  }
  return undefined;
}

function findInRelatedSessions(
  theories: TheoryRecord[],
  sessionsByName: Map<string, DiscoveredSession>,
  sourceSessionName: string,
  importName: string
): string | undefined {
  const sourceSession = sessionsByName.get(sourceSessionName);
  if (!sourceSession) {
    return undefined;
  }

  for (const dependency of sessionDependencies(sourceSession).sort()) {
    const match = findInSession(theories, dependency, importName);
    if (match) {
      return match;
    }
  }

  return undefined;
}

function findInSession(
  theories: TheoryRecord[],
  sessionName: string,
  importName: string,
  excludePath?: string
): string | undefined {
  const candidates = theories.filter(
    (theory) => theory.sessionName === sessionName && (!excludePath || normalizePath(theory.path) !== normalizePath(excludePath))
  );
  return findExact(candidates, importName) ?? findUniqueBaseName(candidates, importName);
}

function findExact(theories: TheoryRecord[], importName: string): string | undefined {
  return theories.find((theory) => theory.theoryName === importName)?.path;
}

function findUniqueBaseName(theories: TheoryRecord[], importName: string): string | undefined {
  const importBase = baseTheoryName(importName);
  const matches = theories.filter((theory) => baseTheoryName(theory.theoryName) === importBase);
  return matches.length === 1 ? matches[0].path : undefined;
}

function findUniqueGlobal(theories: TheoryRecord[], importName: string): string | undefined {
  return findExact(theories, importName) ?? findUniqueBaseName(theories, importName);
}

function sessionDependencies(session: DiscoveredSession): string[] {
  return [...new Set([session.parent, ...session.importedSessions].filter(isString))];
}

function baseTheoryName(theoryName: string): string {
  const normalized = theoryName.replace(/\\/g, "/").replace(/\.thy$/, "");
  const pathBase = normalized.includes("/") ? normalized.slice(normalized.lastIndexOf("/") + 1) : normalized;
  return pathBase.includes(".") ? pathBase.slice(pathBase.lastIndexOf(".") + 1) : pathBase;
}

function normalizePath(value: string): string {
  const normalized = path.resolve(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function advance(text: string, position: { line: number; character: number }): void {
  for (const char of text) {
    if (char === "\n") {
      position.line++;
      position.character = 0;
    } else {
      position.character++;
    }
  }
}

function copyPosition(position: { line: number; character: number }): { line: number; character: number } {
  return {
    line: position.line,
    character: position.character
  };
}

function isString(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

function isImportLink(value: IsabelleImportLink | undefined): value is IsabelleImportLink {
  return value !== undefined;
}
