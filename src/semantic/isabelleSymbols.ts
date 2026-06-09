/**
 * Offline Isabelle symbol support.
 *
 * Pure, `vscode`-free helpers built on the authoritative {@link ISABELLE_SYMBOL_TABLE}
 * (generated from Isabelle's own `etc/symbols`). These power the signature
 * Isabelle editing experience — entering and reading the special symbols such as
 * `\<forall>` (∀) or `\<Longrightarrow>` (⟹) — **without a running prover**, so it
 * works the instant a `.thy` file opens.
 *
 * Two capabilities live here:
 *   1. Completion: detect a partially typed symbol token at the cursor and offer
 *      the matching Isabelle symbols ({@link findSymbolCompletionContext}).
 *   2. Lookup: resolve a symbol token or rendered glyph to its full entry, for
 *      hovers and conversion ({@link resolveSymbolByName}, {@link resolveSymbolByGlyph}).
 *
 * Offsets are UTF-16 code-unit indices, matching VS Code's position model;
 * iteration that must respect astral-plane glyphs (e.g. `\<zero>` → 𝟬) uses code
 * points explicitly.
 */

import { ISABELLE_SYMBOL_TABLE, IsabelleSymbolEntry } from "./isabelleSymbolData";

export interface ResolvedIsabelleSymbol {
  readonly name: string;
  readonly code: number | null;
  /** Rendered glyph (may be a surrogate pair), or `null` for markup-only symbols. */
  readonly glyph: string | null;
  readonly abbrevs: readonly string[];
  readonly group: string | null;
}

function resolve(entry: IsabelleSymbolEntry): ResolvedIsabelleSymbol {
  return {
    name: entry.name,
    code: entry.code,
    glyph: entry.code == null ? null : String.fromCodePoint(entry.code),
    abbrevs: entry.abbrevs,
    group: entry.group
  };
}

const BY_NAME = new Map<string, ResolvedIsabelleSymbol>();
const BY_GLYPH = new Map<string, ResolvedIsabelleSymbol>();
const ALL: ResolvedIsabelleSymbol[] = [];

for (const entry of ISABELLE_SYMBOL_TABLE) {
  const resolved = resolve(entry);
  BY_NAME.set(resolved.name, resolved);
  if (resolved.glyph !== null && !BY_GLYPH.has(resolved.glyph)) {
    BY_GLYPH.set(resolved.glyph, resolved);
  }
  ALL.push(resolved);
}

/** Every Isabelle symbol, in the table's canonical order. */
export const ALL_ISABELLE_SYMBOLS: readonly ResolvedIsabelleSymbol[] = ALL;

/** Total number of symbols in the table (computed, never hard-coded in docs). */
export const ISABELLE_SYMBOL_COUNT = ALL.length;

/** Resolve a full symbol token such as `\<forall>`. */
export function resolveSymbolByName(name: string): ResolvedIsabelleSymbol | undefined {
  return BY_NAME.get(name);
}

/** Resolve a rendered glyph such as `∀` back to its symbol entry. */
export function resolveSymbolByGlyph(glyph: string): ResolvedIsabelleSymbol | undefined {
  return BY_GLYPH.get(glyph);
}

export interface SymbolCompletionContext {
  /** UTF-16 column where the replacement should begin (the leading backslash). */
  readonly replaceStart: number;
  /** The partial symbol name already typed (without the leading `\<` or `^`). */
  readonly query: string;
}

// A trailing, not-yet-closed Isabelle symbol token at the cursor. Anchored to
// the end of the pre-cursor text so it only fires while the token is open.
// Either the bracketed form `\<`, optionally with a control caret `\<^`, then a
// partial name — or the no-bracket shorthand `\name`. The control caret is only
// accepted after `<`, because Isabelle control symbols are written `\<^...>`
// (so a bare `\^foo` must NOT trigger symbol completion).
const OPEN_TOKEN = /\\(?:<(?:\^)?([A-Za-z][A-Za-z0-9_]*)?|([A-Za-z][A-Za-z0-9_]*)?)$/;

/**
 * If the cursor sits at the end of a partially typed symbol token, return the
 * replacement range start and the query typed so far; otherwise `undefined`.
 *
 * Fires for `\`, `\<`, `\<fora`, `\<^bo`, and the no-bracket shorthand `\fora`.
 * Does not fire for `\^foo` (not a valid Isabelle symbol prefix).
 */
export function findSymbolCompletionContext(
  lineText: string,
  character: number
): SymbolCompletionContext | undefined {
  const before = lineText.slice(0, character);
  const match = OPEN_TOKEN.exec(before);
  if (!match) {
    return undefined;
  }
  return {
    replaceStart: character - match[0].length,
    query: match[1] ?? match[2] ?? ""
  };
}

/**
 * Searchable text for a symbol: its bare name plus every abbreviation, so VS
 * Code's fuzzy filter matches whether the user types the name (`\<forall>`,
 * `forall`) or an ASCII abbreviation (`ALL`, `!`).
 */
export function symbolFilterText(symbol: ResolvedIsabelleSymbol): string {
  const bareName = symbol.name.replace(/^\\</, "").replace(/>$/, "");
  return [symbol.name, bareName, ...symbol.abbrevs].join(" ");
}

// Any `\<...>` symbol token, including the control caret form `\<^...>`.
const SYMBOL_TOKEN = /\\<\^?[A-Za-z][A-Za-z0-9_]*>/g;

/**
 * Replace every Isabelle symbol token that has a glyph with that glyph, e.g.
 * `\<forall>` → `∀`. Tokens with no glyph (markup-only symbols) and any token
 * not in the table are left untouched. Inverse of {@link symbolsToAscii}.
 */
export function symbolsToUnicode(text: string): string {
  return text.replace(SYMBOL_TOKEN, (token) => {
    const symbol = BY_NAME.get(token);
    return symbol && symbol.glyph !== null ? symbol.glyph : token;
  });
}

/**
 * Replace every rendered Isabelle glyph with its ASCII symbol token, e.g. `∀` →
 * `\<forall>`. Ordinary ASCII text and any non-symbol character are left
 * untouched. Inverse of {@link symbolsToUnicode}.
 *
 * Iterates by Unicode code point so astral-plane glyphs (e.g. `𝟬` for
 * `\<zero>`) are matched as a single character.
 */
export function symbolsToAscii(text: string): string {
  const out: string[] = [];
  for (const char of text) {
    const symbol = BY_GLYPH.get(char);
    out.push(symbol ? symbol.name : char);
  }
  return out.join("");
}
