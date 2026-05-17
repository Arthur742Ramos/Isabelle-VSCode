// Editor decorations derived from the local CommandSpan status surface.
// The underlying spans come from local syntax extraction in commandSpans.ts and
// are not PIDE status, diagnostics, or proof-checking results. Style choices
// intentionally avoid colors that would imply verified-by-PIDE meaning.
import * as vscode from "vscode";
import { ProtocolRange } from "../protocol/messages";
import {
  STATUS_DECORATION_KEYS,
  groupCommandSpanRangesByStatus
} from "./commandSpanDecorationGroups";
import { DocumentCommandStatus } from "./documentStatus";
import { DocumentSyncService } from "./DocumentSyncService";

type DecorationTypes = Record<DocumentCommandStatus, vscode.TextEditorDecorationType>;

const REFRESH_DEBOUNCE_MS = 75;

export class CommandSpanDecorationsService implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly decorationTypes: DecorationTypes;
  private readonly refreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private started = false;
  private disposed = false;

  public constructor(private readonly documents: DocumentSyncService) {
    this.decorationTypes = createDecorationTypes();
  }

  public start(): void {
    if (this.started || this.disposed) {
      return;
    }
    this.started = true;

    this.disposables.push(
      this.documents.onDidChangeTheoryDocument((result) => this.scheduleRefreshForUri(result.uri)),
      vscode.window.onDidChangeVisibleTextEditors(() => this.refresh()),
      vscode.window.onDidChangeActiveTextEditor(() => this.refresh()),
      vscode.workspace.onDidChangeTextDocument((event) => {
        this.scheduleRefreshForUri(event.document.uri.toString());
      })
    );

    this.refresh();
  }

  public refresh(): void {
    if (this.disposed) {
      return;
    }
    for (const editor of vscode.window.visibleTextEditors) {
      if (isTheoryDocument(editor.document)) {
        this.applyDecorations(editor);
      }
    }
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;

    for (const timer of this.refreshTimers.values()) {
      clearTimeout(timer);
    }
    this.refreshTimers.clear();

    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;

    for (const status of STATUS_DECORATION_KEYS) {
      this.decorationTypes[status].dispose();
    }
  }

  private scheduleRefreshForUri(uri: string): void {
    if (this.disposed) {
      return;
    }
    const existing = this.refreshTimers.get(uri);
    if (existing !== undefined) {
      clearTimeout(existing);
    }
    this.refreshTimers.set(
      uri,
      setTimeout(() => {
        this.refreshTimers.delete(uri);
        this.refreshForUri(uri);
      }, REFRESH_DEBOUNCE_MS)
    );
  }

  private refreshForUri(uri: string): void {
    if (this.disposed) {
      return;
    }
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.toString() === uri && isTheoryDocument(editor.document)) {
        this.applyDecorations(editor);
      }
    }
  }

  private applyDecorations(editor: vscode.TextEditor): void {
    const spans = this.documents.getCommandSpans(editor.document);
    const groups = groupCommandSpanRangesByStatus(spans);
    for (const status of STATUS_DECORATION_KEYS) {
      editor.setDecorations(this.decorationTypes[status], groups[status].map(toVsCodeRange));
    }
  }
}

function isTheoryDocument(document: vscode.TextDocument): boolean {
  return document.languageId === "isabelle" || document.uri.fsPath.endsWith(".thy");
}

function toVsCodeRange(range: ProtocolRange): vscode.Range {
  return new vscode.Range(
    range.start.line,
    range.start.character,
    range.end.line,
    range.end.character
  );
}

function createDecorationTypes(): DecorationTypes {
  return {
    pending: vscode.window.createTextEditorDecorationType({
      isWholeLine: false,
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
      borderStyle: "none none none dashed",
      borderWidth: "0 0 0 2px",
      borderColor: new vscode.ThemeColor("editorIndentGuide.background")
    }),
    running: vscode.window.createTextEditorDecorationType({
      isWholeLine: false,
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
      borderStyle: "none none none solid",
      borderWidth: "0 0 0 2px",
      borderColor: new vscode.ThemeColor("editorIndentGuide.activeBackground"),
      overviewRulerLane: vscode.OverviewRulerLane.Center,
      overviewRulerColor: new vscode.ThemeColor("editorIndentGuide.activeBackground")
    }),
    finished: vscode.window.createTextEditorDecorationType({
      isWholeLine: false,
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
      borderStyle: "none none none solid",
      borderWidth: "0 0 0 2px",
      borderColor: new vscode.ThemeColor("editorLineNumber.foreground")
    }),
    failed: vscode.window.createTextEditorDecorationType({
      isWholeLine: false,
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
      borderStyle: "none none none solid",
      borderWidth: "0 0 0 2px",
      borderColor: new vscode.ThemeColor("editorWarning.foreground"),
      overviewRulerLane: vscode.OverviewRulerLane.Right,
      overviewRulerColor: new vscode.ThemeColor("editorWarning.foreground")
    }),
    unknown: vscode.window.createTextEditorDecorationType({
      isWholeLine: false,
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
      borderStyle: "none none none dotted",
      borderWidth: "0 0 0 2px",
      borderColor: new vscode.ThemeColor("descriptionForeground")
    })
  };
}
