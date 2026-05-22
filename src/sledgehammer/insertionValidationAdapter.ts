// vscode-aware adapter layer that bridges the (pure) insertion
// validator and (vscode-free) watcher to live VS Code APIs. Kept
// separate so the validator + watcher stay testable under vitest while
// the wiring inside `SledgehammerPanel` is a thin call site.

import * as vscode from "vscode";
import {
  DiagnosticsSource,
  InsertionValidationDisposable
} from "./insertionValidationWatcher";
import {
  computeInsertedEnd,
  ValidationDiagnostic,
  ValidationSeverity
} from "./proofInsertValidation";

/**
 * Map a `vscode.DiagnosticSeverity` to the pure validator's enum.
 * Hostile values default to `"info"` so an unknown severity never
 * accidentally registers as a regression.
 */
export function mapVscodeSeverity(severity: vscode.DiagnosticSeverity): ValidationSeverity {
  switch (severity) {
    case vscode.DiagnosticSeverity.Error:
      return "error";
    case vscode.DiagnosticSeverity.Warning:
      return "warning";
    case vscode.DiagnosticSeverity.Information:
      return "info";
    case vscode.DiagnosticSeverity.Hint:
      return "hint";
    default:
      return "info";
  }
}

/** Adapt a single `vscode.Diagnostic` into the validator's shape. */
export function adaptVscodeDiagnostic(diagnostic: vscode.Diagnostic): ValidationDiagnostic {
  return {
    severity: mapVscodeSeverity(diagnostic.severity),
    message: diagnostic.message,
    source: diagnostic.source,
    range: {
      start: {
        line: diagnostic.range.start.line,
        character: diagnostic.range.start.character
      },
      end: {
        line: diagnostic.range.end.line,
        character: diagnostic.range.end.character
      }
    }
  };
}

/**
 * Snapshot diagnostics for a single URI as `ValidationDiagnostic[]`.
 * Returns an empty array if the URI does not parse or no diagnostics
 * exist.
 */
export function getValidationDiagnostics(uri: string): ValidationDiagnostic[] {
  let parsed: vscode.Uri;
  try {
    parsed = vscode.Uri.parse(uri, true);
  } catch {
    return [];
  }
  return vscode.languages.getDiagnostics(parsed).map(adaptVscodeDiagnostic);
}

/**
 * Build a `DiagnosticsSource` backed by the live `vscode.languages`
 * surface. Pass to `InsertionValidationWatcher`.
 */
export function createVscodeDiagnosticsSource(): DiagnosticsSource {
  return {
    getDiagnostics: (uri) => getValidationDiagnostics(uri),
    onDidChangeDiagnostics: (handler) => {
      const subscription = vscode.languages.onDidChangeDiagnostics((event) => {
        const changedUris = event.uris.map((u) => u.toString());
        handler(changedUris);
      });
      return adaptDisposable(subscription);
    }
  };
}

function adaptDisposable(disposable: vscode.Disposable): InsertionValidationDisposable {
  return {
    dispose: () => {
      disposable.dispose();
    }
  };
}

/**
 * Compute the `vscode.Range` covered by an insertion starting at
 * `start` whose text is `text`. Used both to know how many lines were
 * inserted (for the validator's line-shift compensation) and to know
 * the exact range to delete if the user chooses to undo.
 *
 * The computation treats `\n` as the line separator; documents with
 * `\r\n` line endings are handled because VS Code reports positions
 * in UTF-16 code units and `\r` counts as a code unit. Carriage
 * returns inside the inserted text are normalized out so the count
 * matches what the document sees after the edit.
 */
export function computeInsertedRange(start: vscode.Position, text: string): vscode.Range {
  const end = computeInsertedEnd(
    { line: start.line, character: start.character },
    text
  );
  return new vscode.Range(start, new vscode.Position(end.line, end.character));
}

// Re-export the pure helper so the panel can import a single barrel.
export { countInsertedLines } from "./proofInsertValidation";
