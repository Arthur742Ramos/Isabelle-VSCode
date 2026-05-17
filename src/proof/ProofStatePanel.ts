import * as vscode from "vscode";
import { BackendManager } from "../backend/BackendManager";
import { IsabelleLanguageClient } from "../lsp/IsabelleLanguageClient";
import { IsabelleLanguageServerStatus } from "../lsp/lspTypes";
import { ProofStateParams, ProofStateResult } from "../protocol/messages";
import { PideOutputNode } from "../sledgehammer/pideSledgehammerOutput";
import {
  LspProofStateSession,
  ProofStateSessionStatus,
  ProofStateUpdate
} from "./LspProofStateSession";
import {
  DynamicOutputUpdate,
  PideDynamicOutputSession
} from "./PideDynamicOutputSession";
import { PideProofStateView, renderProofStateHtml } from "./proofStateRenderer";

export class ProofStatePanel implements vscode.WebviewViewProvider, vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private view: vscode.WebviewView | undefined;
  private refreshTimer: NodeJS.Timeout | undefined;
  private lastState: ProofStateResult | undefined;

  private lspSession: LspProofStateSession | undefined;
  private lspOutputNodes: readonly PideOutputNode[] = [];
  private lspAutoUpdate = true;
  private lspStatus: ProofStateSessionStatus | undefined;
  private lspError: string | undefined;

  private dynamicSession: PideDynamicOutputSession | undefined;
  private dynamicOutputNodes: readonly PideOutputNode[] = [];

  public constructor(
    private readonly backendManager: BackendManager,
    private readonly output: vscode.OutputChannel,
    private readonly languageClient?: IsabelleLanguageClient
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

    if (this.languageClient) {
      // If the LSP transitions into running and we're currently in
      // backend-mode, start the LSP session; if it leaves running mid-
      // session, dispose so we revert cleanly to backend-mode.
      this.disposables.push(
        this.languageClient.onStatusChange((status) =>
          this.handleLspStatusChange(status)
        )
      );
      // Late-wiring: if the LSP was already running when the panel
      // was constructed (e.g. start-up race), start the session
      // immediately rather than waiting for the next transition.
      if (this.languageClient.getStatus().state === "running") {
        this.startLspSession();
      }
    }
  }

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: false };
    this.render();
    if (this.shouldUseLspMode()) {
      this.lspSession?.requestUpdate();
    } else {
      void this.refresh();
    }
  }

  public async refresh(): Promise<void> {
    if (!this.view) {
      return;
    }

    if (this.shouldUseLspMode() && this.lspSession) {
      // In LSP mode, refresh is push-driven by PIDE/state_output. We
      // can ask for an immediate recompute via PIDE/state_update;
      // the new payload will arrive asynchronously.
      this.lspSession.requestUpdate();
      this.render();
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
      this.refreshTimer = undefined;
    }
    this.dynamicSession?.dispose();
    this.dynamicSession = undefined;
    this.lspSession?.dispose();
    this.lspSession = undefined;
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = setTimeout(() => {
      void this.refresh();
    }, 150);
  }

  private shouldUseLspMode(): boolean {
    return (
      this.languageClient?.getStatus().state === "running" &&
      this.lspSession !== undefined &&
      this.lspSession.getStatus() !== "errored"
    );
  }

  private handleLspStatusChange(status: IsabelleLanguageServerStatus): void {
    if (status.state === "running" && !this.lspSession) {
      this.startLspSession();
    } else if (status.state !== "running" && this.lspSession) {
      this.stopLspSession();
    }
  }

  private startLspSession(): void {
    if (!this.languageClient || this.lspSession) return;
    this.lspOutputNodes = [];
    this.lspAutoUpdate = true;
    this.lspStatus = "initializing";
    this.lspError = undefined;
    this.lspSession = new LspProofStateSession(
      this.languageClient,
      this.output,
      (update) => this.handleLspUpdate(update)
    );
    this.dynamicOutputNodes = [];
    this.dynamicSession = new PideDynamicOutputSession(
      this.languageClient,
      this.output,
      (update) => this.handleDynamicUpdate(update)
    );
    this.output.appendLine("Proof state: LSP-mode session starting");
    this.render();
  }

  private stopLspSession(): void {
    if (!this.lspSession) return;
    this.output.appendLine("Proof state: LSP-mode session stopping");
    this.dynamicSession?.dispose();
    this.dynamicSession = undefined;
    this.dynamicOutputNodes = [];
    this.lspSession.dispose();
    this.lspSession = undefined;
    this.lspOutputNodes = [];
    this.lspStatus = undefined;
    this.lspError = undefined;
    this.render();
    // Fall back to the backend path so the user sees something useful
    // instead of an empty panel.
    void this.refresh();
  }

  private handleLspUpdate(update: ProofStateUpdate): void {
    this.lspOutputNodes = update.outputNodes;
    this.lspAutoUpdate = update.autoUpdate;
    this.lspStatus = update.status;
    this.lspError = update.errorMessage;
    if (update.status === "errored") {
      this.output.appendLine(
        `Proof state LSP session errored: ${update.errorMessage ?? "unknown error"}`
      );
    }
    this.render();
  }

  private handleDynamicUpdate(update: DynamicOutputUpdate): void {
    this.dynamicOutputNodes = update.outputNodes;
    this.render();
  }

  private render(): void {
    if (!this.view) return;
    if (this.lspSession) {
      const pideView: PideProofStateView = {
        outputNodes: this.lspOutputNodes,
        autoUpdate: this.lspAutoUpdate,
        status: pideStatusCaption(this.lspStatus),
        errorMessage: this.lspError,
        dynamicOutputNodes: this.dynamicOutputNodes
      };
      this.view.webview.html = renderProofStateHtml(this.lastState, pideView);
      return;
    }
    this.view.webview.html = renderProofStateHtml(this.lastState);
  }
}

function isTheoryDocument(document: vscode.TextDocument): boolean {
  return document.languageId === "isabelle" || document.uri.fsPath.endsWith(".thy");
}

function pideStatusCaption(status: ProofStateSessionStatus | undefined): string | undefined {
  switch (status) {
    case "initializing":
      return "Initialising PIDE state panel (sending PIDE/state_init)...";
    case "active":
      return undefined;
    case "stopping":
      return "Stopping PIDE state panel...";
    case "stopped":
      return "PIDE state panel stopped.";
    case "errored":
      return "PIDE state panel reported an error.";
    case undefined:
    default:
      return undefined;
  }
}
