import * as vscode from "vscode";
import { BackendManager } from "../backend/BackendManager";
import {
  SledgehammerCancelParams,
  SledgehammerCancelResult,
  SledgehammerRunParams,
  SledgehammerRunResult,
  SledgehammerSuggestion
} from "../protocol/messages";
import { SledgehammerHistory, SledgehammerHistoryEntry } from "./sledgehammerHistory";
import { renderSledgehammerHtml } from "./sledgehammerRenderer";

interface ExecuteRunOverrides {
  sessionName?: string;
  isabelleExecutablePath?: string;
}

export class SledgehammerPanel implements vscode.WebviewViewProvider, vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly history = new SledgehammerHistory();
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

    await this.executeRun(editor);
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
        this.history.recordCancellation(requestId, result.message, new Date().toISOString());
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

  public async replay(requestId: string): Promise<void> {
    const entry = this.history.find(requestId);
    if (!entry) {
      vscode.window.showWarningMessage(`No Sledgehammer history entry found for request ${requestId}.`);
      return;
    }

    if (this.activeRequestId) {
      vscode.window.showInformationMessage("A Sledgehammer job is already running.");
      return;
    }

    let uri: vscode.Uri;
    try {
      uri = vscode.Uri.parse(entry.uri, true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Unable to replay Sledgehammer run: invalid URI (${message}).`);
      return;
    }

    let editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.toString() !== entry.uri) {
      try {
        const document = await vscode.workspace.openTextDocument(uri);
        editor = await vscode.window.showTextDocument(document);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Unable to open theory for Sledgehammer replay: ${message}`);
        return;
      }
    }

    if (!isTheoryDocument(editor.document)) {
      vscode.window.showWarningMessage(
        "The theory referenced by this Sledgehammer history entry is no longer recognized as an Isabelle theory."
      );
      return;
    }

    await this.executeRun(editor, {
      sessionName: entry.sessionName,
      isabelleExecutablePath: entry.isabelleExecutablePath
    });
  }

  public clearHistory(): void {
    this.history.clear();
    this.render();
    vscode.window.showInformationMessage("Cleared Sledgehammer run history.");
  }

  public getHistory(): readonly SledgehammerHistoryEntry[] {
    return this.history.list();
  }

  public dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
  }

  private async executeRun(editor: vscode.TextEditor, overrides?: ExecuteRunOverrides): Promise<void> {
    const requestId = `sledgehammer-${this.nextRequestNumber++}`;
    const uri = editor.document.uri.toString();
    const version = editor.document.version;
    const sessionName = overrides?.sessionName ?? this.getActiveSessionName();
    const isabelleExecutablePath = overrides?.isabelleExecutablePath
      ?? vscode.workspace.getConfiguration("isabelle").get<string>("executablePath", "isabelle");
    const startedAt = new Date().toISOString();

    this.activeRequestId = requestId;
    this.lastResult = {
      requestId,
      uri,
      version,
      status: "running",
      suggestions: [],
      raw: "Waiting for the Isabelle backend to evaluate the Sledgehammer request.",
      message: "Sledgehammer request sent to the backend."
    };
    this.history.recordStart({
      requestId,
      uri,
      version,
      sessionName,
      isabelleExecutablePath,
      startedAt
    });
    this.render();
    this.updateContexts();

    const params: SledgehammerRunParams = {
      requestId,
      uri,
      version,
      position: {
        line: editor.selection.active.line,
        character: editor.selection.active.character
      },
      session: sessionName,
      isabelleExecutablePath
    };

    try {
      const result = await this.backendManager.getClient().request<SledgehammerRunResult, SledgehammerRunParams>(
        "sledgehammer/run",
        params
      );
      this.lastResult = result;
      this.history.recordResult(requestId, result, new Date().toISOString());
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
        uri,
        version,
        status: "failed",
        suggestions: [],
        raw: message,
        message
      };
      this.history.recordFailure(requestId, message, new Date().toISOString());
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

  private render(): void {
    if (this.view) {
      this.view.webview.html = renderSledgehammerHtml(this.lastResult, this.history.list());
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
