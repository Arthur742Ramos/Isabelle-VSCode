import * as vscode from "vscode";
import {
  buildTheoryDependencyGraph,
  TheoryDependencyGraph,
  TheoryGraphImport,
  TheoryGraphNode,
  TheoryGraphSession
} from "./dependencyGraph";
import { SessionService } from "../session/SessionService";

type TheoryGraphTreeNode =
  | { kind: "message"; label: string; description?: string }
  | { kind: "session"; graphSession: TheoryGraphSession }
  | { kind: "category"; label: string; children: TheoryGraphTreeNode[] }
  | { kind: "sessionDependency"; sessionName: string }
  | { kind: "theory"; graphNode: TheoryGraphNode }
  | { kind: "import"; graphImport: TheoryGraphImport };

export class TheoryGraphTreeProvider implements vscode.TreeDataProvider<TheoryGraphTreeNode>, vscode.Disposable {
  private readonly didChangeTreeData = new vscode.EventEmitter<TheoryGraphTreeNode | undefined>();
  private readonly subscriptions: vscode.Disposable[] = [];
  private graph: TheoryDependencyGraph | undefined;

  public readonly onDidChangeTreeData = this.didChangeTreeData.event;

  public constructor(
    private readonly sessions: SessionService,
    private readonly output: vscode.OutputChannel
  ) {
    this.subscriptions.push(this.sessions.onDidChangeSessions(() => this.invalidate()));
  }

  public async refresh(): Promise<void> {
    this.graph = await buildTheoryDependencyGraph(this.sessions.getSessions());
    const externalImports = this.graph.nodes.reduce(
      (count, node) => count + node.imports.filter((graphImport) => graphImport.kind === "external").length,
      0
    );
    this.output.appendLine(
      `Built Isabelle theory graph: ${this.graph.nodes.length} theory node(s), ${this.graph.edges.length} resolved import edge(s), ${externalImports} external import(s).`
    );
    this.didChangeTreeData.fire(undefined);
  }

  public getTreeItem(element: TheoryGraphTreeNode): vscode.TreeItem {
    switch (element.kind) {
      case "message":
        return {
          label: element.label,
          description: element.description,
          collapsibleState: vscode.TreeItemCollapsibleState.None,
          iconPath: new vscode.ThemeIcon("info")
        };
      case "session":
        return this.sessionItem(element.graphSession);
      case "category":
        return {
          label: element.label,
          collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
          iconPath: new vscode.ThemeIcon("folder")
        };
      case "sessionDependency":
        return {
          label: element.sessionName,
          collapsibleState: vscode.TreeItemCollapsibleState.None,
          iconPath: new vscode.ThemeIcon("references")
        };
      case "theory":
        return this.theoryItem(element.graphNode);
      case "import":
        return this.importItem(element.graphImport);
    }
  }

  public async getChildren(element?: TheoryGraphTreeNode): Promise<TheoryGraphTreeNode[]> {
    const graph = await this.getGraph();
    if (!element) {
      if (graph.sessions.length === 0) {
        return [
          {
            kind: "message",
            label: "No Isabelle sessions discovered",
            description: "Run Isabelle: Discover Sessions"
          }
        ];
      }
      return graph.sessions.map((graphSession) => ({ kind: "session", graphSession }));
    }

    switch (element.kind) {
      case "session":
        return sessionChildren(graph, element.graphSession);
      case "category":
        return element.children;
      case "theory":
        return element.graphNode.imports.map((graphImport) => ({ kind: "import", graphImport }));
      default:
        return [];
    }
  }

  public dispose(): void {
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
    this.didChangeTreeData.dispose();
  }

  private invalidate(): void {
    this.graph = undefined;
    this.didChangeTreeData.fire(undefined);
  }

  private async getGraph(): Promise<TheoryDependencyGraph> {
    if (!this.graph) {
      await this.refresh();
    }
    if (!this.graph) {
      throw new Error("Unable to build Isabelle theory graph.");
    }
    return this.graph;
  }

  private sessionItem(graphSession: TheoryGraphSession): vscode.TreeItem {
    const dependencyCount = graphSession.sessionDependencies.length;
    const theoryCount = graphSession.theoryIds.length;
    const item = new vscode.TreeItem(graphSession.name, vscode.TreeItemCollapsibleState.Expanded);
    item.description = `${theoryCount} ${theoryCount === 1 ? "theory" : "theories"}`;
    item.tooltip = `${graphSession.name}\n${dependencyCount} session dependency${dependencyCount === 1 ? "" : "ies"}`;
    item.iconPath = new vscode.ThemeIcon("type-hierarchy");
    item.contextValue = "isabelleTheoryGraphSession";
    return item;
  }

  private theoryItem(graphNode: TheoryGraphNode): vscode.TreeItem {
    const resolved = graphNode.imports.filter((graphImport) => graphImport.kind === "resolved").length;
    const external = graphNode.imports.length - resolved;
    const item = new vscode.TreeItem(
      graphNode.theoryName,
      graphNode.imports.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
    );
    item.description = importSummary(resolved, external);
    item.tooltip = [
      graphNode.declaredName && graphNode.declaredName !== graphNode.theoryName
        ? `Declares: ${graphNode.declaredName}`
        : undefined,
      graphNode.path,
      `${graphNode.importedBy.length} dependent theor${graphNode.importedBy.length === 1 ? "y" : "ies"}`
    ]
      .filter(isString)
      .join("\n");
    item.iconPath = new vscode.ThemeIcon(graphNode.path ? "symbol-class" : "warning");
    item.contextValue = "isabelleTheoryGraphTheory";

    if (graphNode.path) {
      item.resourceUri = vscode.Uri.file(graphNode.path);
      item.command = {
        command: "isabelle.openTheory",
        title: "Open Isabelle Theory",
        arguments: [graphNode.path]
      };
    }

    return item;
  }

  private importItem(graphImport: TheoryGraphImport): vscode.TreeItem {
    const item = new vscode.TreeItem(graphImport.name, vscode.TreeItemCollapsibleState.None);
    item.description =
      graphImport.kind === "resolved" && graphImport.targetSessionName
        ? graphImport.targetSessionName
        : "external or unresolved";
    item.tooltip =
      graphImport.kind === "resolved" && graphImport.targetTheoryName
        ? `Resolves to ${graphImport.targetTheoryName}`
        : "Not resolved to a discovered workspace theory.";
    item.iconPath = new vscode.ThemeIcon(graphImport.kind === "resolved" ? "references" : "warning");
    item.contextValue = graphImport.kind === "resolved" ? "isabelleTheoryGraphImport" : "isabelleTheoryGraphExternalImport";
    return item;
  }
}

function sessionChildren(graph: TheoryDependencyGraph, graphSession: TheoryGraphSession): TheoryGraphTreeNode[] {
  const children: TheoryGraphTreeNode[] = [];

  if (graphSession.sessionDependencies.length > 0) {
    children.push({
      kind: "category",
      label: "Session Dependencies",
      children: graphSession.sessionDependencies.map((sessionName) => ({ kind: "sessionDependency", sessionName }))
    });
  }

  const theories = graphSession.theoryIds
    .map((theoryId) => graph.nodes.find((node) => node.id === theoryId))
    .filter(isTheoryGraphNode);
  if (theories.length > 0) {
    children.push({
      kind: "category",
      label: "Theories",
      children: theories.map((graphNode) => ({ kind: "theory", graphNode }))
    });
  }

  return children;
}

function importSummary(resolved: number, external: number): string | undefined {
  const parts: string[] = [];
  if (resolved > 0) {
    parts.push(`${resolved} resolved`);
  }
  if (external > 0) {
    parts.push(`${external} external`);
  }
  return parts.length > 0 ? parts.join(", ") : undefined;
}

function isTheoryGraphNode(value: TheoryGraphNode | undefined): value is TheoryGraphNode {
  return value !== undefined;
}

function isString(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}
