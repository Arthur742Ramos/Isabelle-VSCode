import * as vscode from "vscode";
import { BackendManager } from "../backend/BackendManager";
import {
  CloseTheoryParams,
  CloseTheoryResult,
  CommandSpan,
  OpenTheoryParams,
  ServerMethod,
  TheoryDocumentResult,
  UpdateTheoryParams
} from "../protocol/messages";
import { extractCommandSpans } from "./commandSpans";

export class DocumentSyncService implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly didChangeTheoryDocument = new vscode.EventEmitter<TheoryDocumentResult>();
  private readonly syncedDocuments = new Map<string, TheoryDocumentResult>();
  private readonly syncedVersions = new Map<string, number>();

  public readonly onDidChangeTheoryDocument = this.didChangeTheoryDocument.event;

  public constructor(
    private readonly backendManager: BackendManager,
    private readonly output: vscode.OutputChannel,
    private readonly getActiveSessionName: () => string | undefined
  ) {}

  public start(): void {
    this.disposables.push(
      vscode.workspace.onDidOpenTextDocument((document) => {
        void this.open(document).catch((error) => this.reportSyncFailure("open", error));
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        void this.update(event.document).catch((error) => this.reportSyncFailure("update", error));
      }),
      vscode.workspace.onDidCloseTextDocument((document) => {
        void this.close(document).catch((error) => this.reportSyncFailure("close", error));
      })
    );

    for (const document of vscode.workspace.textDocuments) {
      void this.open(document).catch((error) => this.reportSyncFailure("open", error));
    }
  }

  public async resyncOpenTheories(): Promise<void> {
    const theories = vscode.workspace.textDocuments.filter(isTheoryDocument);
    await Promise.all(theories.map((document) => this.open(document)));
    vscode.window.showInformationMessage(`Synchronized ${theories.length} Isabelle theory document(s).`);
  }

  public dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
    for (const uri of this.syncedVersions.keys()) {
      void this.request<CloseTheoryResult, CloseTheoryParams>("document/close", { uri })
        .catch((error) => this.reportSyncFailure("close", error));
    }
    this.syncedVersions.clear();
    this.syncedDocuments.clear();
    this.didChangeTheoryDocument.dispose();
  }

  public getCommandSpans(document: vscode.TextDocument): CommandSpan[] {
    const uri = document.uri.toString();
    const synced = this.syncedDocuments.get(uri);
    if (synced?.version === document.version) {
      return synced.commandSpans;
    }

    return extractCommandSpans(uri, document.getText(), document.version);
  }

  private async open(document: vscode.TextDocument): Promise<void> {
    if (!isTheoryDocument(document)) {
      return;
    }

    const uri = document.uri.toString();
    this.syncedVersions.delete(uri);
    this.syncedDocuments.delete(uri);
    const result = await this.request<TheoryDocumentResult, OpenTheoryParams>("document/openTheory", {
      uri,
      text: document.getText(),
      version: document.version,
      session: this.getActiveSessionName()
    });
    this.recordResult(result, "opened");
  }

  private async update(document: vscode.TextDocument): Promise<void> {
    if (!isTheoryDocument(document)) {
      return;
    }

    const uri = document.uri.toString();
    if (this.syncedVersions.get(uri) === document.version) {
      return;
    }
    this.syncedDocuments.delete(uri);

    const result = await this.request<TheoryDocumentResult, UpdateTheoryParams>("document/update", {
      uri,
      text: document.getText(),
      version: document.version
    });
    this.recordResult(result, "updated");
  }

  private async close(document: vscode.TextDocument): Promise<void> {
    if (!isTheoryDocument(document)) {
      return;
    }

    const uri = document.uri.toString();
    await this.request<CloseTheoryResult, CloseTheoryParams>("document/close", { uri });
    this.syncedVersions.delete(uri);
    this.syncedDocuments.delete(uri);
    this.output.appendLine(`Document closed: ${uri}`);
  }

  private async request<TResult, TParams>(method: ServerMethod, params: TParams): Promise<TResult> {
    return this.backendManager.getClient().request<TResult, TParams>(method, params);
  }

  private recordResult(result: TheoryDocumentResult, action: string): void {
    this.syncedVersions.set(result.uri, result.version);
    this.syncedDocuments.set(result.uri, result);
    this.didChangeTheoryDocument.fire(result);
    this.output.appendLine(
      `Document ${action}: ${result.uri} v${result.version}, ${result.commandSpans.length} command span(s)`
    );
  }

  private reportSyncFailure(action: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.output.appendLine(`Document ${action} synchronization failed: ${message}`);
  }
}

function isTheoryDocument(document: vscode.TextDocument): boolean {
  return document.languageId === "isabelle" || document.uri.fsPath.endsWith(".thy");
}
