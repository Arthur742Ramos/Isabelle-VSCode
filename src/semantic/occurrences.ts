/**
 * Source-only "occurrence" finder for Isabelle theory files.
 *
 * Given a cursor position, this locates every other occurrence of the same
 * identifier in the document — the data behind VS Code's
 * `DocumentHighlightProvider` (the subtle highlight you get on every copy of the
 * name you click on). It is purely lexical and needs no running prover, so it
 * works the instant a `.thy` file opens.
 *
 * Matching is **whole-token** and Isabelle-aware:
 *   * the content of `(* *)` comments, cartouches (`\<open>..\<close>` and the
 *     rendered `‹..›`), and quoted `"..."` strings is masked out (via the shared
 *     {@link maskNonProofText}), so an occurrence inside prose or inner syntax is
 *     not highlighted; and
 *   * a token is a maximal run of identifier characters including Isabelle symbol
 *     escapes (`\<alpha>`, `\<^sub>`), Unicode letters/digits, `_`, `'`, and `.`
 *     — so `xs` does not match inside `xs'` or `xs.foo`, matching the editor's
 *     word model used elsewhere in the foundation.
 *
 * This module is free of any `vscode` import so it can be unit tested under
 * vitest; offsets are UTF-16 code-unit indices into the original source,
 * matching VS Code's position model.
 */

import { maskNonProofText } from "../audit/proofGapScanner";
import { isCommandKeyword } from "./isabelleSyntax";

export type OccurrenceKind = "text" | "write";

export interface Occurrence {
  /** UTF-16 offset of the token start in the original source. */
  readonly offset: number;
  /** Length of the matched token. */
  readonly length: number;
  /** `write` for a declaring occurrence (e.g. the name after `definition`), else `text`. */
  readonly kind: OccurrenceKind;
}

// A single Isabelle identifier token: a maximal run of symbol escapes in their
// ASCII spelling (`\<alpha>`, `\<^sub>`) plus Unicode letters/digits and `_ ' .`.
// `.` keeps qualified names (`List.map`) whole; primes keep `xs'` whole.
//
// NOTE: every consumer builds its OWN RegExp from this source rather than
// sharing one global instance — a global regex carries mutable `lastIndex`
// state, and reusing one across the nested scans below would corrupt the outer
// scan's position and loop forever.
const IDENTIFIER_TOKEN_SOURCE = "(?:\\\\<\\^?[A-Za-z]+>|[\\p{L}\\p{N}_'.])+";

function identifierTokenRegex(): RegExp {
  return new RegExp(IDENTIFIER_TOKEN_SOURCE, "gu");
}

/**
 * The identifier token covering `character` on the masked line, or `undefined`
 * if the cursor is not on a code identifier (e.g. inside a comment/string, on
 * whitespace, or on punctuation).
 */
export function identifierTokenAt(
  maskedLine: string,
  character: number
): { token: string; start: number; end: number } | undefined {
  const regex = identifierTokenRegex();
  let match: RegExpExecArray | null;
  while ((match = regex.exec(maskedLine)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    // Half-open at the end so a cursor *between* two adjacent tokens picks the
    // left one only when it is actually inside it; `character <= end` lets the
    // cursor sit just past the last char (VS Code reports that position when you
    // double-click the final character).
    if (character >= start && character <= end) {
      return { token: match[0], start, end };
    }
  }
  return undefined;
}

/**
 * Find every whole-token occurrence of the identifier under `cursorOffset` in
 * `source`. Returns an empty array when the cursor is not on a code identifier,
 * or when the token is an Isabelle command keyword (highlighting every `by` or
 * `lemma` in a file is noise, not insight).
 *
 * The occurrence that the cursor sits on is included. An occurrence is marked
 * `write` when it immediately follows a name-declaring command on its line
 * (e.g. the `foo` in `definition foo`), so the editor can render the definition
 * differently from its uses.
 */
export function findOccurrences(source: string, cursorOffset: number): Occurrence[] {
  const masked = maskNonProofText(source);
  if (cursorOffset < 0 || cursorOffset > masked.length) {
    return [];
  }

  const target = identifierTokenAt(masked, cursorOffset);
  if (!target) {
    return [];
  }
  // Don't highlight bare command keywords — there is no single "this identifier"
  // to track, and lighting up every `by` / `qed` is just noise.
  if (isCommandKeyword(target.token)) {
    return [];
  }

  return findTokenOccurrencesInMasked(masked, source, target.token);
}

/**
 * The Isabelle identifier token at `cursorOffset` in a full `source`, masking
 * comments / cartouches / strings first, or `undefined` if the cursor is not on
 * a code identifier. The returned offsets are into the original source.
 */
export function identifierAt(
  source: string,
  cursorOffset: number
): { token: string; start: number; end: number } | undefined {
  const masked = maskNonProofText(source);
  if (cursorOffset < 0 || cursorOffset > masked.length) {
    return undefined;
  }
  // identifierTokenAt scans the whole masked source (offsets are absolute,
  // matching the original since masking preserves length).
  return identifierTokenAt(masked, cursorOffset);
}

/**
 * Every whole-token occurrence of the exact identifier `token` in `source`,
 * with comments / cartouches / strings masked out. Used for cross-file
 * reference search, where the target token comes from another document.
 */
export function findTokenOccurrences(source: string, token: string): Occurrence[] {
  if (token.length === 0) {
    return [];
  }
  return findTokenOccurrencesInMasked(maskNonProofText(source), source, token);
}

function findTokenOccurrencesInMasked(masked: string, source: string, token: string): Occurrence[] {
  const lineStarts = computeLineStarts(source);
  const occurrences: Occurrence[] = [];
  const regex = identifierTokenRegex();
  let match: RegExpExecArray | null;
  while ((match = regex.exec(masked)) !== null) {
    if (match[0] !== token) {
      continue;
    }
    const offset = match.index;
    occurrences.push({
      offset,
      length: match[0].length,
      kind: isDeclaringOccurrence(masked, lineStarts, offset) ? "write" : "text"
    });
  }
  return occurrences;
}

/**
 * Whether the token at `offset` is the *name* introduced by a name-declaring
 * command on the same line — i.e. the first identifier token after a declaring
 * keyword, with only whitespace / type-parameter / target syntax in between.
 * Conservative: it only treats the token as a declaration when the declaring
 * keyword is the first token of the line.
 */
function isDeclaringOccurrence(masked: string, lineStarts: readonly number[], offset: number): boolean {
  const line = offsetToLine(lineStarts, offset);
  const lineStart = lineStarts[line];
  const lineEnd = line + 1 < lineStarts.length ? lineStarts[line + 1] : masked.length;
  const lineText = masked.slice(lineStart, lineEnd);
  const columnOfToken = offset - lineStart;

  // The first identifier token on the line must be a name-declaring keyword.
  const regex = identifierTokenRegex();
  const first = regex.exec(lineText);
  if (!first || !DECLARING_KEYWORDS.has(first[0]) || first.index >= columnOfToken) {
    return false;
  }

  // The next identifier token after the keyword must be exactly this token —
  // everything in between (whitespace, type parameters, `(in ...)` targets) is
  // skipped by the token regex automatically. If a different identifier token
  // intervenes, this token is not the declared name.
  const between = regex.exec(lineText);
  if (!between) {
    return false;
  }
  return between.index === columnOfToken;
}

// Commands whose first following identifier is a navigable declared name. Kept
// aligned with the `declaresName` entries in isabelleSyntax.ts that introduce a
// single primary name worth treating as a definition.
const DECLARING_KEYWORDS: ReadonlySet<string> = new Set([
  "definition",
  "abbreviation",
  "fun",
  "function",
  "primrec",
  "primcorec",
  "inductive",
  "inductive_set",
  "coinductive",
  "datatype",
  "codatatype",
  "type_synonym",
  "typedecl",
  "typedef",
  "record",
  "lift_definition",
  "lemmas",
  "named_theorems",
  "lemma",
  "theorem",
  "corollary",
  "proposition",
  "schematic_goal",
  "locale",
  "class"
]);

function computeLineStarts(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index++) {
    if (source[index] === "\n") {
      starts.push(index + 1);
    }
  }
  return starts;
}

function offsetToLine(lineStarts: readonly number[], offset: number): number {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (lineStarts[mid] <= offset) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return low;
}
