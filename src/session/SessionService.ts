import * as vscode from "vscode";
import { DiscoverSessionsResult, DiscoveredSession } from "../protocol/messages";
import { discoverWorkspaceSessions } from "./workspaceDiscovery";

export class SessionService implements vscode.Disposable {
  private readonly didChangeSessions = new vscode.EventEmitter<DiscoverSessionsResult>();
  private sessions: DiscoveredSession[] = [];

  public readonly onDidChangeSessions = this.didChangeSessions.event;

  public constructor(private readonly output: vscode.OutputChannel) {}

  public getSessions(): DiscoveredSession[] {
    return this.sessions;
  }

  public getActiveSessionName(): string | undefined {
    const configured = vscode.workspace.getConfiguration("isabelle").get<string>("session.active", "").trim();
    return configured.length > 0 ? configured : undefined;
  }

  public getActiveSession(): DiscoveredSession | undefined {
    const activeName = this.getActiveSessionName();
    return activeName ? this.sessions.find((session) => session.name === activeName) : undefined;
  }

  public async refresh(): Promise<DiscoverSessionsResult> {
    const workspaceFolders = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? [];
    if (workspaceFolders.length === 0) {
      this.sessions = [];
      const empty = { sessions: [] };
      this.didChangeSessions.fire(empty);
      return empty;
    }

    const config = vscode.workspace.getConfiguration("isabelle");
    const extraRoots = config.get<string[]>("session.roots", []);
    const afpPath = config.get<string>("session.afpPath", "").trim();
    const result = await discoverWorkspaceSessions({
      workspaceFolders,
      extraRoots,
      afpPath: afpPath.length > 0 ? afpPath : undefined
    });
    this.sessions = result.sessions;
    this.didChangeSessions.fire(result);

    this.output.appendLine(`Discovered ${result.sessions.length} Isabelle session(s).`);
    for (const session of result.sessions) {
      const parent = session.parent ? ` = ${session.parent}` : "";
      this.output.appendLine(`- ${session.name}${parent} (${session.sessionDirectory})`);
    }

    return result;
  }

  public async selectActiveSession(): Promise<DiscoveredSession | undefined> {
    const sessions = this.sessions.length > 0 ? this.sessions : (await this.refresh()).sessions;
    if (sessions.length === 0) {
      vscode.window.showInformationMessage("No Isabelle sessions found in the current workspace.");
      return undefined;
    }

    const selected = await vscode.window.showQuickPick(
      sessions.map((session) => ({
        label: session.name,
        description: session.parent ? `Parent: ${session.parent}` : undefined,
        detail: session.sessionDirectory,
        session
      })),
      {
        title: "Select Isabelle Session",
        placeHolder: "Choose the active Isabelle session for this workspace"
      }
    );

    if (!selected) {
      return undefined;
    }

    await vscode.workspace
      .getConfiguration("isabelle")
      .update("session.active", selected.session.name, vscode.ConfigurationTarget.Workspace);
    this.didChangeSessions.fire({ sessions: this.sessions });
    this.output.appendLine(`Active Isabelle session: ${selected.session.name}`);
    return selected.session;
  }

  public dispose(): void {
    this.didChangeSessions.dispose();
  }
}
