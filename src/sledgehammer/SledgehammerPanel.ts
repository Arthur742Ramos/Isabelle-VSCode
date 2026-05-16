import * as vscode from "vscode";
import { BackendManager } from "../backend/BackendManager";
import {
  SledgehammerCancelParams,
  SledgehammerCancelResult,
  SledgehammerRunParams,
  SledgehammerRunResult,
  SledgehammerSuggestion
} from "../protocol/messages";
import { renderSledgehammerHtml } from "./sledgehammerRenderer";

export class SledgehammerPanel implements vscode.WebviewViewProvider, vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private view: vscode.WebviewView | undefined;
  private lastResult: SledgehammerRunResult | undefined;
  private activeRequestId: string | undefined;
  private nextRequestNumber = 1;

  public constructor(
    private readonly backendManager: BackendManager,
    private readonly output: vscode.OutputChannel,
    private readonly getActiveSessionName: () => string | undefined
  ) {
    this.updateContexts();
  }

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: false };
    this.render();
  }

  public async run(): Promise<void> {
    if (this.activeRequestId) {
      vscode.window.showInformationMessage("A Sledgehammer job is already running.");
      return;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor || !isTheoryDocument(editor.document)) {
      const message = "Open an Isabelle theory and place the cursor inside a proof command before running Sledgehammer.";
      this.lastResult = {
        requestId: "",
        uri: "",
        status: "unavailable",
        suggestions: [],
        raw: message,
        message
      };
      this.render();
      this.updateContexts();
      vscode.window.showWarningMessage(message);
      return;
    }

    const requestId = `sledgehammer-${this.nextRequestNumber++}`;
    this.activeRequestId = requestId;
    this.lastResult = {
      requestId,
      uri: editor.document.uri.toString(),
      version: editor.document.version,
      status: "running",
      suggestions: [],
      raw: "Waiting for the Isabelle backend to evaluate the Sledgehammer request.",
      message: "Sledgehammer request sent to the backend."
    };
    this.render();
    this.updateContexts();

    const params: SledgehammerRunParams = {
      requestId,
      uri: editor.document.uri.toString(),
      version: editor.document.version,
      position: {
        line: editor.selection.active.line,
        character: editor.selection.active.character
      },
      session: this.getActiveSessionName(),
      isabelleExecutablePath: vscode.workspace.getConfiguration("isabelle").get<string>("executablePath", "isabelle")
    };

    try {
      const result = await this.backendManager.getClient().request<SledgehammerRunResult, SledgehammerRunParams>(
        "sledgehammer/run",
        params
      );
      this.lastResult = result;
      this.output.appendLine(`Sledgehammer ${result.status}: ${result.message ?? result.raw}`);
      if (result.status === "completed" && result.suggestions.length > 0) {
        vscode.window.showInformationMessage(`Sledgehammer found ${result.suggestions.length} proof suggestion(s).`);
      } else if (result.message) {
        vscode.window.showInformationMessage(result.message);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastResult = {
        requestId,
        uri: editor.document.uri.toString(),
        version: editor.document.version,
        status: "failed",
        suggestions: [],
        raw: message,
        message
      };
      this.output.appendLine(`Sledgehammer request failed: ${message}`);
      vscode.window.showErrorMessage(`Sledgehammer request failed: ${message}`);
    } finally {
      if (this.activeRequestId === requestId) {
        this.activeRequestId = undefined;
      }
      this.render();
      this.updateContexts();
    }
  }

  public async cancel(): Promise<void> {
    if (!this.activeRequestId) {
      vscode.window.showInformationMessage("No Sledgehammer job is running.");
      return;
    }

    const requestId = this.activeRequestId;
    try {
      const result = await this.backendManager.getClient().request<SledgehammerCancelResult, SledgehammerCancelParams>(
        "sledgehammer/cancel",
        { requestId }
      );
      this.output.appendLine(`Sledgehammer cancel: ${result.message}`);
      vscode.window.showInformationMessage(result.message);
      if (result.cancelled && this.lastResult?.requestId === requestId) {
        this.lastResult = {
          ...this.lastResult,
          status: "cancelled",
          message: result.message,
          raw: result.message
        };
        this.activeRequestId = undefined;
        this.render();
        this.updateContexts();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.output.appendLine(`Sledgehammer cancel failed: ${message}`);
      vscode.window.showErrorMessage(`Sledgehammer cancel failed: ${message}`);
    }
  }

  public async insertFirstSuggestion(): Promise<void> {
    const suggestion = this.lastResult?.suggestions[0];
    if (!this.lastResult || !suggestion) {
      vscode.window.showWarningMessage("No Sledgehammer proof suggestion is available to insert.");
      return;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.toString() !== this.lastResult.uri) {
      vscode.window.showWarningMessage("Open the theory that produced the Sledgehammer suggestion before inserting it.");
      return;
    }

    if (this.lastResult.version !== undefined && editor.document.version !== this.lastResult.version) {
      vscode.window.showWarningMessage("The theory changed since Sledgehammer ran. Run Sledgehammer again before inserting.");
      return;
    }

    const proofText = normalizeProofText(suggestion);
    if (!proofText) {
      vscode.window.showWarningMessage("The Sledgehammer suggestion did not contain proof text.");
      return;
    }

    const inserted = await editor.edit((edit) => {
      edit.insert(editor.selection.active, proofText);
    });
    if (inserted) {
      vscode.window.showInformationMessage("Inserted Sledgehammer proof suggestion.");
    }
  }

  public dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
  }

  private render(): void {
    if (this.view) {
      this.view.webview.html = renderSledgehammerHtml(this.lastResult);
    }
  }

  private updateContexts(): void {
    const hasSuggestion = (this.lastResult?.suggestions.length ?? 0) > 0;
    void vscode.commands.executeCommand("setContext", "isabelle.sledgehammerRunning", this.activeRequestId !== undefined);
    void vscode.commands.executeCommand("setContext", "isabelle.sledgehammerHasSuggestion", hasSuggestion);
  }
}

function normalizeProofText(suggestion: SledgehammerSuggestion): string {
  const trimmed = suggestion.proofText.trim();
  if (!trimmed) {
    return "";
  }
  return `${trimmed}\n`;
}

function isTheoryDocument(document: vscode.TextDocument): boolean {
  return document.languageId === "isabelle" || document.uri.fsPath.endsWith(".thy");
}
