import * as vscode from "vscode";
import { BackendManager } from "./backend/BackendManager";
import { BuildService } from "./build/BuildService";
import { HealthParams, HealthResult, VersionParams, VersionResult } from "./protocol/messages";
import { SessionService } from "./session/SessionService";
import { SessionTreeProvider } from "./session/SessionTreeProvider";

let backendManager: BackendManager | undefined;
let buildService: BuildService | undefined;
let sessionService: SessionService | undefined;
let statusBar: vscode.StatusBarItem | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Isabelle PIDE");
  backendManager = new BackendManager(context, output);
  buildService = new BuildService(output);
  sessionService = new SessionService(output);
  const sessionTree = new SessionTreeProvider(sessionService);
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.command = "isabelle.selectSession";
  updateSessionStatus();
  statusBar.show();

  context.subscriptions.push(
    output,
    backendManager,
    buildService,
    sessionService,
    sessionTree,
    statusBar,
    vscode.window.registerTreeDataProvider("isabelle.sessions", sessionTree),
    vscode.commands.registerCommand("isabelle.showVersion", async () => showVersion(output)),
    vscode.commands.registerCommand("isabelle.checkBackendHealth", async () => checkBackendHealth(output)),
    vscode.commands.registerCommand("isabelle.discoverSessions", async () => discoverSessions(output)),
    vscode.commands.registerCommand("isabelle.refreshSessions", async () => discoverSessions(output)),
    vscode.commands.registerCommand("isabelle.selectSession", async (sessionName?: string) => selectSession(sessionName, output)),
    vscode.commands.registerCommand("isabelle.openTheory", async (theoryPath?: string) => openTheory(theoryPath)),
    vscode.commands.registerCommand("isabelle.buildActiveSession", async () => buildActiveSession(output)),
    vscode.commands.registerCommand("isabelle.cancelBuild", () => cancelBuild()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("isabelle.session.active")) {
        updateSessionStatus();
      }
    })
  );

  void discoverSessions(output, { silent: true });
}

export function deactivate(): void {
  backendManager?.dispose();
  backendManager = undefined;
  buildService?.dispose();
  buildService = undefined;
  sessionService?.dispose();
  sessionService = undefined;
  statusBar?.dispose();
  statusBar = undefined;
}

async function showVersion(output: vscode.OutputChannel): Promise<void> {
  try {
    const client = requireBackendManager().getClient();
    const executablePath = getIsabelleExecutablePath();
    const result = await client.request<VersionResult, VersionParams>("isabelle/version", {
      isabelleExecutablePath: executablePath
    });

    output.appendLine(`Isabelle executable: ${result.executablePath}`);
    output.appendLine(result.raw);
    vscode.window.showInformationMessage(`Isabelle version: ${result.version}`);
  } catch (error) {
    showBackendError("Unable to get Isabelle version", error, output);
  }
}

async function checkBackendHealth(output: vscode.OutputChannel): Promise<void> {
  try {
    const client = requireBackendManager().getClient();
    const result = await client.request<HealthResult, HealthParams>("server/health", {
      isabelleExecutablePath: getIsabelleExecutablePath()
    });

    output.appendLine(`Backend: ${result.backend.status} (${result.backend.implementation})`);
    output.appendLine(`Protocol version: ${result.protocolVersion}`);
    output.appendLine(formatIsabelleHealth(result));
    vscode.window.showInformationMessage(formatIsabelleHealth(result));
  } catch (error) {
    showBackendError("Unable to check Isabelle backend health", error, output);
  }
}

async function discoverSessions(output: vscode.OutputChannel, options: { silent?: boolean } = {}): Promise<void> {
  try {
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
      if (!options.silent) {
        vscode.window.showWarningMessage("Open a workspace folder before discovering Isabelle sessions.");
      }
      return;
    }

    const result = await requireSessionService().refresh();
    updateSessionStatus();

    if (result.sessions.length === 0 && !options.silent) {
      vscode.window.showInformationMessage("No Isabelle ROOT sessions found in the current workspace.");
    } else if (!options.silent) {
      vscode.window.showInformationMessage(`Discovered ${result.sessions.length} Isabelle session(s).`);
      output.show(true);
    }
  } catch (error) {
    showBackendError("Unable to discover Isabelle sessions", error, output);
  }
}

async function selectSession(sessionName: string | undefined, output: vscode.OutputChannel): Promise<void> {
  try {
    const service = requireSessionService();
    const sessions = service.getSessions().length > 0 ? service.getSessions() : (await service.refresh()).sessions;
    let selected = sessionName ? sessions.find((session) => session.name === sessionName) : undefined;
    if (!selected) {
      selected = await service.selectActiveSession();
    } else {
      await vscode.workspace
        .getConfiguration("isabelle")
        .update("session.active", selected.name, vscode.ConfigurationTarget.Workspace);
    }
    if (selected) {
      updateSessionStatus();
      vscode.window.showInformationMessage(`Active Isabelle session: ${selected.name}`);
    }
  } catch (error) {
    showBackendError("Unable to select Isabelle session", error, output);
  }
}

async function openTheory(theoryPath: string | undefined): Promise<void> {
  if (!theoryPath) {
    vscode.window.showWarningMessage("Choose a theory from the Isabelle Sessions tree to open it.");
    return;
  }

  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(theoryPath));
  await vscode.window.showTextDocument(document);
}

async function buildActiveSession(output: vscode.OutputChannel): Promise<void> {
  try {
    const service = requireSessionService();
    const sessions = service.getSessions().length > 0 ? service.getSessions() : (await service.refresh()).sessions;
    let session = service.getActiveSession();

    if (!session && sessions.length === 1) {
      session = sessions[0];
      await vscode.workspace
        .getConfiguration("isabelle")
        .update("session.active", session.name, vscode.ConfigurationTarget.Workspace);
      updateSessionStatus();
    }

    if (!session) {
      session = await service.selectActiveSession();
    }

    if (!session) {
      return;
    }

    const config = vscode.workspace.getConfiguration("isabelle");
    const exitCode = await requireBuildService().runBuild(session, {
      isabelleExecutablePath: getIsabelleExecutablePath(),
      extraArgs: config.get<string[]>("build.extraArgs", [])
    });

    if (exitCode === 0) {
      vscode.window.showInformationMessage(`Isabelle build succeeded: ${session.name}`);
    } else {
      vscode.window.showErrorMessage(`Isabelle build failed for ${session.name} with exit code ${exitCode}.`);
    }
  } catch (error) {
    showBackendError("Unable to build Isabelle session", error, output);
  }
}

function cancelBuild(): void {
  if (!requireBuildService().cancelBuild()) {
    vscode.window.showInformationMessage("No Isabelle build is running.");
  }
}

function requireBackendManager(): BackendManager {
  if (!backendManager) {
    throw new Error("Isabelle extension is not activated.");
  }
  return backendManager;
}

function requireSessionService(): SessionService {
  if (!sessionService) {
    throw new Error("Isabelle session service is not activated.");
  }
  return sessionService;
}

function requireBuildService(): BuildService {
  if (!buildService) {
    throw new Error("Isabelle build service is not activated.");
  }
  return buildService;
}

function getIsabelleExecutablePath(): string {
  return vscode.workspace.getConfiguration("isabelle").get<string>("executablePath", "isabelle");
}

function formatIsabelleHealth(result: HealthResult): string {
  if (result.isabelle.status === "ok") {
    return `Isabelle: ok (${result.isabelle.version ?? result.isabelle.executablePath ?? "unknown version"})`;
  }

  if (result.isabelle.status === "unavailable") {
    return `Isabelle: unavailable (${result.isabelle.reason ?? "no reason reported"})`;
  }

  return "Isabelle: unknown";
}

function showBackendError(prefix: string, error: unknown, output: vscode.OutputChannel): void {
  const message = error instanceof Error ? error.message : String(error);
  output.appendLine(`${prefix}: ${message}`);
  output.show(true);
  vscode.window.showErrorMessage(`${prefix}: ${message}`);
}

function updateSessionStatus(): void {
  if (!statusBar || !sessionService) {
    return;
  }

  const active = sessionService.getActiveSessionName();
  statusBar.text = active ? `$(check) Isabelle: ${active}` : "$(symbol-namespace) Isabelle: No session";
  statusBar.tooltip = active ? "Active Isabelle session" : "Select an Isabelle session";
}
