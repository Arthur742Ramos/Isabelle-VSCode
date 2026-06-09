/**
 * Source-only proof-gap scanner.
 *
 * Detects `sorry` (admits a goal, yielding an unsound theorem) and `oops`
 * (abandons a proof) directly from Isabelle theory text, with **no dependency on
 * a running prover**. It is a lexical, best-effort heuristic inspired by the
 * source-only theory index in the sibling `isa-blueprint` project (MIT) and,
 * upstream of that, `ott2/isabelle-query` (MIT).
 *
 * Everything here is textual: the scanner masks the content of `(* *)` comments,
 * Isabelle cartouches (`\<open>..\<close>` and the rendered `‹..›` forms), and
 * quoted `"..."` strings so that a `sorry` written inside prose, an `ML`/`text`
 * block, or an inner-syntax term is not mistaken for a proof command. Treat the
 * findings as a strong hint, not ground truth — the authoritative proof status
 * still comes from Isabelle/PIDE.
 *
 * This module is intentionally free of any `vscode` import so it can be unit
 * tested under vitest; offsets are UTF-16 code-unit indices into the original
 * source, matching VS Code's position model.
 */

export type ProofGapKind = "sorry" | "oops";

export interface ProofGapFinding {
  readonly kind: ProofGapKind;
  /** UTF-16 code-unit offset of the token start in the original source. */
  readonly offset: number;
  /** Zero-based line of the token start. */
  readonly line: number;
  /** Zero-based UTF-16 character within the line. */
  readonly character: number;
  /** Length of the matched token (`5` for `sorry`, `4` for `oops`). */
  readonly length: number;
}

export type ProofGapSeverity = "warning" | "information";

export interface ProofGapDiagnostic {
  readonly kind: ProofGapKind;
  readonly offset: number;
  readonly line: number;
  readonly character: number;
  readonly length: number;
  readonly severity: ProofGapSeverity;
  readonly message: string;
}

/**
 * `source` label applied to every proof-gap `vscode.Diagnostic`. Kept distinct
 * from the CLI-build and LSP diagnostic sources so VS Code aggregates the
 * per-owner diagnostics in the Problems panel instead of overwriting them.
 */
export const PROOF_GAP_DIAGNOSTIC_SOURCE = "isabelle proof-gap";

/**
 * Name of the dedicated `vscode.DiagnosticCollection` for proof-gap findings.
 * A distinct owner identity means these diagnostics coexist with build/LSP
 * diagnostics for the same file rather than replacing them.
 */
export const PROOF_GAP_DIAGNOSTIC_COLLECTION_NAME = "isabelle-proof-gaps";

// Isabelle name token, used to decide whether `sorry` / `oops` stands alone as
// a proof command rather than being part of a longer identifier.
//
// A single token is a run of:
//   * Isabelle symbol escapes in their on-disk ASCII spelling, e.g. `\<alpha>`,
//     `\<^sub>` (these glue subscripted/Greek identifiers together so that
//     `x\<^sub>sorry` or `\<alpha>sorry` read as one identifier, not a `sorry`
//     command); plus
//   * Unicode letters/digits and `_ ' .` — `.` keeps qualified names such as
//     `Foo.sorry` whole; Unicode letters keep already-rendered identifiers such
//     as `αsorry` whole.
//
// The alternation only ever advances (each branch consumes ≥ 1 char and a failed
// escape match falls through to the single-character class), so there is no
// catastrophic-backtracking risk.
const IDENTIFIER_TOKEN = /(?:\\<\^?[A-Za-z]+>|[\p{L}\p{N}_'.])+/gu;

const ASCII_CARTOUCHE_OPEN = "\\<open>";
const ASCII_CARTOUCHE_CLOSE = "\\<close>";
const UNICODE_CARTOUCHE_OPEN = "\u2039"; // ‹
const UNICODE_CARTOUCHE_CLOSE = "\u203a"; // ›

type MaskState = "code" | "comment" | "string" | "cartouche";

/**
 * Replace the content of comments, cartouches, and quoted strings with spaces,
 * preserving total length and newline characters so a match offset in the
 * returned string maps directly onto the same offset in `source`.
 */
export function maskNonProofText(source: string): string {
  const out: string[] = source.split("");
  const length = source.length;

  let state: MaskState = "code";
  let commentDepth = 0;
  let cartoucheDepth = 0;
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

  return out.join("");
}

/**
 * Scan `source` for `sorry` / `oops` proof-command tokens, ignoring any that
 * appear inside comments, cartouches, or quoted strings.
 */
export function scanProofGaps(source: string): ProofGapFinding[] {
  const masked = maskNonProofText(source);
  const lineStarts = computeLineStarts(source);
  const findings: ProofGapFinding[] = [];

  IDENTIFIER_TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = IDENTIFIER_TOKEN.exec(masked)) !== null) {
    const token = match[0];
    if (token !== "sorry" && token !== "oops") {
      continue;
    }
    const offset = match.index;
    const position = offsetToPosition(lineStarts, offset);
    findings.push({
      kind: token,
      offset,
      line: position.line,
      character: position.character,
      length: token.length
    });
  }

  return findings;
}

const SORRY_MESSAGE =
  "`sorry` admits this goal without proof; the resulting theorem is unsound until the gap is discharged.";
const OOPS_MESSAGE = "`oops` abandons this proof; the lemma is not added to the theory.";

/**
 * Map raw findings onto diagnostic-ready records. `sorry` is a warning (it
 * silently admits an unsound theorem), `oops` is informational (it abandons the
 * proof without adding a fact).
 */
export function buildProofGapDiagnostics(findings: readonly ProofGapFinding[]): ProofGapDiagnostic[] {
  return findings.map((finding) => ({
    kind: finding.kind,
    offset: finding.offset,
    line: finding.line,
    character: finding.character,
    length: finding.length,
    severity: finding.kind === "sorry" ? "warning" : "information",
    message: finding.kind === "sorry" ? SORRY_MESSAGE : OOPS_MESSAGE
  }));
}

/**
 * Convenience wrapper: scan and map in one call.
 */
export function findProofGapDiagnostics(source: string): ProofGapDiagnostic[] {
  return buildProofGapDiagnostics(scanProofGaps(source));
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

function offsetToPosition(lineStarts: readonly number[], offset: number): { line: number; character: number } {
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
  return { line: low, character: offset - lineStarts[low] };
}
