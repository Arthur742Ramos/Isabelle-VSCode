/**
 * Source-only folding-range computation for Isabelle theory files.
 *
 * Prover-independent: this works purely on the editor's text, so structural
 * folding is available to every user the instant a `.thy` file opens —
 * regardless of whether the optional Isabelle language server or the Scala
 * backend is running, and without a live Isabelle install.
 *
 * Five structural elements fold:
 *   1. Multi-line block comments `(* ... *)` (nesting-aware).
 *   2. Structured Isar proofs (`proof ... qed`, nesting-aware).
 *   3. `begin ... end` blocks — locale / class / instantiation / context /
 *      notepad bodies (nesting-aware). The outermost pair is the theory body
 *      itself and is intentionally NOT folded (its preamble is covered by 5).
 *   4. The document-heading hierarchy (`chapter` / `section` / `subsection` /
 *      `subsubsection` / `paragraph` / `subparagraph`): each heading folds the
 *      lines beneath it down to the next heading of the same or higher level
 *      (or the end of the theory body).
 *   5. The theory header (`theory ... begin`) when it spans multiple lines, so
 *      a long `imports` / `keywords` preamble can collapse to its `theory` line.
 *
 * Before looking for keywords the scanner masks the content of comments,
 * Isabelle cartouches (ASCII `\<open>` / `\<close>` and the rendered Unicode
 * `‹` / `›`), and quoted `"..."` strings, so a `proof`, `qed`, or `section`
 * written inside prose, inner syntax, or a string literal is never mistaken for
 * a command. This mirrors the lexical philosophy of `audit/proofGapScanner.ts`.
 *
 * The module is intentionally free of any `vscode` import so it can be unit
 * tested under vitest. Line numbers and offsets are zero-based and use UTF-16
 * code units, matching VS Code's position model.
 */

export type IsabelleFoldingKind = "comment" | "region" | "imports";

export interface IsabelleFoldingRange {
  /** Zero-based start line; this line stays visible when the region is folded. */
  readonly start: number;
  /** Zero-based end line; the last line hidden when the region is folded. */
  readonly end: number;
  readonly kind: IsabelleFoldingKind;
}

// Isabelle name token, symbol-escape aware. A single token is a run of:
//   * Isabelle symbol escapes in their on-disk ASCII spelling, e.g. `\<alpha>`,
//     `\<^sub>` (these glue subscripted/Greek identifiers together so that
//     `x\<^sub>section` or `\<alpha>proof` read as one identifier, not a command);
//   * Unicode letters/digits and `_ ' .` (`.` keeps qualified names whole).
// Matching keywords against whole tokens (rather than via `\b`) avoids treating
// `\<^sub>section` or `myproof` as a `section` / `proof` command.
const IDENTIFIER_TOKEN = /(?:\\<\^?[A-Za-z]+>|[\p{L}\p{N}_'.])+/gu;

const ASCII_CARTOUCHE_OPEN = "\\<open>";
const ASCII_CARTOUCHE_CLOSE = "\\<close>";
const UNICODE_CARTOUCHE_OPEN = "\u2039"; // ‹
const UNICODE_CARTOUCHE_CLOSE = "\u203a"; // ›

/** Document-heading commands mapped to their nesting level (smaller = outer). */
const HEADING_LEVELS: ReadonlyMap<string, number> = new Map([
  ["chapter", 1],
  ["section", 2],
  ["subsection", 3],
  ["subsubsection", 4],
  ["paragraph", 5],
  ["subparagraph", 6]
]);

// Command keywords this module cares about. Restricting the token scan to this
// set keeps the hot loop cheap on large theories.
const FOLD_KEYWORDS: ReadonlySet<string> = new Set<string>([
  "theory",
  "begin",
  "end",
  "imports",
  "proof",
  "qed",
  ...HEADING_LEVELS.keys()
]);

type MaskState = "code" | "comment" | "string" | "cartouche";

interface CommentSpan {
  readonly startLine: number;
  readonly endLine: number;
}

interface IsabelleLayout {
  /** Code with comment / string / cartouche content blanked to spaces. */
  readonly masked: string;
  /** Outermost block-comment spans, as zero-based inclusive line ranges. */
  readonly commentSpans: readonly CommentSpan[];
  /** Line-start offsets, computed once here and reused by the caller. */
  readonly lineStarts: readonly number[];
}

interface CommandToken {
  readonly word: string;
  /** UTF-16 offset of the token start in the original source. */
  readonly offset: number;
}

/**
 * Single-pass lexer. Produces the masked code view used for keyword detection
 * plus the line ranges of block comments (the one piece masking alone cannot
 * recover, since blanked comments are indistinguishable from blank code).
 */
function scanIsabelleLayout(source: string): IsabelleLayout {
  const out: string[] = source.split("");
  const length = source.length;
  const lineStarts = computeLineStarts(source);
  const commentSpans: CommentSpan[] = [];

  let state: MaskState = "code";
  let commentDepth = 0;
  let cartoucheDepth = 0;
  let commentStartOffset = -1;
  let index = 0;

  const blank = (from: number, to: number): void => {
    for (let position = from; position < to && position < length; position++) {
      const char = out[position];
      if (char !== "\n" && char !== "\r") {
        out[position] = " ";
      }
    }
  };

  while (index < length) {
    if (state === "code") {
      if (source.startsWith(ASCII_CARTOUCHE_OPEN, index)) {
        blank(index, index + ASCII_CARTOUCHE_OPEN.length);
        state = "cartouche";
        cartoucheDepth = 1;
        index += ASCII_CARTOUCHE_OPEN.length;
        continue;
      }
      if (source[index] === UNICODE_CARTOUCHE_OPEN) {
        blank(index, index + 1);
        state = "cartouche";
        cartoucheDepth = 1;
        index += 1;
        continue;
      }
      if (source[index] === "(" && source[index + 1] === "*") {
        commentStartOffset = index;
        blank(index, index + 2);
        state = "comment";
        commentDepth = 1;
        index += 2;
        continue;
      }
      if (source[index] === '"') {
        blank(index, index + 1);
        state = "string";
        index += 1;
        continue;
      }
      index += 1;
      continue;
    }

    if (state === "comment") {
      if (source[index] === "(" && source[index + 1] === "*") {
        blank(index, index + 2);
        commentDepth += 1;
        index += 2;
        continue;
      }
      if (source[index] === "*" && source[index + 1] === ")") {
        blank(index, index + 2);
        commentDepth -= 1;
        index += 2;
        if (commentDepth === 0) {
          commentSpans.push({
            startLine: offsetToLine(lineStarts, commentStartOffset),
            endLine: offsetToLine(lineStarts, index - 1)
          });
          state = "code";
        }
        continue;
      }
      blank(index, index + 1);
      index += 1;
      continue;
    }

    if (state === "string") {
      if (source[index] === "\\") {
        const span = index + 1 < length ? 2 : 1;
        blank(index, index + span);
        index += span;
        continue;
      }
      if (source[index] === '"') {
        blank(index, index + 1);
        state = "code";
        index += 1;
        continue;
      }
      blank(index, index + 1);
      index += 1;
      continue;
    }

    // state === "cartouche"
    if (source.startsWith(ASCII_CARTOUCHE_OPEN, index)) {
      blank(index, index + ASCII_CARTOUCHE_OPEN.length);
      cartoucheDepth += 1;
      index += ASCII_CARTOUCHE_OPEN.length;
      continue;
    }
    if (source[index] === UNICODE_CARTOUCHE_OPEN) {
      blank(index, index + 1);
      cartoucheDepth += 1;
      index += 1;
      continue;
    }
    if (source.startsWith(ASCII_CARTOUCHE_CLOSE, index)) {
      blank(index, index + ASCII_CARTOUCHE_CLOSE.length);
      cartoucheDepth -= 1;
      index += ASCII_CARTOUCHE_CLOSE.length;
      if (cartoucheDepth === 0) {
        state = "code";
      }
      continue;
    }
    if (source[index] === UNICODE_CARTOUCHE_CLOSE) {
      blank(index, index + 1);
      cartoucheDepth -= 1;
      index += 1;
      if (cartoucheDepth === 0) {
        state = "code";
      }
      continue;
    }
    blank(index, index + 1);
    index += 1;
  }

  return { masked: out.join(""), commentSpans, lineStarts };
}

function collectCommandTokens(masked: string): CommandToken[] {
  const tokens: CommandToken[] = [];
  IDENTIFIER_TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = IDENTIFIER_TOKEN.exec(masked)) !== null) {
    const word = match[0];
    if (FOLD_KEYWORDS.has(word)) {
      tokens.push({ word, offset: match.index });
    }
  }
  return tokens;
}

/**
 * Compute the structural folding ranges for an Isabelle theory `source`.
 *
 * Ranges are returned sorted by start line (ascending), then by end line
 * (descending) so an outer region precedes the inner regions it contains. Every
 * returned range spans at least two lines (`end > start`); single-line
 * constructs never produce a fold.
 */
export function computeIsabelleFoldingRanges(source: string): IsabelleFoldingRange[] {
  const { masked, commentSpans, lineStarts } = scanIsabelleLayout(source);
  const tokens = collectCommandTokens(masked);
  const ranges: IsabelleFoldingRange[] = [];

  // 1. Multi-line block comments.
  for (const span of commentSpans) {
    if (span.endLine > span.startLine) {
      ranges.push({ start: span.startLine, end: span.endLine, kind: "comment" });
    }
  }

  // 2. Structured proofs: pair each `proof` with its matching `qed` via a stack
  //    so nested proofs each fold independently.
  const proofStartLines: number[] = [];
  for (const token of tokens) {
    if (token.word === "proof") {
      proofStartLines.push(offsetToLine(lineStarts, token.offset));
    } else if (token.word === "qed") {
      const startLine = proofStartLines.pop();
      if (startLine !== undefined) {
        const endLine = offsetToLine(lineStarts, token.offset);
        if (endLine > startLine) {
          ranges.push({ start: startLine, end: endLine, kind: "region" });
        }
      }
    }
  }

  // 2b. `begin … end` blocks (locale / class / instantiation / context /
  //     notepad bodies). Pair each `begin` with its matching `end` via a stack
  //     so nested blocks fold independently. The theory body's own
  //     `begin … end` is NOT folded — folding the whole body is unhelpful and
  //     its preamble is already covered by the header fold (pass 4). The theory
  //     body's `begin` is identified precisely as the first `begin` that follows
  //     the `theory` keyword, so a standalone `context`/`locale` fragment with
  //     no theory header still folds.
  const theoryTokenForBody = tokens.find((token) => token.word === "theory");
  const theoryBodyBeginLine =
    theoryTokenForBody !== undefined
      ? tokens
          .filter((token) => token.word === "begin" && token.offset > theoryTokenForBody.offset)
          .map((token) => offsetToLine(lineStarts, token.offset))
          .shift()
      : undefined;
  const beginStartLines: number[] = [];
  for (const token of tokens) {
    if (token.word === "begin") {
      beginStartLines.push(offsetToLine(lineStarts, token.offset));
    } else if (token.word === "end") {
      const startLine = beginStartLines.pop();
      if (startLine !== undefined && startLine !== theoryBodyBeginLine) {
        const endLine = offsetToLine(lineStarts, token.offset);
        if (endLine > startLine) {
          ranges.push({ start: startLine, end: endLine, kind: "region" });
        }
      }
    }
  }

  // 3. Heading hierarchy: a heading folds the body beneath it until the next
  //    heading of the same or higher level, else the last meaningful line.
  const headings = tokens
    .filter((token) => HEADING_LEVELS.has(token.word))
    .map((token) => ({ level: HEADING_LEVELS.get(token.word) as number, line: offsetToLine(lineStarts, token.offset) }));
  const lastContentLine = lastNonEmptyLine(source, lineStarts);
  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    let endLine = lastContentLine;
    for (let j = i + 1; j < headings.length; j++) {
      if (headings[j].level <= heading.level) {
        endLine = headings[j].line - 1;
        break;
      }
    }
    if (endLine > heading.line) {
      ranges.push({ start: heading.line, end: endLine, kind: "region" });
    }
  }

  // 4. Theory header: from the `theory` line to the line above the body `begin`.
  const theoryToken = tokens.find((token) => token.word === "theory");
  if (theoryToken) {
    const beginToken = tokens.find((token) => token.word === "begin" && token.offset > theoryToken.offset);
    if (beginToken) {
      const startLine = offsetToLine(lineStarts, theoryToken.offset);
      const endLine = offsetToLine(lineStarts, beginToken.offset) - 1;
      if (endLine > startLine) {
        ranges.push({ start: startLine, end: endLine, kind: "imports" });
      }
    }
  }

  return dedupeAndSort(ranges);
}

function dedupeAndSort(ranges: readonly IsabelleFoldingRange[]): IsabelleFoldingRange[] {
  const seen = new Set<string>();
  const unique: IsabelleFoldingRange[] = [];
  for (const range of ranges) {
    const key = `${range.start}:${range.end}:${range.kind}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(range);
    }
  }
  unique.sort((left, right) => (left.start !== right.start ? left.start - right.start : right.end - left.end));
  return unique;
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

/** Zero-based index of the last line whose source text is not blank. */
function lastNonEmptyLine(source: string, lineStarts: readonly number[]): number {
  let line = lineStarts.length - 1;
  while (line > 0) {
    const from = lineStarts[line];
    const to = line + 1 < lineStarts.length ? lineStarts[line + 1] : source.length;
    if (source.slice(from, to).trim() !== "") {
      break;
    }
    line -= 1;
  }
  return line;
}
