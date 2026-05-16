import * as vscode from "vscode";
import { BackendManager } from "./backend/BackendManager";
import { BuildService } from "./build/BuildService";
import { DocumentSyncService } from "./document/DocumentSyncService";
import { ProofStatePanel } from "./proof/ProofStatePanel";
import { HealthParams, HealthResult, VersionParams, VersionResult } from "./protocol/messages";
import { REPAIR_PREVIEW_SCHEME, RepairPreviewProvider } from "./repair/RepairPreviewProvider";
import { RepairService } from "./repair/RepairService";
import { IsabelleHoverProvider } from "./semantic/IsabelleHoverProvider";
import {
  ISABELLE_SEMANTIC_TOKENS_LEGEND,
  IsabelleSemanticTokensProvider
} from "./semantic/IsabelleSemanticTokensProvider";
import { SessionService } from "./session/SessionService";
import { SessionTreeProvider } from "./session/SessionTreeProvider";
import { SledgehammerPanel } from "./sledgehammer/SledgehammerPanel";
import { TheoryGraphTreeProvider } from "./theoryGraph/TheoryGraphTreeProvider";
import { formatUserVisibleError } from "./ui/errorMessages";

let backendManager: BackendManager | undefined;
let buildService: BuildService | undefined;
let documentSyncService: DocumentSyncService | undefined;
let proofStatePanel: ProofStatePanel | undefined;
let repairPreviewProvider: RepairPreviewProvider | undefined;
let repairService: RepairService | undefined;
let sessionService: SessionService | undefined;
let sledgehammerPanel: SledgehammerPanel | undefined;
let statusBar: vscode.StatusBarItem | undefined;
let theoryGraphTree: TheoryGraphTreeProvider | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Isabelle PIDE");
  backendManager = new BackendManager(context, output);
  buildService = new BuildService(output);
  sessionService = new SessionService(output);
  documentSyncService = new DocumentSyncService(backendManager, output, () => sessionService?.getActiveSessionName());
  proofStatePanel = new ProofStatePanel(backendManager, output);
  sledgehammerPanel = new SledgehammerPanel(backendManager, output, () => sessionService?.getActiveSessionName());
  repairPreviewProvider = new RepairPreviewProvider();
  repairService = new RepairService(backendManager, output, repairPreviewProvider);
  const sessionTree = new SessionTreeProvider(sessionService, async () => discoverSessions(output, { silent: true }));
  theoryGraphTree = new TheoryGraphTreeProvider(sessionService, output);
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.command = "isabelle.selectSession";
  updateSessionStatus();
  statusBar.show();

  context.subscriptions.push(
    output,
    backendManager,
    buildService,
    documentSyncService,
    proofStatePanel,
    repairPreviewProvider,
    sessionService,
    sledgehammerPanel,
    sessionTree,
    theoryGraphTree,
    statusBar,
    vscode.languages.registerDocumentSemanticTokensProvider(
      { language: "isabelle", scheme: "file" },
      new IsabelleSemanticTokensProvider(),
      ISABELLE_SEMANTIC_TOKENS_LEGEND
    ),
    vscode.languages.registerHoverProvider({ language: "isabelle", scheme: "file" }, new IsabelleHoverProvider()),
    vscode.window.registerTreeDataProvider("isabelle.sessions", sessionTree),
    vscode.window.registerTreeDataProvider("isabelle.theoryGraph", theoryGraphTree),
    vscode.window.registerWebviewViewProvider("isabelle.proofState", proofStatePanel),
    vscode.window.registerWebviewViewProvider("isabelle.sledgehammer", sledgehammerPanel),
    vscode.workspace.registerTextDocumentContentProvider(REPAIR_PREVIEW_SCHEME, repairPreviewProvider),
    vscode.commands.registerCommand("isabelle.showVersion", async () => showVersion(output)),
    vscode.commands.registerCommand("isabelle.checkBackendHealth", async () => checkBackendHealth(output)),
    vscode.commands.registerCommand("isabelle.discoverSessions", async () => discoverSessions(output)),
    vscode.commands.registerCommand("isabelle.refreshSessions", async () => discoverSessions(output)),
    vscode.commands.registerCommand("isabelle.selectSession", async (sessionName?: string) => selectSession(sessionName, output)),
    vscode.commands.registerCommand("isabelle.openTheory", async (theoryPath?: string) => openTheory(theoryPath)),
    vscode.commands.registerCommand("isabelle.buildActiveSession", async () => buildActiveSession(output)),
    vscode.commands.registerCommand("isabelle.cancelBuild", () => cancelBuild()),
    vscode.commands.registerCommand("isabelle.resyncOpenTheories", async () => documentSyncService?.resyncOpenTheories()),
    vscode.commands.registerCommand("isabelle.refreshProofState", async () => proofStatePanel?.refresh()),
    vscode.commands.registerCommand("isabelle.runSledgehammer", async () => sledgehammerPanel?.run()),
    vscode.commands.registerCommand("isabelle.cancelSledgehammer", async () => sledgehammerPanel?.cancel()),
    vscode.commands.registerCommand("isabelle.insertSledgehammerProof", async () => sledgehammerPanel?.insertFirstSuggestion()),
    vscode.commands.registerCommand("isabelle.createRepairRequest", async () => repairService?.createRepairRequest()),
    vscode.commands.registerCommand("isabelle.previewRepairPatch", async () => repairService?.previewRepairPatch()),
    vscode.commands.registerCommand("isabelle.checkRepairWorkspace", async () => repairService?.checkCurrentWorkspaceForRepair()),
    vscode.commands.registerCommand("isabelle.refreshTheoryGraph", async () => refreshTheoryGraph(output)),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("isabelle.session.active")) {
        updateSessionStatus();
      }
    })
  );

  documentSyncService.start();
}

export function deactivate(): void {
  documentSyncService?.dispose();
  documentSyncService = undefined;
  proofStatePanel?.dispose();
  proofStatePanel = undefined;
  sledgehammerPanel?.dispose();
  sledgehammerPanel = undefined;
  repairPreviewProvider?.dispose();
  repairPreviewProvider = undefined;
  repairService = undefined;
  backendManager?.dispose();
  backendManager = undefined;
  buildService?.dispose();
  buildService = undefined;
  sessionService?.dispose();
  sessionService = undefined;
  theoryGraphTree?.dispose();
  theoryGraphTree = undefined;
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

async function refreshTheoryGraph(output: vscode.OutputChannel): Promise<void> {
  try {
    const service = requireSessionService();
    if (service.getSessions().length === 0) {
      await service.refresh();
    }

    await requireTheoryGraphTree().refresh();
    vscode.window.showInformationMessage("Refreshed Isabelle theory graph.");
  } catch (error) {
    showBackendError("Unable to refresh Isabelle theory graph", error, output);
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

function requireTheoryGraphTree(): TheoryGraphTreeProvider {
  if (!theoryGraphTree) {
    throw new Error("Isabelle theory graph tree is not activated.");
  }
  return theoryGraphTree;
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
  const formatted = formatUserVisibleError(prefix, error);
  output.appendLine(formatted.logMessage);
  void vscode.window.showErrorMessage(formatted.notificationMessage, "Open Output").then((selection) => {
    if (selection === "Open Output") {
      output.show(true);
    }
  });
}

function updateSessionStatus(): void {
  if (!statusBar || !sessionService) {
    return;
  }

  const active = sessionService.getActiveSessionName();
  statusBar.text = active ? `$(check) Isabelle: ${active}` : "$(symbol-namespace) Isabelle: No session";
  statusBar.tooltip = active ? "Active Isabelle session" : "Select an Isabelle session";
}
