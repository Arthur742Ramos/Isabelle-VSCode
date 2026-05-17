import * as vscode from "vscode";
import {
  buildTheoryDependencyGraph,
  computeReverseDependencies,
  findNodeByPath,
  ReverseDependencyEntry,
  TheoryDependencyGraph,
  TheoryGraphNode,
  TheoryGraphSession,
  TheoryGraphViewMode,
  TheoryRelationEntry,
  theoryRelationEntries
} from "./dependencyGraph";
import { SessionService } from "../session/SessionService";

type TheoryGraphTreeNode =
  | { kind: "message"; label: string; description?: string }
  | { kind: "session"; graphSession: TheoryGraphSession }
  | { kind: "category"; label: string; children: TheoryGraphTreeNode[] }
  | { kind: "sessionDependency"; sessionName: string }
  | { kind: "theory"; graphNode: TheoryGraphNode }
  | { kind: "relation"; entry: TheoryRelationEntry };

export class TheoryGraphTreeProvider implements vscode.TreeDataProvider<TheoryGraphTreeNode>, vscode.Disposable {
  private readonly didChangeTreeData = new vscode.EventEmitter<TheoryGraphTreeNode | undefined>();
  private readonly subscriptions: vscode.Disposable[] = [];
  private graph: TheoryDependencyGraph | undefined;
  private reverseAdjacency: Map<string, ReverseDependencyEntry[]> = new Map();
  private viewMode: TheoryGraphViewMode = "dependencies";

  public readonly onDidChangeTreeData = this.didChangeTreeData.event;

  public constructor(
    private readonly sessions: SessionService,
    private readonly output: vscode.OutputChannel
  ) {
    this.subscriptions.push(this.sessions.onDidChangeSessions(() => this.invalidate()));
  }

  public async refresh(): Promise<void> {
    this.graph = await buildTheoryDependencyGraph(this.sessions.getSessions());
    this.reverseAdjacency = computeReverseDependencies(this.graph);
    const externalImports = this.graph.nodes.reduce(
      (count, node) => count + node.imports.filter((graphImport) => graphImport.kind === "external").length,
      0
    );
    const reverseDependents = [...this.reverseAdjacency.values()].reduce(
      (count, entries) => count + entries.length,
      0
    );
    this.output.appendLine(
      `Built Isabelle theory graph: ${this.graph.nodes.length} theory node(s), ${this.graph.edges.length} resolved import edge(s), ${externalImports} external import(s), ${reverseDependents} reverse dependent entr${reverseDependents === 1 ? "y" : "ies"}.`
    );
    this.didChangeTreeData.fire(undefined);
  }

  public getViewMode(): TheoryGraphViewMode {
    return this.viewMode;
  }

  public setViewMode(mode: TheoryGraphViewMode): void {
    if (this.viewMode === mode) {
      return;
    }
    this.viewMode = mode;
    this.didChangeTreeData.fire(undefined);
  }

  public toggleViewMode(): TheoryGraphViewMode {
    this.setViewMode(this.viewMode === "dependencies" ? "dependents" : "dependencies");
    return this.viewMode;
  }

  public async getReverseDependencies(theoryId: string): Promise<ReverseDependencyEntry[]> {
    await this.getGraph();
    return (this.reverseAdjacency.get(theoryId) ?? []).map((entry) => ({
      ...entry,
      importNames: [...entry.importNames]
    }));
  }

  public async findTheoryByPath(theoryPath: string): Promise<TheoryGraphNode | undefined> {
    const graph = await this.getGraph();
    return findNodeByPath(graph, theoryPath);
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
      case "relation":
        return this.relationItem(element.entry);
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
        return this.theoryChildren(graph, element.graphNode);
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
    this.reverseAdjacency = new Map();
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

  private theoryChildren(graph: TheoryDependencyGraph, graphNode: TheoryGraphNode): TheoryGraphTreeNode[] {
    return theoryRelationEntries(graph, this.reverseAdjacency, graphNode.id, this.viewMode).map((entry) => ({
      kind: "relation",
      entry
    }));
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
    const childCount = this.viewMode === "dependents"
      ? (this.reverseAdjacency.get(graphNode.id)?.length ?? 0)
      : graphNode.imports.length;
    const item = new vscode.TreeItem(
      graphNode.theoryName,
      childCount > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
    );

    if (this.viewMode === "dependents") {
      item.description = childCount > 0
        ? `${childCount} dependent ${childCount === 1 ? "theory" : "theories"}`
        : undefined;
    } else {
      const resolved = graphNode.imports.filter((graphImport) => graphImport.kind === "resolved").length;
      const external = graphNode.imports.length - resolved;
      item.description = importSummary(resolved, external);
    }

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

  private relationItem(entry: TheoryRelationEntry): vscode.TreeItem {
    if (entry.kind === "import") {
      return this.importRelationItem(entry);
    }
    return this.dependentRelationItem(entry);
  }

  private importRelationItem(entry: Extract<TheoryRelationEntry, { kind: "import" }>): vscode.TreeItem {
    const item = new vscode.TreeItem(entry.importName, vscode.TreeItemCollapsibleState.None);
    item.description = entry.external ? "external or unresolved" : entry.sessionName;
    item.tooltip = entry.external
      ? "Not resolved to a discovered workspace theory."
      : `Resolves to ${entry.theoryName}`;
    item.iconPath = new vscode.ThemeIcon(entry.external ? "warning" : "references");
    item.contextValue = entry.external ? "isabelleTheoryGraphExternalImport" : "isabelleTheoryGraphImport";
    return item;
  }

  private dependentRelationItem(entry: Extract<TheoryRelationEntry, { kind: "dependent" }>): vscode.TreeItem {
    const item = new vscode.TreeItem(entry.theoryName, vscode.TreeItemCollapsibleState.None);
    item.description = entry.sessionName;
    item.tooltip = [
      `Imported by ${entry.sessionName}.${entry.theoryName}`,
      entry.path,
      entry.importNames.length > 0 ? `Import statements: ${entry.importNames.join(", ")}` : undefined
    ]
      .filter(isString)
      .join("\n");
    item.iconPath = new vscode.ThemeIcon(entry.path ? "arrow-left" : "warning");
    item.contextValue = "isabelleTheoryGraphDependent";

    if (entry.path) {
      item.resourceUri = vscode.Uri.file(entry.path);
      item.command = {
        command: "isabelle.openTheory",
        title: "Open Isabelle Theory",
        arguments: [entry.path]
      };
    }

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
