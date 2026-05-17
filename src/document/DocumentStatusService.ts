import * as vscode from "vscode";
import {
  buildDocumentStatusSnapshot,
  buildDocumentStatusSummaryFromSnapshot,
  DocumentStatusSnapshot,
  DocumentStatusSummary,
  formatDocumentStatusBarText,
  formatDocumentStatusDetails,
  formatDocumentStatusTooltip
} from "./documentStatus";
import { DocumentSyncService } from "./DocumentSyncService";

const REFRESH_DEBOUNCE_MS = 75;

export class DocumentStatusService implements vscode.Disposable {
  private readonly statusBar: vscode.StatusBarItem;
  private readonly disposables: vscode.Disposable[] = [];
  private documentSnapshot: DocumentStatusSnapshot | undefined;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;

  public constructor(
    private readonly documents: DocumentSyncService,
    private readonly output: vscode.OutputChannel
  ) {
    this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    this.statusBar.command = "isabelle.showDocumentStatus";
  }

  public start(): void {
    this.disposables.push(
      this.statusBar,
      this.documents.onDidChangeTheoryDocument((result) => {
        const active = vscode.window.activeTextEditor?.document;
        if (active?.uri.toString() === result.uri) {
          this.invalidateSnapshot();
          this.scheduleRefresh();
        }
      }),
      vscode.window.onDidChangeActiveTextEditor(() => this.scheduleRefresh()),
      vscode.window.onDidChangeTextEditorSelection((event) => {
        if (event.textEditor === vscode.window.activeTextEditor) {
          this.scheduleRefresh();
        }
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        const active = vscode.window.activeTextEditor?.document;
        if (active?.uri.toString() === event.document.uri.toString()) {
          this.invalidateSnapshot();
          this.scheduleRefresh();
        }
      })
    );

    this.refresh();
  }

  public showActiveDocumentStatus(): void {
    this.clearRefreshTimer();
    const summary = this.refresh();
    if (!summary) {
      vscode.window.showInformationMessage("Open an Isabelle theory to show local document status.");
      return;
    }

    this.output.appendLine("");
    this.output.appendLine(formatDocumentStatusDetails(summary));
    this.output.show(true);
  }

  public dispose(): void {
    this.clearRefreshTimer();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
  }

  private refresh(): DocumentStatusSummary | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isTheoryDocument(editor.document)) {
      this.statusBar.hide();
      return undefined;
    }

    const summary = buildDocumentStatusSummaryFromSnapshot(
      this.getDocumentSnapshot(editor.document),
      {
        line: editor.selection.active.line,
        character: editor.selection.active.character
      }
    );

    this.statusBar.text = formatDocumentStatusBarText(summary);
    this.statusBar.tooltip = formatDocumentStatusTooltip(summary);
    this.statusBar.show();
    return summary;
  }

  private getDocumentSnapshot(document: vscode.TextDocument): DocumentStatusSnapshot {
    const uri = document.uri.toString();
    if (
      !this.documentSnapshot
      || this.documentSnapshot.uri !== uri
      || this.documentSnapshot.version !== document.version
    ) {
      this.documentSnapshot = buildDocumentStatusSnapshot({
        uri,
        version: document.version,
        spans: this.documents.getCommandSpans(document)
      });
    }

    return this.documentSnapshot;
  }

  private invalidateSnapshot(): void {
    this.documentSnapshot = undefined;
  }

  private scheduleRefresh(): void {
    this.clearRefreshTimer();
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      this.refresh();
    }, REFRESH_DEBOUNCE_MS);
  }

  private clearRefreshTimer(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }
}

function isTheoryDocument(document: vscode.TextDocument): boolean {
  return document.languageId === "isabelle" || document.uri.fsPath.endsWith(".thy");
}
