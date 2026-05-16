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
      const declaration = firstWordAfter(lineText, command.index + command.keyword.length);
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

function firstWordAfter(lineText: string, offset: number): { word: string; index: number } | undefined {
  WORD.lastIndex = offset;
  const match = WORD.exec(lineText);
  return match
    ? {
        word: match[0],
        index: match.index
      }
    : undefined;
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
