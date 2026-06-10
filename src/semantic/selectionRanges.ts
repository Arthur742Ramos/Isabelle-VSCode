/**
 * Smart-selection ("expand / shrink selection", Alt+Shift+Arrow) ranges for
 * Isabelle theory files.
 *
 * Given a cursor offset, this returns a nested chain of ranges from the
 * innermost meaningful span outward, so each press of "Expand Selection" grows
 * the selection to the next syntactic unit:
 *
 *   identifier token  ⊂  quoted term / cartouche  ⊂  command span  ⊂
 *   enclosing `begin … end` block or `proof … qed`  ⊂  whole document
 *
 * It is purely lexical (built on the same command-span extraction and the
 * comment/cartouche/string masking used elsewhere), so it works with no prover
 * or language server.
 *
 * This module is free of any `vscode` import so it can be unit tested under
 * vitest; offsets are UTF-16 code-unit indices into the original source.
 */

import { extractCommandSpans } from "../document/commandSpans";
import { computeIsabelleFoldingRanges } from "./foldingRanges";
import { maskNonProofText } from "../audit/proofGapScanner";

export interface OffsetRange {
  /** UTF-16 offset of the range start (inclusive). */
  readonly start: number;
  /** UTF-16 offset of the range end (exclusive). */
  readonly end: number;
}

const IDENTIFIER_TOKEN_SOURCE = "(?:\\\\<\\^?[A-Za-z]+>|[\\p{L}\\p{N}_'.])+";

/**
 * Build the nested selection chain for `cursorOffset` in `source`, innermost
 * first. Each range strictly contains the previous one; duplicate or empty
 * ranges are dropped. Always ends with the whole document when non-empty.
 */
export function selectionRangesAt(source: string, cursorOffset: number): OffsetRange[] {
  if (source.length === 0) {
    return [];
  }
  const offset = clamp(cursorOffset, 0, source.length);
  const candidates: OffsetRange[] = [];

  // 1. Identifier token under the cursor (code only).
  const masked = maskNonProofText(source);
  const token = identifierTokenAt(masked, offset);
  if (token) {
    candidates.push(token);
  }

  // 2. Quoted term / cartouche containing the cursor.
  const enclosingQuoted = enclosingDelimitedSpan(source, offset);
  if (enclosingQuoted) {
    candidates.push(enclosingQuoted);
  }

  // 3. The command span containing the cursor.
  const lineStarts = computeLineStarts(source);
  for (const span of commandSpanRanges(source, lineStarts)) {
    if (span.start <= offset && offset <= span.end) {
      candidates.push(span);
      break;
    }
  }

  // 4. Enclosing structural folds (proof / begin..end / heading), innermost-out.
  for (const fold of foldRanges(source, lineStarts)) {
    if (fold.start <= offset && offset <= fold.end) {
      candidates.push(fold);
    }
  }

  // 5. Whole document.
  candidates.push({ start: 0, end: source.length });

  return tighteningChain(candidates, offset);
}

/** The identifier token covering `character` in `maskedLine`, absolute offsets. */
function identifierTokenAt(maskedSource: string, character: number): OffsetRange | undefined {
  const regex = new RegExp(IDENTIFIER_TOKEN_SOURCE, "gu");
  let match: RegExpExecArray | null;
  while ((match = regex.exec(maskedSource)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (character >= start && character <= end) {
      return { start, end };
    }
  }
  return undefined;
}

/**
 * The innermost quoted `"..."` string or cartouche (`‹..›` or
 * `\<open>..\<close>`) whose interior contains `offset`, or `undefined`. The
 * returned range spans the delimiters and their content. A single forward scan
 * tracks the enclosing delimiter; it does not need to be a full parser because
 * selection-expand only needs the immediately-enclosing region.
 */
function enclosingDelimitedSpan(source: string, offset: number): OffsetRange | undefined {
  const ASCII_OPEN = "\\<open>";
  const ASCII_CLOSE = "\\<close>";
  const U_OPEN = "‹"; // ‹
  const U_CLOSE = "›"; // ›

  type Frame = { start: number; close: string };
  const stack: Frame[] = [];
  let inString = false;
  let stringStart = -1;
  let index = 0;

  while (index < source.length) {
    if (inString) {
      if (source[index] === "\\") {
        index += 2;
        continue;
      }
      if (source[index] === '"') {
        const end = index + 1;
        if (stringStart < offset && offset < end) {
          return { start: stringStart, end };
        }
        inString = false;
        index += 1;
        continue;
      }
      index += 1;
      continue;
    }

    if (stack.length > 0) {
      if (source.startsWith(ASCII_OPEN, index)) {
        stack.push({ start: index, close: ASCII_CLOSE });
        index += ASCII_OPEN.length;
        continue;
      }
      if (source[index] === U_OPEN) {
        stack.push({ start: index, close: U_CLOSE });
        index += 1;
        continue;
      }
      const top = stack[stack.length - 1];
      if (source.startsWith(top.close, index)) {
        const end = index + top.close.length;
        if (top.start < offset && offset < end) {
          return { start: top.start, end };
        }
        stack.pop();
        index += top.close.length;
        continue;
      }
      index += 1;
      continue;
    }

    // top-level code
    if (source.startsWith(ASCII_OPEN, index)) {
      stack.push({ start: index, close: ASCII_CLOSE });
      index += ASCII_OPEN.length;
      continue;
    }
    if (source[index] === U_OPEN) {
      stack.push({ start: index, close: U_CLOSE });
      index += 1;
      continue;
    }
    if (source[index] === '"') {
      inString = true;
      stringStart = index;
      index += 1;
      continue;
    }
    index += 1;
  }
  return undefined;
}

function commandSpanRanges(source: string, lineStarts: readonly number[]): OffsetRange[] {
  return extractCommandSpans("mem://selection", source, 0)
    .map((span) => ({
      start: positionToOffset(lineStarts, span.range.start.line, span.range.start.character),
      end: positionToOffset(lineStarts, span.range.end.line, span.range.end.character)
    }))
    .filter((range) => range.end > range.start);
}

function foldRanges(source: string, lineStarts: readonly number[]): OffsetRange[] {
  return computeIsabelleFoldingRanges(source)
    .map((fold) => {
      const start = lineStarts[fold.start] ?? 0;
      const endLineStart = lineStarts[fold.end] ?? source.length;
      const endLineEnd = fold.end + 1 < lineStarts.length ? lineStarts[fold.end + 1] - 1 : source.length;
      void endLineStart;
      return { start, end: endLineEnd };
    })
    .filter((range) => range.end > range.start)
    // Innermost (smallest) first so the chain grows outward.
    .sort((left, right) => right.start - left.start || left.end - right.end);
}

/**
 * Reduce `candidates` (in rough innermost-to-outermost order) to a strictly
 * growing chain that each contains `offset`: drop ranges not covering the
 * cursor, sort by size ascending, and remove duplicates / non-nesting overlaps.
 */
function tighteningChain(candidates: readonly OffsetRange[], offset: number): OffsetRange[] {
  const covering = candidates
    .filter((range) => range.start <= offset && offset <= range.end && range.end > range.start)
    .sort((left, right) => size(left) - size(right) || left.start - right.start);

  const chain: OffsetRange[] = [];
  for (const range of covering) {
    const last = chain[chain.length - 1];
    if (!last) {
      chain.push(range);
      continue;
    }
    if (range.start === last.start && range.end === last.end) {
      continue; // duplicate
    }
    // Keep only ranges that strictly contain the previous one.
    if (range.start <= last.start && range.end >= last.end && size(range) > size(last)) {
      chain.push(range);
    }
  }
  return chain;
}

function size(range: OffsetRange): number {
  return range.end - range.start;
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function computeLineStarts(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index++) {
    if (source[index] === "\n") {
      starts.push(index + 1);
    }
  }
  return starts;
}

function positionToOffset(lineStarts: readonly number[], line: number, character: number): number {
  const base = lineStarts[line] ?? lineStarts[lineStarts.length - 1] ?? 0;
  return base + character;
}
