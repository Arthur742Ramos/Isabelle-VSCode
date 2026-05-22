// Pure validator for "did this Sledgehammer-suggested proof regress the
// theory?" — used by `SledgehammerPanel` after an inserted suggestion to
// surface a warning + Undo affordance when the inserted proof broke the
// surrounding theory.
//
// The validator is intentionally vscode-free: it consumes simple
// `ValidationDiagnostic` snapshots so vitest can pin every regression
// branch without spinning up a real language client. Production code
// adapts `vscode.Diagnostic[]` into this shape at the call site.
//
// Heuristic at a glance:
//   1. Baseline diagnostics whose `startLine >= insertionLine` are
//      line-shifted by `insertedLineCount` so a pre-existing error that
//      simply slid down past the insertion isn't reported as "new".
//   2. A post-edit diagnostic counts as a regression when:
//      - severity is `error`
//      - its (severity, source, normalized message, startLine, startCharacter)
//        tuple does NOT appear in the shifted baseline set
//      - its `startLine >= insertionLine` (PIDE errors propagate forward
//        from the broken proof; pre-insertion errors are pre-existing).
//   3. The result is a discriminated union so the caller can branch
//      cleanly between "no regression", "regression with details", and
//      "validation timed out / still settling".

export type ValidationSeverity = "error" | "warning" | "info" | "hint";

export interface ValidationPosition {
  readonly line: number;
  readonly character: number;
}

export interface ValidationRange {
  readonly start: ValidationPosition;
  readonly end: ValidationPosition;
}

/**
 * Minimal subset of `vscode.Diagnostic` the validator needs. Production
 * code adapts via `adaptVscodeDiagnostic` (kept at the call site so this
 * module stays vscode-free).
 */
export interface ValidationDiagnostic {
  readonly severity: ValidationSeverity;
  readonly message: string;
  readonly range: ValidationRange;
  /**
   * Diagnostic source (e.g. `"isabelle"` for the LSP relay). Used in the
   * dedupe key so an unrelated `"isabelle build"` diagnostic that
   * happens to overlap doesn't suppress a real PIDE regression.
   */
  readonly source?: string;
}

export type ValidationOutcome =
  | { readonly kind: "no-regression" }
  | {
      readonly kind: "regression";
      readonly newErrors: readonly ValidationDiagnostic[];
    }
  | { readonly kind: "still-processing" };

export interface ValidateInsertionInputs {
  /** Diagnostics captured immediately before the edit was applied. */
  readonly baseline: readonly ValidationDiagnostic[];
  /** Diagnostics captured after the post-edit debounce settled. */
  readonly post: readonly ValidationDiagnostic[];
  /** Zero-based line where the proof text was inserted. */
  readonly insertionLine: number;
  /**
   * Number of lines added by the insertion. Used to line-shift any
   * pre-existing baseline diagnostic at or after `insertionLine` so a
   * stable old error that simply slid down isn't reported as "new".
   */
  readonly insertedLineCount: number;
}

/**
 * Decide whether a Sledgehammer-suggested proof inserted at
 * `insertionLine` caused new error diagnostics to appear. See the
 * module-level comment for the heuristic.
 */
export function validateInsertedProof(
  inputs: ValidateInsertionInputs
): ValidationOutcome {
  const shifted = shiftBaselineForInsertion(
    inputs.baseline,
    inputs.insertionLine,
    inputs.insertedLineCount
  );
  const shiftedKeys = new Set(shifted.map(diagnosticKey));

  const newErrors: ValidationDiagnostic[] = [];
  for (const candidate of inputs.post) {
    if (candidate.severity !== "error") continue;
    if (candidate.range.start.line < inputs.insertionLine) continue;
    if (shiftedKeys.has(diagnosticKey(candidate))) continue;
    newErrors.push(candidate);
  }

  if (newErrors.length === 0) {
    return { kind: "no-regression" };
  }
  return { kind: "regression", newErrors };
}

/**
 * Shift any baseline diagnostic whose start sits at or after the
 * insertion line by `insertedLineCount`. Diagnostics strictly before
 * the insertion line are unaffected.
 */
export function shiftBaselineForInsertion(
  baseline: readonly ValidationDiagnostic[],
  insertionLine: number,
  insertedLineCount: number
): ValidationDiagnostic[] {
  if (insertedLineCount === 0) {
    return baseline.slice();
  }
  return baseline.map((diagnostic) => {
    const startLine = diagnostic.range.start.line;
    if (startLine < insertionLine) {
      return diagnostic;
    }
    return {
      ...diagnostic,
      range: {
        start: {
          line: startLine + insertedLineCount,
          character: diagnostic.range.start.character
        },
        end: {
          line: diagnostic.range.end.line + insertedLineCount,
          character: diagnostic.range.end.character
        }
      }
    };
  });
}

/**
 * Build the dedupe key the validator uses to decide whether a
 * post-edit diagnostic is genuinely new. The key intentionally
 * includes `source` so that an `isabelle build` diagnostic that
 * happens to land on the same line as an `isabelle` LSP diagnostic
 * does not silently suppress a real regression.
 */
export function diagnosticKey(diagnostic: ValidationDiagnostic): string {
  const source = diagnostic.source ?? "";
  const message = normalizeMessage(diagnostic.message);
  return [
    diagnostic.severity,
    source,
    diagnostic.range.start.line,
    diagnostic.range.start.character,
    message
  ].join("\u0000");
}

/**
 * Normalize whitespace inside a diagnostic message so trivial
 * re-elaboration formatting differences (extra spaces, line wrapping)
 * do not break the dedupe key.
 */
export function normalizeMessage(message: string): string {
  return message.replace(/\s+/gu, " ").trim();
}

/**
 * Number of lines added by an insertion of `text` (i.e. one less than
 * the number of `\n`-separated lines, treating `\r\n` as `\n`).
 * Lives in this pure module so the SledgehammerPanel adapter can stay
 * vscode-bound while validator-relevant arithmetic is testable under
 * vitest.
 */
export function countInsertedLines(text: string): number {
  const normalized = text.replace(/\r\n/gu, "\n");
  return normalized.split("\n").length - 1;
}

/**
 * Compute the post-insertion end position for a text inserted at
 * `start` (zero-based line/character). Returned positions are
 * `{line, character}` records rather than vscode.Position so the
 * helper stays vscode-free; the panel adapter wraps them in a
 * `vscode.Range` at the call site.
 */
export function computeInsertedEnd(
  start: ValidationPosition,
  text: string
): ValidationPosition {
  const normalized = text.replace(/\r\n/gu, "\n");
  const lines = normalized.split("\n");
  if (lines.length === 1) {
    return { line: start.line, character: start.character + lines[0]!.length };
  }
  return {
    line: start.line + lines.length - 1,
    character: lines[lines.length - 1]!.length
  };
}
