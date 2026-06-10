/**
 * Pure matching for the Isabelle workspace-symbol search (Ctrl-T / "Go to
 * Symbol in Workspace").
 *
 * Given a query string and the named entities of one or more theories, this
 * ranks the entities that match the query, so the VS Code
 * `WorkspaceSymbolProvider` can present them. It is purely lexical and operates
 * on the entities already produced by `extractTheoryEntities`, so it needs no
 * prover or language server.
 *
 * Matching is case-insensitive and **subsequence-based** (the characters of the
 * query appear in order within the name — the same model VS Code's own quick-open
 * uses), with a small ranking that prefers a prefix match, then a contiguous
 * substring, then a scattered subsequence, and breaks ties by shorter name then
 * alphabetical order. An empty query matches everything (VS Code asks for the
 * full set to seed the picker).
 *
 * This module is free of any `vscode` import so it can be unit tested under
 * vitest.
 */

import { IsabelleEntityKind, IsabelleTheoryEntity } from "./theoryEntities";

export interface WorkspaceSymbolEntity extends IsabelleTheoryEntity {
  /** URI of the theory the entity belongs to. */
  readonly uri: string;
}

export interface RankedWorkspaceSymbol {
  readonly entity: WorkspaceSymbolEntity;
  /** Lower is better. */
  readonly score: number;
}

/**
 * Rank `entities` against `query`, returning the matches best-first. A blank
 * query returns every entity (alphabetised). Non-matching entities are dropped.
 */
export function matchWorkspaceSymbols(
  query: string,
  entities: readonly WorkspaceSymbolEntity[]
): WorkspaceSymbolEntity[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return [...entities].sort(byNameThenUri);
  }

  const needle = trimmed.toLowerCase();
  const ranked: RankedWorkspaceSymbol[] = [];
  for (const entity of entities) {
    const score = matchScore(needle, entity.name.toLowerCase());
    if (score !== null) {
      ranked.push({ entity, score });
    }
  }

  ranked.sort((left, right) => {
    if (left.score !== right.score) {
      return left.score - right.score;
    }
    return byNameThenUri(left.entity, right.entity);
  });
  return ranked.map((item) => item.entity);
}

/**
 * Score how well `needle` (already lower-cased) matches `name` (already
 * lower-cased): `0` for a prefix match, `1` for a contiguous substring, `2` for
 * a scattered in-order subsequence, or `null` for no match.
 */
export function matchScore(needle: string, name: string): number | null {
  if (name.startsWith(needle)) {
    return 0;
  }
  if (name.includes(needle)) {
    return 1;
  }
  return isSubsequence(needle, name) ? 2 : null;
}

/** Whether every char of `needle` appears in `haystack` in order. */
function isSubsequence(needle: string, haystack: string): boolean {
  let index = 0;
  for (const char of haystack) {
    if (char === needle[index]) {
      index += 1;
      if (index === needle.length) {
        return true;
      }
    }
  }
  return needle.length === 0;
}

function byNameThenUri(left: WorkspaceSymbolEntity, right: WorkspaceSymbolEntity): number {
  if (left.name !== right.name) {
    return left.name < right.name ? -1 : 1;
  }
  if (left.uri !== right.uri) {
    return left.uri < right.uri ? -1 : 1;
  }
  return left.range.start.line - right.range.start.line;
}

/**
 * The VS Code-flavoured symbol-kind name for a theory entity kind, kept aligned
 * with the document-symbol provider's mapping so the workspace picker and the
 * in-file outline agree on icons.
 */
export function workspaceSymbolKind(kind: IsabelleEntityKind): WorkspaceSymbolKind {
  switch (kind) {
    case "theorem":
    case "lemma":
    case "corollary":
    case "proposition":
    case "schematic_goal":
      return "method";
    case "definition":
    case "abbreviation":
    case "fun":
    case "function":
    case "primrec":
    case "primcorec":
    case "inductive":
    case "inductive_set":
    case "coinductive":
    case "lift_definition":
      return "function";
    case "datatype":
    case "codatatype":
      return "enum";
    case "record":
      return "struct";
    case "typedef":
    case "typedecl":
    case "type_synonym":
      return "interface";
    case "locale":
    case "class":
      return "class";
    case "section":
    case "subsection":
    case "subsubsection":
      return "namespace";
    case "theory":
      return "module";
    default:
      return "variable";
  }
}

export type WorkspaceSymbolKind =
  | "method"
  | "function"
  | "enum"
  | "struct"
  | "interface"
  | "class"
  | "namespace"
  | "module"
  | "variable";
