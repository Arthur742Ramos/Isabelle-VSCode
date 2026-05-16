import * as vscode from "vscode";
import { DiscoveredSession, DiscoveredTheory } from "../protocol/messages";
import { SessionService } from "./SessionService";

type SessionTreeNode =
  | { kind: "session"; session: DiscoveredSession }
  | { kind: "category"; session: DiscoveredSession; label: string; children: SessionTreeNode[] }
  | { kind: "theory"; session: DiscoveredSession; theory: DiscoveredTheory }
  | { kind: "import"; session: DiscoveredSession; importedSession: string }
  | { kind: "document"; session: DiscoveredSession; documentFile: string };

export class SessionTreeProvider implements vscode.TreeDataProvider<SessionTreeNode>, vscode.Disposable {
  private readonly didChangeTreeData = new vscode.EventEmitter<SessionTreeNode | undefined>();
  private readonly subscriptions: vscode.Disposable[] = [];

  public readonly onDidChangeTreeData = this.didChangeTreeData.event;

  public constructor(private readonly sessions: SessionService) {
    this.subscriptions.push(
      this.sessions.onDidChangeSessions(() => this.didChangeTreeData.fire(undefined)),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("isabelle.session.active")) {
          this.didChangeTreeData.fire(undefined);
        }
      })
    );
  }

  public refresh(): void {
    this.didChangeTreeData.fire(undefined);
  }

  public getTreeItem(element: SessionTreeNode): vscode.TreeItem {
    switch (element.kind) {
      case "session":
        return this.sessionItem(element.session);
      case "category":
        return {
          label: element.label,
          collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
          iconPath: new vscode.ThemeIcon("folder")
        };
      case "theory":
        return this.theoryItem(element.theory);
      case "import":
        return {
          label: element.importedSession,
          collapsibleState: vscode.TreeItemCollapsibleState.None,
          iconPath: new vscode.ThemeIcon("references")
        };
      case "document":
        return {
          label: element.documentFile,
          collapsibleState: vscode.TreeItemCollapsibleState.None,
          iconPath: new vscode.ThemeIcon("file")
        };
    }
  }

  public getChildren(element?: SessionTreeNode): SessionTreeNode[] {
    if (!element) {
      return this.sessions.getSessions().map((session) => ({ kind: "session", session }));
    }

    if (element.kind === "session") {
      return sessionChildren(element.session);
    }

    if (element.kind === "category") {
      return element.children;
    }

    return [];
  }

  public dispose(): void {
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
    this.didChangeTreeData.dispose();
  }

  private sessionItem(session: DiscoveredSession): vscode.TreeItem {
    const active = this.sessions.getActiveSessionName() === session.name;
    const item = new vscode.TreeItem(session.name, vscode.TreeItemCollapsibleState.Expanded);
    item.description = active ? "active" : session.parent ? `parent ${session.parent}` : undefined;
    item.tooltip = `${session.name}\n${session.sessionDirectory}`;
    item.iconPath = new vscode.ThemeIcon(active ? "check" : "symbol-namespace");
    item.contextValue = active ? "isabelleActiveSession" : "isabelleSession";
    item.command = {
      command: "isabelle.selectSession",
      title: "Select Isabelle Session",
      arguments: [session.name]
    };
    return item;
  }

  private theoryItem(theory: DiscoveredTheory): vscode.TreeItem {
    const item = new vscode.TreeItem(theory.name, vscode.TreeItemCollapsibleState.None);
    item.iconPath = new vscode.ThemeIcon(theory.path ? "symbol-class" : "warning");
    item.tooltip = theory.path ?? "Theory file was not found under the session directory.";
    item.contextValue = "isabelleTheory";

    if (theory.path) {
      item.resourceUri = vscode.Uri.file(theory.path);
      item.command = {
        command: "isabelle.openTheory",
        title: "Open Isabelle Theory",
        arguments: [theory.path]
      };
    }

    return item;
  }
}

function sessionChildren(session: DiscoveredSession): SessionTreeNode[] {
  const children: SessionTreeNode[] = [];

  if (session.theories.length > 0) {
    children.push({
      kind: "category",
      session,
      label: "Theories",
      children: session.theories.map((theory) => ({ kind: "theory", session, theory }))
    });
  }

  if (session.importedSessions.length > 0) {
    children.push({
      kind: "category",
      session,
      label: "Imported Sessions",
      children: session.importedSessions.map((importedSession) => ({ kind: "import", session, importedSession }))
    });
  }

  if (session.documentFiles.length > 0) {
    children.push({
      kind: "category",
      session,
      label: "Document Files",
      children: session.documentFiles.map((documentFile) => ({ kind: "document", session, documentFile }))
    });
  }

  return children;
}
