import * as vscode from "vscode";
import { BackendManager } from "./backend/BackendManager";
import { HealthParams, HealthResult, VersionParams, VersionResult } from "./protocol/messages";
import { discoverWorkspaceSessions } from "./session/workspaceDiscovery";

let backendManager: BackendManager | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Isabelle PIDE");
  backendManager = new BackendManager(context, output);

  context.subscriptions.push(
    output,
    backendManager,
    vscode.commands.registerCommand("isabelle.showVersion", async () => showVersion(output)),
    vscode.commands.registerCommand("isabelle.checkBackendHealth", async () => checkBackendHealth(output)),
    vscode.commands.registerCommand("isabelle.discoverSessions", async () => discoverSessions(output))
  );
}

export function deactivate(): void {
  backendManager?.dispose();
  backendManager = undefined;
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

async function discoverSessions(output: vscode.OutputChannel): Promise<void> {
  try {
    const workspaceFolders = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? [];
    if (workspaceFolders.length === 0) {
      vscode.window.showWarningMessage("Open a workspace folder before discovering Isabelle sessions.");
      return;
    }

    const extraRoots = vscode.workspace.getConfiguration("isabelle").get<string[]>("session.roots", []);
    const result = await discoverWorkspaceSessions({ workspaceFolders, extraRoots });

    output.appendLine(`Discovered ${result.sessions.length} Isabelle session(s).`);
    for (const session of result.sessions) {
      const parent = session.parent ? ` = ${session.parent}` : "";
      output.appendLine(`- ${session.name}${parent} (${session.rootDirectory})`);
    }

    if (result.sessions.length === 0) {
      vscode.window.showInformationMessage("No Isabelle ROOT sessions found in the current workspace.");
    } else {
      vscode.window.showInformationMessage(`Discovered ${result.sessions.length} Isabelle session(s).`);
      output.show(true);
    }
  } catch (error) {
    showBackendError("Unable to discover Isabelle sessions", error, output);
  }
}

function requireBackendManager(): BackendManager {
  if (!backendManager) {
    throw new Error("Isabelle extension is not activated.");
  }
  return backendManager;
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
