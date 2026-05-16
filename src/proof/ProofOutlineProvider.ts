import * as vscode from "vscode";
import { DocumentSyncService } from "../document/DocumentSyncService";
import { CommandSpan } from "../protocol/messages";
import { SessionService } from "../session/SessionService";
import { buildProofOutline, ProofOutlineNode } from "./proofOutline";

type ProofOutlineTreeNode =
  | { kind: "placeholder"; label: string; description?: string }
  | { kind: "command"; uri: string; node: ProofOutlineNode };

export class ProofOutlineProvider implements vscode.TreeDataProvider<ProofOutlineTreeNode>, vscode.Disposable {
  private readonly didChangeTreeData = new vscode.EventEmitter<ProofOutlineTreeNode | undefined>();
  private readonly disposables: vscode.Disposable[] = [];
  private refreshTimer: NodeJS.Timeout | undefined;

  public readonly onDidChangeTreeData = this.didChangeTreeData.event;

  public constructor(
    private readonly documents: DocumentSyncService,
    private readonly sessions: SessionService
  ) {
    this.disposables.push(
      this.documents.onDidChangeTheoryDocument(() => this.scheduleRefresh()),
      vscode.window.onDidChangeActiveTextEditor(() => this.scheduleRefresh()),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (isTheoryDocument(event.document)) {
          this.scheduleRefresh();
        }
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("isabelle.session.active")) {
          this.scheduleRefresh();
        }
      })
    );
  }

  public refresh(): void {
    this.didChangeTreeData.fire(undefined);
  }

  public getTreeItem(element: ProofOutlineTreeNode): vscode.TreeItem {
    if (element.kind === "placeholder") {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
      item.description = element.description;
      item.iconPath = new vscode.ThemeIcon("info");
      return item;
    }

    const item = new vscode.TreeItem(
      element.node.label,
      element.node.children.length > 0
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None
    );
    item.description = element.node.detail;
    item.tooltip = this.tooltipFor(element.node.span);
    item.iconPath = iconFor(element.node.span.kind);
    item.contextValue = "isabelleProofOutlineCommand";
    item.command = {
      command: "isabelle.revealCommandSpan",
      title: "Reveal Isabelle Command",
      arguments: [element.uri, element.node.span]
    };
    return item;
  }

  public getChildren(element?: ProofOutlineTreeNode): ProofOutlineTreeNode[] {
    if (element?.kind === "command") {
      return element.node.children.map((child) => ({
        kind: "command",
        uri: element.uri,
        node: child
      }));
    }

    if (element) {
      return [];
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor || !isTheoryDocument(editor.document)) {
      return [
        {
          kind: "placeholder",
          label: "Open an Isabelle theory",
          description: "The outline follows the active .thy editor."
        }
      ];
    }

    const spans = this.documents.getCommandSpans(editor.document);
    if (spans.length === 0) {
      return [
        {
          kind: "placeholder",
          label: "No command spans found",
          description: "Synchronize or add Isabelle commands to this theory."
        }
      ];
    }

    const uri = editor.document.uri.toString();
    return buildProofOutline(spans).map((node) => ({ kind: "command", uri, node }));
  }

  public dispose(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.didChangeTreeData.dispose();
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = setTimeout(() => this.refresh(), 150);
  }

  private tooltipFor(span: CommandSpan): string {
    const activeSession = this.sessions.getActiveSessionName() ?? "No active session";
    return [
      `${span.kind}${span.name ? ` ${span.name}` : ""}`,
      `Range: ${span.range.start.line + 1}:${span.range.start.character + 1}`,
      `Session: ${activeSession}`
    ].join("\n");
  }
}

function iconFor(kind: string): vscode.ThemeIcon {
  if (["lemma", "theorem", "corollary", "proposition", "schematic_goal"].includes(kind)) {
    return new vscode.ThemeIcon("symbol-method");
  }
  if (["proof", "apply", "have", "show", "hence", "thus"].includes(kind)) {
    return new vscode.ThemeIcon("debug-step-over");
  }
  if (["qed", "by", "done", "sorry", "oops"].includes(kind)) {
    return new vscode.ThemeIcon("pass");
  }
  if (["definition", "fun", "function", "primrec", "inductive", "datatype", "record"].includes(kind)) {
    return new vscode.ThemeIcon("symbol-function");
  }
  return new vscode.ThemeIcon("symbol-keyword");
}

function isTheoryDocument(document: vscode.TextDocument): boolean {
  return document.languageId === "isabelle" || document.uri.fsPath.endsWith(".thy");
}
