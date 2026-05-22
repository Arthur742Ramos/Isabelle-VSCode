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
import {
  DEFAULT_PROOF_STATE_SETTINGS,
  ProofStateSettings,
  diffProofStateSettings,
  readProofStateSettings
} from "./proofStateSettings";

const PROOF_STATE_FRESHNESS_RENDER_INTERVAL_MS = 5_000;
const PROOF_STATE_STALE_AFTER_MS = 10_000;

export class ProofStatePanel implements vscode.WebviewViewProvider, vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private view: vscode.WebviewView | undefined;
  private refreshTimer: NodeJS.Timeout | undefined;
  private freshnessTimer: NodeJS.Timeout | undefined;
  private lastState: ProofStateResult | undefined;

  private lspSession: LspProofStateSession | undefined;
  private lspOutputNodes: readonly PideOutputNode[] = [];
  private lspAutoUpdate = true;
  private lspStatus: ProofStateSessionStatus | undefined;
  private lspError: string | undefined;
  private lspLastOutputReceivedAtMs: number | undefined;
  private lspRefreshRequestedAtMs: number | undefined;

  private dynamicSession: PideDynamicOutputSession | undefined;
  private dynamicOutputNodes: readonly PideOutputNode[] = [];

  private appliedSettings: ProofStateSettings = { ...DEFAULT_PROOF_STATE_SETTINGS };

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
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration("isabelle.proofState.autoUpdate") ||
          event.affectsConfiguration("isabelle.proofState.margin") ||
          event.affectsConfiguration("isabelle.dynamicOutput.margin")
        ) {
          this.applyLspSettings();
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
      this.requestLspRefresh();
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
      this.requestLspRefresh();
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
    this.stopFreshnessTicker();
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
    this.appliedSettings = this.readCurrentSettings();
    this.lspAutoUpdate = this.appliedSettings.autoUpdate;
    this.lspStatus = "initializing";
    this.lspError = undefined;
    this.lspLastOutputReceivedAtMs = undefined;
    this.lspRefreshRequestedAtMs = undefined;
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
    this.startFreshnessTicker();
    this.render();
    // Apply the configured settings as soon as the upstream session is
    // active. Margin pushes are tolerant of being sent before the
    // session reports `active`; auto_update is also queued via the
    // LspProofStateSession's internal `canSend` guard.
    this.applyLspSettings();
  }

  private stopLspSession(): void {
    if (!this.lspSession) return;
    this.output.appendLine("Proof state: LSP-mode session stopping");
    this.stopFreshnessTicker();
    this.dynamicSession?.dispose();
    this.dynamicSession = undefined;
    this.dynamicOutputNodes = [];
    this.lspSession.dispose();
    this.lspSession = undefined;
    this.lspOutputNodes = [];
    this.lspStatus = undefined;
    this.lspError = undefined;
    this.lspLastOutputReceivedAtMs = undefined;
    this.lspRefreshRequestedAtMs = undefined;
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
    this.lspLastOutputReceivedAtMs = update.lastOutputReceivedAtMs;
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
        dynamicOutputNodes: this.dynamicOutputNodes,
        lastOutputReceivedAtMs: this.lspLastOutputReceivedAtMs,
        refreshRequestedAtMs: this.lspRefreshRequestedAtMs,
        nowMs: Date.now(),
        staleAfterMs: PROOF_STATE_STALE_AFTER_MS
      };
      this.view.webview.html = renderProofStateHtml(this.lastState, pideView);
      return;
    }
    this.view.webview.html = renderProofStateHtml(this.lastState);
  }

  /**
   * Imperative entry point for `Isabelle: Toggle Proof State Auto-Update`.
   * Flips the cached setting in addition to forwarding the toggle to
   * the upstream `PIDE/state_auto_update` so the next session-startup
   * inherits the user's choice without a workspace reload.
   */
  public toggleAutoUpdate(): boolean {
    const next = !this.appliedSettings.autoUpdate;
    this.appliedSettings = { ...this.appliedSettings, autoUpdate: next };
    if (this.lspSession) {
      this.lspSession.setAutoUpdate(next);
    }
    return next;
  }

  /**
   * Imperative entry point for `Isabelle: Re-anchor Proof State to
   * Cursor`. Sends `PIDE/state_locate` so the upstream State_Panel
   * re-anchors to the current caret. No-op when no LSP session is
   * active.
   */
  public requestLocate(): void {
    this.lspSession?.requestLocate();
  }

  private applyLspSettings(): void {
    const next = this.readCurrentSettings();
    const delta = diffProofStateSettings(this.appliedSettings, next);
    this.appliedSettings = next;
    if (!this.lspSession) return;
    if (delta.autoUpdateChanged) {
      this.lspSession.setAutoUpdate(next.autoUpdate);
    }
    if (delta.proofStateMarginChanged) {
      this.lspSession.setMargin(next.proofStateMargin);
    }
    if (delta.dynamicOutputMarginChanged) {
      this.dynamicSession?.setMargin(next.dynamicOutputMargin);
    }
  }

  private readCurrentSettings(): ProofStateSettings {
    const config = vscode.workspace.getConfiguration("isabelle");
    return readProofStateSettings({
      get: <T>(section: string) => config.get<T>(section)
    });
  }

  private requestLspRefresh(): void {
    this.lspRefreshRequestedAtMs = Date.now();
    this.lspSession?.requestUpdate();
  }

  private startFreshnessTicker(): void {
    if (this.freshnessTimer) return;
    this.freshnessTimer = setInterval(() => {
      this.render();
    }, PROOF_STATE_FRESHNESS_RENDER_INTERVAL_MS);
    this.freshnessTimer.unref?.();
  }

  private stopFreshnessTicker(): void {
    if (!this.freshnessTimer) return;
    clearInterval(this.freshnessTimer);
    this.freshnessTimer = undefined;
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
