import * as vscode from "vscode";
import { findTokenOccurrences, identifierAt, Occurrence } from "./occurrences";
import { isCommandKeyword } from "./isabelleSyntax";

/**
 * Offline reference provider ("Find All References" / Shift+F12) for Isabelle
 * identifiers.
 *
 * Given the identifier under the cursor, it finds every whole-token, code-only
 * occurrence of that name across the open theory documents and the workspace's
 * `.thy` files — the same lexical model the occurrence highlighter uses,
 * extended cross-file. Purely lexical (no prover), so it works the instant a
 * `.thy` opens. When `context.includeDeclaration` is false, the declaring
 * occurrences (the name after `definition` / `lemma` / …) are omitted.
 *
 * This is a name-based reference search, not a scope-resolved one: it cannot
 * distinguish two unrelated constants that happen to share a name. That
 * semantic precision needs the prover; this is the honest local approximation.
 */
export class IsabelleReferenceProvider implements vscode.ReferenceProvider {
  private static readonly MAX_FILES = 2000;
  private capWarningEmitted = false;

  public constructor(private readonly output?: vscode.OutputChannel) {}

  public async provideReferences(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.ReferenceContext,
    token: vscode.CancellationToken
  ): Promise<vscode.Location[]> {
    const target = identifierAt(document.getText(), document.offsetAt(position));
    if (!target || isCommandKeyword(target.token)) {
      return [];
    }

    const locations: vscode.Location[] = [];
    const seenUris = new Set<string>();

    // 1. Open theory documents (buffer content reflects unsaved edits).
    for (const open of vscode.workspace.textDocuments) {
      if (!isTheoryDocument(open)) {
        continue;
      }
      seenUris.add(open.uri.toString());
      appendLocations(locations, open.uri, open.getText(), target.token, context.includeDeclaration);
    }

    // 2. Remaining workspace `.thy` files from disk.
    const files = await vscode.workspace.findFiles(
      "**/*.thy",
      "**/{node_modules,.git,.vscode-test}/**",
      IsabelleReferenceProvider.MAX_FILES,
      token
    );
    if (files.length === IsabelleReferenceProvider.MAX_FILES && !this.capWarningEmitted) {
      // findFiles truncates at the cap, so the reference list may be incomplete
      // in a very large workspace. Warn once so users know.
      this.capWarningEmitted = true;
      this.output?.appendLine(
        `Isabelle references: reached the ${IsabelleReferenceProvider.MAX_FILES}-file scan cap; ` +
          "some references may be missing in this workspace."
      );
    }
    for (const file of files) {
      if (token.isCancellationRequested) {
        break;
      }
      if (seenUris.has(file.toString())) {
        continue;
      }
      try {
        const bytes = await vscode.workspace.fs.readFile(file);
        appendLocations(
          locations,
          file,
          Buffer.from(bytes).toString("utf8"),
          target.token,
          context.includeDeclaration
        );
      } catch {
        // Unreadable (permissions / removed between listing and read) — skip.
      }
    }

    return locations;
  }
}

function appendLocations(
  out: vscode.Location[],
  uri: vscode.Uri,
  text: string,
  token: string,
  includeDeclaration: boolean
): void {
  const lineStarts = computeLineStarts(text);
  for (const occurrence of findTokenOccurrences(text, token)) {
    if (!includeDeclaration && occurrence.kind === "write") {
      continue;
    }
    out.push(new vscode.Location(uri, occurrenceRange(lineStarts, occurrence)));
  }
}

function occurrenceRange(lineStarts: readonly number[], occurrence: Occurrence): vscode.Range {
  const start = offsetToPosition(lineStarts, occurrence.offset);
  const end = offsetToPosition(lineStarts, occurrence.offset + occurrence.length);
  return new vscode.Range(start.line, start.character, end.line, end.character);
}

function computeLineStarts(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index++) {
    if (text[index] === "\n") {
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

function isTheoryDocument(document: vscode.TextDocument): boolean {
  return document.languageId === "isabelle" || document.uri.fsPath.endsWith(".thy");
}
