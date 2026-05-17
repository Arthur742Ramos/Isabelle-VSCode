import * as vscode from "vscode";
import { BackendManager } from "../backend/BackendManager";
import { IsabelleLanguageClient } from "../lsp/IsabelleLanguageClient";
import { IsabelleLanguageServerStatus } from "../lsp/lspTypes";
import {
  SledgehammerCancelParams,
  SledgehammerCancelResult,
  SledgehammerRunParams,
  SledgehammerRunResult,
  SledgehammerSuggestion
} from "../protocol/messages";
import {
  LspSledgehammerSession,
  SessionUpdate
} from "./LspSledgehammerSession";
import {
  convertSessionUpdateToRunResult,
  isTerminalSessionStatus
} from "./lspSessionToRunResult";
import { PideOutputNode } from "./pideSledgehammerOutput";
import {
  PideInsertPayload,
  requestPideInsert
} from "./pideSledgehammerInsert";
import { PideQuiescenceTracker } from "./PideQuiescenceTracker";
import { PideSledgehammerProversCache } from "./PideSledgehammerProversCache";
import { SledgehammerHistory, SledgehammerHistoryEntry } from "./sledgehammerHistory";
import {
  buildSledgehammerQuickPickItems,
  SledgehammerQuickPickItem
} from "./sledgehammerQuickPick";
import { renderSledgehammerHtml } from "./sledgehammerRenderer";
import { readSledgehammerSettings } from "./sledgehammerSettings";

interface ExecuteRunOverrides {
  sessionName?: string;
  isabelleExecutablePath?: string;
}

export class SledgehammerPanel implements vscode.WebviewViewProvider, vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly history = new SledgehammerHistory();
  private view: vscode.WebviewView | undefined;
  private lastResult: SledgehammerRunResult | undefined;
  private lastOutputNodes: readonly PideOutputNode[] = [];
  private activeBackendRequestId: string | undefined;
  private activeLspSession: LspSledgehammerSession | undefined;
  private activeLspRequestId: string | undefined;
  private nextRequestNumber = 1;
  private readonly lspStatusSubscription: vscode.Disposable | undefined;

  public constructor(
    private readonly backendManager: BackendManager,
    private readonly output: vscode.OutputChannel,
    private readonly getActiveSessionName: () => string | undefined,
    private readonly languageClient?: IsabelleLanguageClient,
    private readonly proversCache?: PideSledgehammerProversCache,
    private readonly quiescenceTracker?: PideQuiescenceTracker
  ) {
    this.updateContexts();
    if (this.languageClient) {
      // If the LSP stops mid-run (user disabled it, transport died,
      // child crashed) the active session would otherwise hang in
      // "running" forever — its only signals are LSP notifications.
      // Tear it down and surface a failed result so the user can
      // retry.
      this.lspStatusSubscription = this.languageClient.onStatusChange((status) =>
        this.handleLspStatusChange(status)
      );
      this.disposables.push(this.lspStatusSubscription);
    }
  }

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: false };
    this.render();
  }

  public async run(): Promise<void> {
    if (this.hasActiveRun()) {
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
      this.lastOutputNodes = [];
      this.render();
      this.updateContexts();
      vscode.window.showWarningMessage(message);
      return;
    }

    if (this.shouldUseLspMode()) {
      this.executeLspRun(editor);
    } else {
      await this.executeBackendRun(editor);
    }
  }

  public async cancel(): Promise<void> {
    if (this.activeLspSession) {
      this.activeLspSession.cancel();
      vscode.window.showInformationMessage(
        "Sledgehammer cancel sent to isabelle vscode_server."
      );
      return;
    }

    // LSP-mode cancel while still in the quiescence wait, before any
    // session has been constructed: clear the active id so the queued
    // dispatchLspRunAfterQuiescence bails when it wakes up.
    if (this.activeLspRequestId !== undefined && !this.activeLspSession) {
      const requestId = this.activeLspRequestId;
      this.activeLspRequestId = undefined;
      const message = "Sledgehammer cancelled before dispatch (quiescence gate).";
      this.history.recordCancellation(requestId, message, new Date().toISOString());
      if (this.lastResult?.requestId === requestId) {
        this.lastResult = {
          ...this.lastResult,
          status: "cancelled",
          message,
          raw: message
        };
      }
      this.output.appendLine(`Sledgehammer (LSP) cancelled before dispatch: ${requestId}`);
      vscode.window.showInformationMessage(message);
      this.render();
      this.updateContexts();
      return;
    }

    if (!this.activeBackendRequestId) {
      vscode.window.showInformationMessage("No Sledgehammer job is running.");
      return;
    }

    const requestId = this.activeBackendRequestId;
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
        this.activeBackendRequestId = undefined;
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
    await this.insertSuggestionAtIndex(0);
  }

  /**
   * Open a QuickPick listing every available proof suggestion and
   * insert the user's choice. Routes through the same backend-mode
   * vs LSP-mode path that `insertFirstSuggestion` uses.
   */
  public async pickAndInsertSuggestion(): Promise<void> {
    const suggestions = this.lastResult?.suggestions ?? [];
    if (!this.lastResult || suggestions.length === 0) {
      vscode.window.showWarningMessage(
        "No Sledgehammer proof suggestions are available to pick from."
      );
      return;
    }
    if (suggestions.length === 1) {
      // Single suggestion: there's nothing to pick, just insert.
      await this.insertSuggestionAtIndex(0);
      return;
    }
    const items = buildSledgehammerQuickPickItems(suggestions);
    const chosen = await vscode.window.showQuickPick(items, {
      title: "Insert Sledgehammer proof",
      placeHolder: "Choose which proof suggestion to insert",
      matchOnDescription: true,
      matchOnDetail: true
    });
    if (!chosen) {
      return;
    }
    await this.insertSuggestionAtIndex(chosen.index);
  }

  private async insertSuggestionAtIndex(index: number): Promise<void> {
    const suggestion = this.lastResult?.suggestions[index];
    if (!this.lastResult || !suggestion) {
      vscode.window.showWarningMessage("No Sledgehammer proof suggestion is available to insert.");
      return;
    }

    const proofText = normalizeProofText(suggestion);
    if (!proofText) {
      vscode.window.showWarningMessage("The Sledgehammer suggestion did not contain proof text.");
      return;
    }

    if (this.shouldUseLspMode() && this.languageClient) {
      await this.insertSuggestionViaLspSendback(this.lastResult.uri, this.lastResult.version, proofText);
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

    if (this.hasActiveRun()) {
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

    if (this.shouldUseLspMode()) {
      // The LSP-mode dispatch derives everything from the live editor:
      // the historical sessionName / isabelleExecutablePath are not
      // used because LSP-mode runs go through isabelle vscode_server,
      // not the Scala backend's `sledgehammer/run`.
      this.executeLspRun(editor);
    } else {
      await this.executeBackendRun(editor, {
        sessionName: entry.sessionName,
        isabelleExecutablePath: entry.isabelleExecutablePath
      });
    }
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
    this.activeLspSession?.dispose();
    this.activeLspSession = undefined;
    this.activeLspRequestId = undefined;
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
  }

  private hasActiveRun(): boolean {
    return this.activeBackendRequestId !== undefined || this.activeLspSession !== undefined;
  }

  private shouldUseLspMode(): boolean {
    return this.languageClient?.getStatus().state === "running";
  }

  private async insertSuggestionViaLspSendback(
    expectedUri: string,
    expectedVersion: number | undefined,
    proofText: string
  ): Promise<void> {
    if (!this.languageClient) {
      return;
    }
    const result = await requestPideInsert(this.languageClient, proofText, {
      uri: expectedUri
    });
    if (!result.ok) {
      this.output.appendLine(`Sledgehammer LSP insert failed: ${result.reason}`);
      vscode.window.showWarningMessage(`Sledgehammer insert failed: ${result.reason}`);
      return;
    }
    await this.applyPideInsertEdit(result.payload, expectedVersion);
  }

  private async applyPideInsertEdit(
    payload: PideInsertPayload,
    expectedVersion: number | undefined
  ): Promise<void> {
    let document: vscode.TextDocument;
    try {
      const uri = vscode.Uri.parse(payload.uri, true);
      document = await vscode.workspace.openTextDocument(uri);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.output.appendLine(
        `Sledgehammer LSP insert: unable to open ${payload.uri}: ${message}`
      );
      vscode.window.showWarningMessage(
        `Sledgehammer insert failed: unable to open ${payload.uri}.`
      );
      return;
    }

    if (
      expectedVersion !== undefined &&
      document.version !== expectedVersion
    ) {
      vscode.window.showWarningMessage(
        "The theory changed since Sledgehammer ran. Run Sledgehammer again before inserting."
      );
      return;
    }

    const editor = await vscode.window.showTextDocument(document);
    const position = new vscode.Position(payload.line, payload.character);

    const inserted = await editor.edit((edit) => {
      edit.insert(position, payload.text);
    });
    if (inserted) {
      vscode.window.showInformationMessage(
        "Inserted Sledgehammer proof suggestion at the position computed by isabelle vscode_server."
      );
    } else {
      vscode.window.showWarningMessage(
        "Sledgehammer insert: VS Code rejected the workspace edit."
      );
    }
  }

  private executeLspRun(editor: vscode.TextEditor): void {
    if (!this.languageClient) {
      // Defensive: shouldUseLspMode would have returned false, so we
      // never reach here in practice. Keep the early-return so the
      // assertion is documented in code rather than relying on call-site
      // ordering.
      return;
    }

    const requestId = `sledgehammer-lsp-${this.nextRequestNumber++}`;
    const uri = editor.document.uri.toString();
    const version = editor.document.version;
    const settings = readSledgehammerSettings(vscode.workspace.getConfiguration("isabelle"));
    const fallbackProvers = this.proversCache?.getProvers() ?? "";
    const startedAt = new Date().toISOString();

    this.activeLspRequestId = requestId;
    const requiredDelay = this.quiescenceTracker?.computeRequiredDelay(uri, settings.quiescenceDelayMs) ?? 0;
    const initialRaw = requiredDelay > 0
      ? `Waiting ${requiredDelay} ms for isabelle vscode_server to finish processing the theory (quiescence gate).`
      : "Dispatching Sledgehammer request via isabelle vscode_server (LSP mode).";
    const initialMessage = requiredDelay > 0
      ? `Waiting ${requiredDelay} ms before dispatching Sledgehammer (quiescence gate).`
      : "Sledgehammer request dispatched to isabelle vscode_server.";
    this.lastResult = {
      requestId,
      uri,
      version,
      status: "running",
      suggestions: [],
      raw: initialRaw,
      message: initialMessage
    };
    this.lastOutputNodes = [];
    this.history.recordStart({
      requestId,
      uri,
      version,
      sessionName: this.getActiveSessionName(),
      isabelleExecutablePath: undefined,
      startedAt
    });
    this.render();
    this.updateContexts();

    void this.dispatchLspRunAfterQuiescence(
      requestId,
      editor,
      uri,
      version,
      settings.quiescenceDelayMs,
      fallbackProvers,
      settings
    );
  }

  private async dispatchLspRunAfterQuiescence(
    requestId: string,
    editor: vscode.TextEditor,
    uri: string,
    version: number,
    quiescenceDelayMs: number,
    fallbackProvers: string,
    settings: ReturnType<typeof readSledgehammerSettings>
  ): Promise<void> {
    if (this.quiescenceTracker && quiescenceDelayMs > 0) {
      await this.quiescenceTracker.waitForQuiescence(uri, quiescenceDelayMs);
    }
    // The user may have cancelled or another run may have superseded
    // this one during the quiescence wait. Bail without dispatching
    // if our request id is no longer the active one.
    if (this.activeLspRequestId !== requestId) {
      return;
    }
    if (!this.languageClient) {
      return;
    }

    this.activeLspSession = new LspSledgehammerSession(
      this.languageClient,
      this.output,
      {
        uri,
        position: {
          line: editor.selection.active.line,
          character: editor.selection.active.character
        },
        settings,
        fallbackProvers
      },
      (update) => this.handleLspUpdate(requestId, uri, version, update)
    );
  }

  private handleLspUpdate(
    requestId: string,
    uri: string,
    documentVersion: number,
    update: SessionUpdate
  ): void {
    // Late deliveries after the caller moved on or the session was
    // superseded are dropped — only the live request id consumes
    // updates.
    if (this.activeLspRequestId !== requestId) {
      return;
    }

    const result = convertSessionUpdateToRunResult(update, {
      requestId,
      uri,
      documentVersion
    });
    this.lastResult = result;
    this.lastOutputNodes = update.outputNodes;

    if (isTerminalSessionStatus(update.status)) {
      const finishedAt = new Date().toISOString();
      if (update.status === "cancelled") {
        this.history.recordCancellation(requestId, result.message ?? "Cancelled", finishedAt);
      } else if (update.status === "errored") {
        this.history.recordFailure(requestId, result.message ?? "Errored", finishedAt);
      } else {
        this.history.recordResult(requestId, result, finishedAt);
      }
      this.activeLspSession?.dispose();
      this.activeLspSession = undefined;
      this.activeLspRequestId = undefined;
      this.output.appendLine(
        `Sledgehammer (LSP) ${result.status}: ${result.message ?? result.raw}`
      );
      if (result.status === "completed" && result.suggestions.length > 0) {
        vscode.window.showInformationMessage(
          result.message ?? `Sledgehammer found ${result.suggestions.length} proof suggestion(s).`
        );
      } else if (result.message) {
        vscode.window.showInformationMessage(result.message);
      }
    }

    this.render();
    this.updateContexts();
  }

  private handleLspStatusChange(status: IsabelleLanguageServerStatus): void {
    if (!this.activeLspSession || !this.activeLspRequestId) {
      return;
    }
    if (status.state === "running") {
      return;
    }
    // The LSP left the running state while a session was in flight.
    // The session itself can't observe this — its only inputs are
    // notifications — so we abort it here, mark the run as failed,
    // and surface a message so the user knows to retry.
    const requestId = this.activeLspRequestId;
    const reason = status.lastError
      ? `Isabelle language server left running state (${status.state}): ${status.lastError}`
      : `Isabelle language server left running state (${status.state}).`;
    this.activeLspSession.dispose();
    this.activeLspSession = undefined;
    this.activeLspRequestId = undefined;
    if (this.lastResult && this.lastResult.requestId === requestId) {
      this.lastResult = {
        ...this.lastResult,
        status: "failed",
        message: reason,
        raw: reason
      };
    }
    this.history.recordFailure(requestId, reason, new Date().toISOString());
    this.output.appendLine(`Sledgehammer (LSP) aborted: ${reason}`);
    vscode.window.showWarningMessage(reason);
    this.render();
    this.updateContexts();
  }

  private async executeBackendRun(editor: vscode.TextEditor, overrides?: ExecuteRunOverrides): Promise<void> {
    const requestId = `sledgehammer-${this.nextRequestNumber++}`;
    const uri = editor.document.uri.toString();
    const version = editor.document.version;
    const sessionName = overrides?.sessionName ?? this.getActiveSessionName();
    const isabelleExecutablePath = overrides?.isabelleExecutablePath
      ?? vscode.workspace.getConfiguration("isabelle").get<string>("executablePath", "isabelle");
    const startedAt = new Date().toISOString();

    this.activeBackendRequestId = requestId;
    this.lastResult = {
      requestId,
      uri,
      version,
      status: "running",
      suggestions: [],
      raw: "Waiting for the Isabelle backend to evaluate the Sledgehammer request.",
      message: "Sledgehammer request sent to the backend."
    };
    this.lastOutputNodes = [];
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
      if (this.activeBackendRequestId === requestId) {
        this.activeBackendRequestId = undefined;
      }
      this.render();
      this.updateContexts();
    }
  }

  private render(): void {
    if (this.view) {
      this.view.webview.html = renderSledgehammerHtml(
        this.lastResult,
        this.history.list(),
        this.lastOutputNodes
      );
    }
  }

  private updateContexts(): void {
    const hasSuggestion = (this.lastResult?.suggestions.length ?? 0) > 0;
    void vscode.commands.executeCommand(
      "setContext",
      "isabelle.sledgehammerRunning",
      this.hasActiveRun()
    );
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
