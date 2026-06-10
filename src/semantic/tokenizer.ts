import { getCommandInfo } from "./isabelleSyntax";

export type SemanticTokenType = "keyword" | "function" | "variable" | "typeParameter" | "operator";
export type SemanticTokenModifier = "declaration";

export interface IsabelleSemanticToken {
  line: number;
  character: number;
  length: number;
  type: SemanticTokenType;
  modifiers?: SemanticTokenModifier[];
}

const WORD = /\b[A-Za-z_][A-Za-z0-9_']*(?![A-Za-z0-9_'])/g;
const SCHEMATIC_VARIABLE = /\?[A-Za-z_][A-Za-z0-9_']*/g;
const TYPE_VARIABLE = /'[A-Za-z_][A-Za-z0-9_']*/g;
const SYMBOL_ESCAPE = /\\<[^>]+>/g;

export function tokenizeSemanticLine(lineText: string, line: number): IsabelleSemanticToken[] {
  const tokens: IsabelleSemanticToken[] = [];
  const command = firstCommandToken(lineText);

  if (command) {
    tokens.push({
      line,
      character: command.index,
      length: command.keyword.length,
      type: "keyword"
    });

    const commandInfo = getCommandInfo(command.keyword);
    if (commandInfo?.declaresName) {
      const declaration = declarationNameAfter(lineText, command.index + command.keyword.length);
      if (declaration && declaration.word !== "fixes" && declaration.word !== "assumes" && declaration.word !== "shows") {
        tokens.push({
          line,
          character: declaration.index,
          length: declaration.word.length,
          type: "function",
          modifiers: ["declaration"]
        });
      }
    }
  }

  collectMatches(SCHEMATIC_VARIABLE, lineText, line, "variable", tokens);
  collectMatches(TYPE_VARIABLE, lineText, line, "typeParameter", tokens);
  collectMatches(SYMBOL_ESCAPE, lineText, line, "operator", tokens);

  return tokens.sort((left, right) => left.character - right.character || left.length - right.length);
}

function firstCommandToken(lineText: string): { keyword: string; index: number } | undefined {
  WORD.lastIndex = 0;
  let match = WORD.exec(lineText);
  while (match) {
    if (getCommandInfo(match[0])) {
      return {
        keyword: match[0],
        index: match.index
      };
    }
    match = WORD.exec(lineText);
  }
  return undefined;
}

// Matches a leading type parameter (`'a`, `'a::ord`) at the start of a string.
const LEADING_TYPE_VARIABLE = /^'[A-Za-z_][A-Za-z0-9_']*(?:\s*::\s*[A-Za-z_][A-Za-z0-9_'.]*)?/;

/**
 * Find the declared name introduced by a name-declaring command, starting at
 * `offset` (just past the keyword). Unlike a bare next-word scan, this:
 *
 *   * stops at the first `"` (so a word inside a quoted proposition — e.g. the
 *     `x` in `have "x = y"` or the `True` in `lemma "True"` — is never marked as
 *     a declaration name), and
 *   * skips a leading type parameter or `(in locale)` target so the *name* is
 *     found in `datatype 'a list` (→ `list`) and `lemma (in monoid) e` (→ `e`).
 *
 * Mirrors the span-level `commandNameAfter` policy so highlighting and the
 * outline agree on what the name is. Single-line, matching the tokenizer.
 */
function declarationNameAfter(lineText: string, offset: number): { word: string; index: number } | undefined {
  const rest = lineText.slice(offset);
  const quoteIndex = rest.indexOf('"');
  const searchable = quoteIndex >= 0 ? rest.slice(0, quoteIndex) : rest;

  let cursor = 0;
  // Skip leading whitespace, type parameters, and parenthesised targets/tuples.
  for (;;) {
    while (cursor < searchable.length && /\s/.test(searchable[cursor])) {
      cursor += 1;
    }
    const tail = searchable.slice(cursor);
    const typeVar = LEADING_TYPE_VARIABLE.exec(tail);
    if (typeVar) {
      cursor += typeVar[0].length;
      continue;
    }
    if (searchable[cursor] === "(") {
      const close = matchingParenIndex(searchable, cursor);
      if (close < 0) {
        return undefined;
      }
      cursor = close + 1;
      continue;
    }
    break;
  }

  WORD.lastIndex = cursor;
  const match = WORD.exec(searchable);
  return match ? { word: match[0], index: offset + match.index } : undefined;
}

/** Index of the `)` closing the `(` at `open`, or -1 if unbalanced within the string. */
function matchingParenIndex(text: string, open: number): number {
  let depth = 0;
  for (let index = open; index < text.length; index++) {
    if (text[index] === "(") {
      depth += 1;
    } else if (text[index] === ")") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function collectMatches(
  regex: RegExp,
  lineText: string,
  line: number,
  type: SemanticTokenType,
  tokens: IsabelleSemanticToken[]
): void {
  regex.lastIndex = 0;
  let match = regex.exec(lineText);
  while (match) {
    tokens.push({
      line,
      character: match.index,
      length: match[0].length,
      type
    });
    match = regex.exec(lineText);
  }
}
