import * as vscode from "vscode";
import { BackendManager } from "../backend/BackendManager";
import { IsabelleLanguageClient } from "../lsp/IsabelleLanguageClient";
import { IsabelleLanguageServerStatus } from "../lsp/lspTypes";
import {
  SledgehammerCancelParams,
  SledgehammerCancelResult,
  ProtocolPosition,
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

/**
 * Optional injectable resolver that runs the 4-step PIDE session
 * cascade (setting → single-root auto-select → quickpick → HOL
 * fallback). When supplied, `executeBackendRun` consults it before
 * sending `sledgehammer/run` so the backend's "select a session" guard
 * isn't tripped on fresh installs. When omitted (or when it returns
 * `cancelled`), the panel falls back to the legacy `getActiveSessionName`
 * lookup so existing tests keep working.
 */
export type SledgehammerSessionResolver = () => Promise<
  { kind: "resolved"; session: string } | { kind: "cancelled" }
>;

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
    private readonly quiescenceTracker?: PideQuiescenceTracker,
    private readonly sessionResolver?: SledgehammerSessionResolver
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
    return (
      this.activeBackendRequestId !== undefined ||
      this.activeLspRequestId !== undefined ||
      this.activeLspSession !== undefined
    );
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
    const position: ProtocolPosition = {
      line: editor.selection.active.line,
      character: editor.selection.active.character
    };
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
      position,
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
      position,
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
    position: ProtocolPosition,
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
    const status = this.languageClient.getStatus();
    if (status.state !== "running") {
      this.failActiveLspRun(
        requestId,
        status.lastError
          ? `Isabelle language server left running state (${status.state}) before Sledgehammer dispatch: ${status.lastError}`
          : `Isabelle language server left running state (${status.state}) before Sledgehammer dispatch.`
      );
      return;
    }

    this.activeLspSession = new LspSledgehammerSession(
      this.languageClient,
      this.output,
      {
        uri,
        position,
        settings,
        fallbackProvers
      },
      (update) => this.handleLspUpdate(requestId, uri, version, position, update)
    );
  }

  private handleLspUpdate(
    requestId: string,
    uri: string,
    documentVersion: number,
    position: ProtocolPosition,
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
      documentVersion,
      position
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
    if (!this.activeLspRequestId) {
      return;
    }
    if (status.state === "running") {
      return;
    }
    if (!this.activeLspSession) {
      const reason = status.lastError
        ? `Isabelle language server left running state (${status.state}) before Sledgehammer dispatch: ${status.lastError}`
        : `Isabelle language server left running state (${status.state}) before Sledgehammer dispatch.`;
      this.failActiveLspRun(this.activeLspRequestId, reason);
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
    this.failActiveLspRun(requestId, reason);
  }

  private failActiveLspRun(requestId: string, reason: string): void {
    this.activeLspSession?.dispose();
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
    const position: ProtocolPosition = {
      line: editor.selection.active.line,
      character: editor.selection.active.character
    };
    // Claim the active-run slot synchronously, before the (awaited) session
    // resolution, so a second invocation while the session quick-pick is open
    // is blocked by hasActiveRun() instead of starting a duplicate backend job.
    // The finally block (and the cancellation path) release it.
    this.activeBackendRequestId = requestId;
    // Resolve the session via the shared 4-step PIDE cascade when no
    // override was passed. Replays carry the historical sessionName
    // through `overrides` so a replay re-runs against the same session
    // even if the active selection has changed since.
    let sessionName: string | undefined;
    if (overrides?.sessionName !== undefined) {
      sessionName = overrides.sessionName;
    } else if (this.sessionResolver) {
      let resolved: { kind: "resolved"; session: string } | { kind: "cancelled" };
      try {
        resolved = await this.sessionResolver();
      } catch (error) {
        // Release the slot claimed above; otherwise a session quick-pick
        // failure would leave hasActiveRun() permanently true and block every
        // future run until the window is reloaded.
        this.activeBackendRequestId = undefined;
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
        this.lastOutputNodes = [];
        this.history.recordFailure(requestId, message, new Date().toISOString());
        this.output.appendLine(`Sledgehammer session resolution failed: ${message}`);
        vscode.window.showErrorMessage(`Sledgehammer session resolution failed: ${message}`);
        this.render();
        this.updateContexts();
        return;
      }
      if (resolved.kind === "cancelled") {
        this.activeBackendRequestId = undefined;
        const cancelMessage = "Sledgehammer cancelled — no Isabelle session selected.";
        this.lastResult = {
          requestId,
          uri,
          version,
          status: "cancelled",
          suggestions: [],
          raw: cancelMessage,
          message: cancelMessage
        };
        this.lastOutputNodes = [];
        this.output.appendLine(`Sledgehammer: ${cancelMessage}`);
        this.render();
        this.updateContexts();
        return;
      }
      sessionName = resolved.session;
    } else {
      sessionName = this.getActiveSessionName();
    }
    const isabelleExecutablePath = overrides?.isabelleExecutablePath
      ?? vscode.workspace.getConfiguration("isabelle").get<string>("executablePath", "isabelle");
    const startedAt = new Date().toISOString();

    this.lastResult = {
      requestId,
      uri,
      version,
      position,
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
      position,
      session: sessionName,
      isabelleExecutablePath
    };

    try {
      const result = await this.backendManager.getClient().request<SledgehammerRunResult, SledgehammerRunParams>(
        "sledgehammer/run",
        params
      );
      this.lastResult = { ...result, position };
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
