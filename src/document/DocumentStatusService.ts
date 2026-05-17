import * as vscode from "vscode";
import {
  buildDocumentStatusSummary,
  DocumentStatusSummary,
  formatDocumentStatusBarText,
  formatDocumentStatusDetails,
  formatDocumentStatusTooltip
} from "./documentStatus";
import { DocumentSyncService } from "./DocumentSyncService";

export class DocumentStatusService implements vscode.Disposable {
  private readonly statusBar: vscode.StatusBarItem;
  private readonly disposables: vscode.Disposable[] = [];

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
          this.refresh();
        }
      }),
      vscode.window.onDidChangeActiveTextEditor(() => this.refresh()),
      vscode.window.onDidChangeTextEditorSelection((event) => {
        if (event.textEditor === vscode.window.activeTextEditor) {
          this.refresh();
        }
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        const active = vscode.window.activeTextEditor?.document;
        if (active?.uri.toString() === event.document.uri.toString()) {
          this.refresh();
        }
      })
    );

    this.refresh();
  }

  public showActiveDocumentStatus(): void {
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

    const summary = buildDocumentStatusSummary({
      uri: editor.document.uri.toString(),
      version: editor.document.version,
      spans: this.documents.getCommandSpans(editor.document),
      position: {
        line: editor.selection.active.line,
        character: editor.selection.active.character
      }
    });

    this.statusBar.text = formatDocumentStatusBarText(summary);
    this.statusBar.tooltip = formatDocumentStatusTooltip(summary);
    this.statusBar.show();
    return summary;
  }
}

function isTheoryDocument(document: vscode.TextDocument): boolean {
  return document.languageId === "isabelle" || document.uri.fsPath.endsWith(".thy");
}
