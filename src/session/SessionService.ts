import * as vscode from "vscode";
import { DiscoverSessionsParams, DiscoverSessionsResult, DiscoveredSession } from "../protocol/messages";
import {
  BackendSessionDiscover,
  discoverSessionsWithBackendFallback,
  formatDiscoveryError
} from "./backendSessionDiscovery";

export class SessionService implements vscode.Disposable {
  private readonly didChangeSessions = new vscode.EventEmitter<DiscoverSessionsResult>();
  private sessions: DiscoveredSession[] = [];

  public readonly onDidChangeSessions = this.didChangeSessions.event;

  public constructor(
    private readonly output: vscode.OutputChannel,
    private readonly backendDiscover?: BackendSessionDiscover
  ) {}

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
    const roots = config.get<string[]>("session.roots", []);
    const afpPath = config.get<string>("session.afpPath", "").trim();
    const params: DiscoverSessionsParams = {
      workspaceFolders,
      roots,
      afpPath: afpPath.length > 0 ? afpPath : undefined
    };
    const discovery = await discoverSessionsWithBackendFallback(params, this.backendDiscover);
    this.sessions = discovery.result.sessions;
    this.didChangeSessions.fire(discovery.result);

    if (discovery.fallbackError) {
      this.output.appendLine(
        `Backend session discovery failed; using local workspace discovery: ${formatDiscoveryError(discovery.fallbackError)}`
      );
    }
    this.output.appendLine(
      `Discovered ${discovery.result.sessions.length} Isabelle session(s) via ${discovery.source} discovery.`
    );
    for (const session of discovery.result.sessions) {
      const parent = session.parent ? ` = ${session.parent}` : "";
      this.output.appendLine(`- ${session.name}${parent} (${session.sessionDirectory})`);
    }

    return discovery.result;
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
