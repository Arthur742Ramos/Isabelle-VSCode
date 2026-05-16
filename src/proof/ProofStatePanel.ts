import * as vscode from "vscode";
import { BackendManager } from "../backend/BackendManager";
import { ProofStateParams, ProofStateResult } from "../protocol/messages";
import { renderProofStateHtml } from "./proofStateRenderer";

export class ProofStatePanel implements vscode.WebviewViewProvider, vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private view: vscode.WebviewView | undefined;
  private refreshTimer: NodeJS.Timeout | undefined;
  private lastState: ProofStateResult | undefined;

  public constructor(
    private readonly backendManager: BackendManager,
    private readonly output: vscode.OutputChannel
  ) {
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.scheduleRefresh()),
      vscode.window.onDidChangeTextEditorSelection(() => this.scheduleRefresh()),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (isTheoryDocument(event.document)) {
          this.scheduleRefresh();
        }
      })
    );
  }

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: false };
    this.render();
    void this.refresh();
  }

  public async refresh(): Promise<void> {
    if (!this.view) {
      return;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor || !isTheoryDocument(editor.document)) {
      this.lastState = undefined;
      this.render();
      return;
    }

    try {
      const result = await this.backendManager.getClient().request<ProofStateResult, ProofStateParams>(
        "proofState/get",
        {
          uri: editor.document.uri.toString(),
          version: editor.document.version,
          position: {
            line: editor.selection.active.line,
            character: editor.selection.active.character
          }
        }
      );
      this.lastState = result;
      this.render();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.output.appendLine(`Proof state refresh failed: ${message}`);
      this.lastState = {
        uri: editor.document.uri.toString(),
        version: editor.document.version,
        status: "unavailable",
        context: [],
        goals: [],
        raw: "",
        message
      };
      this.render();
    }
  }

  public dispose(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = setTimeout(() => {
      void this.refresh();
    }, 150);
  }

  private render(): void {
    if (this.view) {
      this.view.webview.html = renderProofStateHtml(this.lastState);
    }
  }
}

function isTheoryDocument(document: vscode.TextDocument): boolean {
  return document.languageId === "isabelle" || document.uri.fsPath.endsWith(".thy");
}
