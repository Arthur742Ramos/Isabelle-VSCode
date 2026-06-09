import * as vscode from "vscode";
import {
  buildProofGapDiagnostics,
  PROOF_GAP_DIAGNOSTIC_COLLECTION_NAME,
  PROOF_GAP_DIAGNOSTIC_SOURCE,
  ProofGapDiagnostic,
  scanProofGaps
} from "./proofGapScanner";

const SCAN_DEBOUNCE_MS = 75;
const ENABLED_CONFIG_KEY = "isabelle.audit.proofGaps.enabled";

/**
 * Publishes offline `sorry` / `oops` proof-gap diagnostics for open Isabelle
 * theory documents.
 *
 * This is a purely lexical audit (see {@link scanProofGaps}) that runs without a
 * prover, so it surfaces unsound/abandoned proofs the moment a file is opened or
 * edited — complementing, not replacing, the authoritative PIDE/build checks.
 * Findings live in their own {@link vscode.DiagnosticCollection} so they coexist
 * with build and LSP diagnostics for the same file.
 */
export class ProofGapAuditService implements vscode.Disposable {
  private readonly diagnostics: vscode.DiagnosticCollection;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private enabled: boolean;

  public constructor(private readonly output: vscode.OutputChannel) {
    this.diagnostics = vscode.languages.createDiagnosticCollection(PROOF_GAP_DIAGNOSTIC_COLLECTION_NAME);
    this.enabled = readEnabledSetting();
  }

  public start(): void {
    this.disposables.push(
      this.diagnostics,
      vscode.workspace.onDidOpenTextDocument((document) => this.scheduleScan(document)),
      vscode.workspace.onDidChangeTextDocument((event) => this.scheduleScan(event.document)),
      vscode.workspace.onDidSaveTextDocument((document) => this.scheduleScan(document)),
      vscode.workspace.onDidCloseTextDocument((document) => this.forget(document)),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(ENABLED_CONFIG_KEY)) {
          this.applyEnabledSetting();
        }
      })
    );

    this.auditAllOpenDocuments();
  }

  /**
   * Manual command entry point. Re-scans every open theory document and reports
   * a one-line summary to the user.
   */
  public auditOpenDocuments(): void {
    if (!this.enabled) {
      vscode.window.showInformationMessage(
        "Isabelle proof-gap audit is disabled. Enable `isabelle.audit.proofGaps.enabled` to run it."
      );
      return;
    }

    const theoryDocuments = vscode.workspace.textDocuments.filter(isTheoryDocument);
    let totalGaps = 0;
    let filesWithGaps = 0;

    for (const document of theoryDocuments) {
      const count = this.scanNow(document);
      if (count > 0) {
        totalGaps += count;
        filesWithGaps += 1;
      }
    }

    if (theoryDocuments.length === 0) {
      vscode.window.showInformationMessage("Open an Isabelle theory to audit for proof gaps.");
      return;
    }

    if (totalGaps === 0) {
      vscode.window.showInformationMessage(
        `No \`sorry\`/\`oops\` proof gaps found across ${theoryDocuments.length} open theory file(s).`
      );
      return;
    }

    vscode.window.showWarningMessage(
      `Found ${totalGaps} proof gap(s) across ${filesWithGaps} theory file(s). See the Problems panel.`
    );
  }

  public dispose(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
  }

  private applyEnabledSetting(): void {
    const next = readEnabledSetting();
    if (next === this.enabled) {
      return;
    }
    this.enabled = next;
    if (this.enabled) {
      this.auditAllOpenDocuments();
    } else {
      this.clearAllTimers();
      this.diagnostics.clear();
    }
  }

  private auditAllOpenDocuments(): void {
    if (!this.enabled) {
      return;
    }
    for (const document of vscode.workspace.textDocuments) {
      if (isTheoryDocument(document)) {
        this.scanNow(document);
      }
    }
  }

  private scheduleScan(document: vscode.TextDocument): void {
    if (!this.enabled || !isTheoryDocument(document)) {
      return;
    }

    const key = document.uri.toString();
    const existing = this.debounceTimers.get(key);
    if (existing) {
      clearTimeout(existing);
    }
    this.debounceTimers.set(
      key,
      setTimeout(() => {
        this.debounceTimers.delete(key);
        const current = vscode.workspace.textDocuments.find((candidate) => candidate.uri.toString() === key);
        if (current && isTheoryDocument(current)) {
          this.scanNow(current);
        }
      }, SCAN_DEBOUNCE_MS)
    );
  }

  private scanNow(document: vscode.TextDocument): number {
    try {
      const diagnostics = buildProofGapDiagnostics(scanProofGaps(document.getText()));
      this.diagnostics.set(document.uri, diagnostics.map((finding) => this.toVscodeDiagnostic(document, finding)));
      return diagnostics.length;
    } catch (error) {
      this.output.appendLine(`[proof-gap] Failed to scan ${document.uri.fsPath}: ${describeError(error)}`);
      this.diagnostics.delete(document.uri);
      return 0;
    }
  }

  private toVscodeDiagnostic(document: vscode.TextDocument, finding: ProofGapDiagnostic): vscode.Diagnostic {
    const start = document.positionAt(finding.offset);
    const end = document.positionAt(finding.offset + finding.length);
    const diagnostic = new vscode.Diagnostic(
      new vscode.Range(start, end),
      finding.message,
      finding.severity === "warning"
        ? vscode.DiagnosticSeverity.Warning
        : vscode.DiagnosticSeverity.Information
    );
    diagnostic.source = PROOF_GAP_DIAGNOSTIC_SOURCE;
    diagnostic.code = finding.kind;
    return diagnostic;
  }

  private forget(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    const timer = this.debounceTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.debounceTimers.delete(key);
    }
    this.diagnostics.delete(document.uri);
  }

  private clearAllTimers(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }
}

function readEnabledSetting(): boolean {
  return vscode.workspace.getConfiguration("isabelle.audit.proofGaps").get<boolean>("enabled", true);
}

function isTheoryDocument(document: vscode.TextDocument): boolean {
  return document.languageId === "isabelle" || document.uri.fsPath.endsWith(".thy");
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
