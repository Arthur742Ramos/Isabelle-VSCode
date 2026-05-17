import * as vscode from "vscode";
import { BackendManager } from "./backend/BackendManager";
import { BuildService } from "./build/BuildService";
import { createBuildCommand } from "./build/buildArgs";
import { CommandSpanDecorationsService } from "./document/CommandSpanDecorations";
import { DocumentStatusService } from "./document/DocumentStatusService";
import { DocumentSyncService } from "./document/DocumentSyncService";
import { ProofOutlineProvider } from "./proof/ProofOutlineProvider";
import {
  findCommandSpanAtOrBefore,
  nextCommandSpan,
  previousCommandSpan,
  ProofAction,
  proofActionsForCommand
} from "./proof/proofOutline";
import { ProofStatePanel } from "./proof/ProofStatePanel";
import {
  CommandSpan,
  DiscoverSessionsParams,
  DiscoverSessionsResult,
  HealthParams,
  HealthResult,
  ProtocolPosition,
  VersionParams,
  VersionResult
} from "./protocol/messages";
import { REPAIR_PREVIEW_SCHEME, RepairPreviewProvider } from "./repair/RepairPreviewProvider";
import { RepairService } from "./repair/RepairService";
import { RepairVerificationContext } from "./repair/verificationPlan";
import { IsabelleDefinitionProvider } from "./semantic/IsabelleDefinitionProvider";
import { IsabelleDocumentLinkProvider } from "./semantic/IsabelleDocumentLinkProvider";
import { IsabelleDocumentSymbolProvider } from "./semantic/IsabelleDocumentSymbolProvider";
import { IsabelleHoverProvider } from "./semantic/IsabelleHoverProvider";
import {
  ISABELLE_SEMANTIC_TOKENS_LEGEND,
  IsabelleSemanticTokensProvider
} from "./semantic/IsabelleSemanticTokensProvider";
import { TheoryOutlineTreeProvider } from "./semantic/TheoryOutlineTreeProvider";
import { SessionService } from "./session/SessionService";
import { SessionTreeProvider } from "./session/SessionTreeProvider";
import { SledgehammerPanel } from "./sledgehammer/SledgehammerPanel";
import { TheoryGraphTreeProvider } from "./theoryGraph/TheoryGraphTreeProvider";
import { formatUserVisibleError } from "./ui/errorMessages";

let backendManager: BackendManager | undefined;
let buildService: BuildService | undefined;
let commandSpanDecorationsService: CommandSpanDecorationsService | undefined;
let documentStatusService: DocumentStatusService | undefined;
let documentSyncService: DocumentSyncService | undefined;
let proofOutlineProvider: ProofOutlineProvider | undefined;
let proofStatePanel: ProofStatePanel | undefined;
let repairPreviewProvider: RepairPreviewProvider | undefined;
let repairService: RepairService | undefined;
let sessionService: SessionService | undefined;
let sledgehammerPanel: SledgehammerPanel | undefined;
let statusBar: vscode.StatusBarItem | undefined;
let theoryGraphTree: TheoryGraphTreeProvider | undefined;
let theoryOutlineTree: TheoryOutlineTreeProvider | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Isabelle PIDE");
  backendManager = new BackendManager(context, output);
  buildService = new BuildService(output);
  const sessions = new SessionService(output, (params) =>
    backendManager!.getClient().request<DiscoverSessionsResult, DiscoverSessionsParams>("session/discover", params)
  );
  sessionService = sessions;
  documentSyncService = new DocumentSyncService(backendManager, output, () => sessions.getActiveSessionName());
  documentStatusService = new DocumentStatusService(documentSyncService, output);
  commandSpanDecorationsService = new CommandSpanDecorationsService(documentSyncService);
  proofStatePanel = new ProofStatePanel(backendManager, output);
  proofOutlineProvider = new ProofOutlineProvider(documentSyncService, sessions);
  sledgehammerPanel = new SledgehammerPanel(backendManager, output, () => sessions.getActiveSessionName());
  repairPreviewProvider = new RepairPreviewProvider();
  repairService = new RepairService(backendManager, output, repairPreviewProvider, createRepairVerificationContext);
  const sessionTree = new SessionTreeProvider(sessions, async () => discoverSessions(output, { silent: true }));
  theoryGraphTree = new TheoryGraphTreeProvider(sessions, output);
  theoryOutlineTree = new TheoryOutlineTreeProvider(documentSyncService);
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.command = "isabelle.selectSession";
  updateSessionStatus();
  statusBar.show();

  context.subscriptions.push(
    output,
    backendManager,
    buildService,
    commandSpanDecorationsService,
    documentStatusService,
    documentSyncService,
    proofOutlineProvider,
    proofStatePanel,
    repairPreviewProvider,
    sessions,
    sledgehammerPanel,
    sessionTree,
    theoryGraphTree,
    theoryOutlineTree,
    statusBar,
    vscode.languages.registerDocumentSemanticTokensProvider(
      { language: "isabelle", scheme: "file" },
      new IsabelleSemanticTokensProvider(),
      ISABELLE_SEMANTIC_TOKENS_LEGEND
    ),
    vscode.languages.registerHoverProvider({ language: "isabelle", scheme: "file" }, new IsabelleHoverProvider()),
    vscode.languages.registerDocumentLinkProvider(
      { language: "isabelle", scheme: "file" },
      new IsabelleDocumentLinkProvider(sessions)
    ),
    vscode.languages.registerDocumentSymbolProvider(
      { language: "isabelle", scheme: "file" },
      new IsabelleDocumentSymbolProvider(documentSyncService)
    ),
    vscode.languages.registerDefinitionProvider(
      { language: "isabelle", scheme: "file" },
      new IsabelleDefinitionProvider(documentSyncService, sessions, output)
    ),
    vscode.window.registerTreeDataProvider("isabelle.sessions", sessionTree),
    vscode.window.registerTreeDataProvider("isabelle.theoryGraph", theoryGraphTree),
    vscode.window.registerTreeDataProvider("isabelle.theoryOutline", theoryOutlineTree),
    vscode.window.registerTreeDataProvider("isabelle.proofOutline", proofOutlineProvider),
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
    vscode.commands.registerCommand("isabelle.showDocumentStatus", () => documentStatusService?.showActiveDocumentStatus()),
    vscode.commands.registerCommand("isabelle.refreshProofOutline", () => proofOutlineProvider?.refresh()),
    vscode.commands.registerCommand("isabelle.refreshProofState", async () => proofStatePanel?.refresh()),
    vscode.commands.registerCommand("isabelle.nextCommand", async () => navigateCommand("next", output)),
    vscode.commands.registerCommand("isabelle.previousCommand", async () => navigateCommand("previous", output)),
    vscode.commands.registerCommand("isabelle.revealCurrentCommand", async () => revealCurrentCommand(output)),
    vscode.commands.registerCommand("isabelle.showProofActions", async () => showProofActions(output)),
    vscode.commands.registerCommand("isabelle.revealCommandSpan", async (uri: string, span: CommandSpan) => revealCommandSpan(uri, span)),
    vscode.commands.registerCommand("isabelle.runSledgehammer", async () => sledgehammerPanel?.run()),
    vscode.commands.registerCommand("isabelle.cancelSledgehammer", async () => sledgehammerPanel?.cancel()),
    vscode.commands.registerCommand("isabelle.insertSledgehammerProof", async () => sledgehammerPanel?.insertFirstSuggestion()),
    vscode.commands.registerCommand("isabelle.replaySledgehammerRun", async (requestId?: string) =>
      replaySledgehammerRun(requestId)
    ),
    vscode.commands.registerCommand("isabelle.clearSledgehammerHistory", () => sledgehammerPanel?.clearHistory()),
    vscode.commands.registerCommand("isabelle.createRepairRequest", async () => repairService?.createRepairRequest()),
    vscode.commands.registerCommand("isabelle.previewRepairPatch", async () => repairService?.previewRepairPatch()),
    vscode.commands.registerCommand("isabelle.checkRepairWorkspace", async () => repairService?.checkCurrentWorkspaceForRepair()),
    vscode.commands.registerCommand("isabelle.refreshTheoryGraph", async () => refreshTheoryGraph(output)),
    vscode.commands.registerCommand("isabelle.refreshTheoryOutline", () => theoryOutlineTree?.refresh()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("isabelle.session.active")) {
        updateSessionStatus();
      }
    })
  );

  documentSyncService.start();
  documentStatusService.start();
  commandSpanDecorationsService.start();
}

export function deactivate(): void {
  documentSyncService?.dispose();
  documentSyncService = undefined;
  proofOutlineProvider?.dispose();
  proofOutlineProvider = undefined;
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
  documentStatusService?.dispose();
  documentStatusService = undefined;
  commandSpanDecorationsService?.dispose();
  commandSpanDecorationsService = undefined;
  sessionService?.dispose();
  sessionService = undefined;
  theoryGraphTree?.dispose();
  theoryGraphTree = undefined;
  theoryOutlineTree?.dispose();
  theoryOutlineTree = undefined;
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

async function createRepairVerificationContext(): Promise<RepairVerificationContext | undefined> {
  try {
    const service = requireSessionService();
    const sessions = service.getSessions().length > 0 ? service.getSessions() : (await service.refresh()).sessions;
    const session = service.getActiveSession() ?? (sessions.length === 1 ? sessions[0] : undefined);

    if (!session) {
      vscode.window.showWarningMessage(
        "No active Isabelle session was selected; the repair verification plan will include generic check instructions."
      );
      return undefined;
    }

    const config = vscode.workspace.getConfiguration("isabelle");
    const build = createBuildCommand({
      isabelleExecutablePath: getIsabelleExecutablePath(),
      sessionName: session.name,
      rootDirectories: [session.rootDirectory, session.sessionDirectory],
      extraArgs: config.get<string[]>("build.extraArgs", [])
    });

    return {
      session: {
        name: session.name,
        parent: session.parent,
        rootDirectory: session.rootDirectory,
        sessionDirectory: session.sessionDirectory
      },
      build: {
        command: build.command,
        args: build.args,
        workingDirectory: session.sessionDirectory
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showWarningMessage(
      `Unable to collect Isabelle build details for the repair verification plan: ${message}`
    );
    return undefined;
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

async function replaySledgehammerRun(requestId: string | undefined): Promise<void> {
  if (!sledgehammerPanel) {
    return;
  }

  if (requestId) {
    await sledgehammerPanel.replay(requestId);
    return;
  }

  const history = sledgehammerPanel.getHistory();
  if (history.length === 0) {
    vscode.window.showInformationMessage("No Sledgehammer history is available to replay.");
    return;
  }

  const picked = await vscode.window.showQuickPick(
    history.map((entry) => ({
      label: entry.commandSummary ?? entry.requestId,
      description: `${entry.status} \u00b7 ${entry.suggestionCount} suggestion(s)`,
      detail: `${entry.startedAt} \u00b7 ${entry.uri}`,
      requestId: entry.requestId
    })),
    {
      title: "Replay Sledgehammer Run",
      placeHolder: "Choose a Sledgehammer run to replay"
    }
  );

  if (picked) {
    await sledgehammerPanel.replay(picked.requestId);
  }
}

async function navigateCommand(direction: "next" | "previous", output: vscode.OutputChannel): Promise<void> {
  try {
    const context = getActiveCommandContext();
    if (!context) {
      return;
    }

    const position = protocolPosition(context.editor.selection.active);
    const target = direction === "next"
      ? nextCommandSpan(context.spans, position)
      : previousCommandSpan(context.spans, position);

    if (!target) {
      vscode.window.showInformationMessage(`No ${direction} Isabelle command found.`);
      return;
    }

    await revealCommandSpan(context.editor.document.uri.toString(), target);
  } catch (error) {
    showBackendError("Unable to navigate Isabelle command", error, output);
  }
}

async function revealCurrentCommand(output: vscode.OutputChannel): Promise<void> {
  try {
    const context = getActiveCommandContext();
    if (!context) {
      return;
    }

    const span = findCommandSpanAtOrBefore(context.spans, protocolPosition(context.editor.selection.active));
    if (!span) {
      vscode.window.showInformationMessage("No Isabelle command span at the current cursor position.");
      return;
    }

    await revealCommandSpan(context.editor.document.uri.toString(), span);
  } catch (error) {
    showBackendError("Unable to reveal current Isabelle command", error, output);
  }
}

async function showProofActions(output: vscode.OutputChannel): Promise<void> {
  try {
    const context = getActiveCommandContext();
    if (!context) {
      return;
    }

    const span = findCommandSpanAtOrBefore(context.spans, protocolPosition(context.editor.selection.active));
    const actions = proofActionsForCommand(span, sessionService?.getActiveSessionName());
    const selected = await vscode.window.showQuickPick(
      actions.map((action) => ({
        label: action.label,
        description: action.description,
        action
      })),
      {
        title: span ? `Isabelle Proof Actions: ${span.kind}${span.name ? ` ${span.name}` : ""}` : "Isabelle Proof Actions",
        placeHolder: "Choose a conservative proof action"
      }
    );

    if (!selected) {
      return;
    }

    await runProofAction(selected.action, context.editor, output);
  } catch (error) {
    showBackendError("Unable to run Isabelle proof action", error, output);
  }
}

async function runProofAction(
  action: ProofAction,
  editor: vscode.TextEditor,
  output: vscode.OutputChannel
): Promise<void> {
  switch (action.kind) {
    case "refreshProofState":
      await proofStatePanel?.refresh();
      return;
    case "buildActiveSession":
      await buildActiveSession(output);
      return;
    case "insertSorry":
    case "insertOops":
      if (!action.commandText) {
        throw new Error(`Proof action ${action.kind} did not provide command text.`);
      }
      await insertProofCommand(editor, action.commandText);
      return;
  }
}

async function revealCommandSpan(uriString: string, span: CommandSpan): Promise<void> {
  const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(uriString));
  const editor = await vscode.window.showTextDocument(document);
  const range = vscodeRange(span);
  editor.selection = new vscode.Selection(range.start, range.start);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

async function insertProofCommand(editor: vscode.TextEditor, command: string): Promise<void> {
  const line = editor.document.lineAt(editor.selection.active.line);
  const indentation = /^\s*/.exec(line.text)?.[0] ?? "";
  const position = line.range.end;
  const insertedLine = line.lineNumber + 1;

  const edited = await editor.edit((edit) => {
    edit.insert(position, `\n${indentation}${command}`);
  });

  if (!edited) {
    throw new Error(`Unable to insert Isabelle proof command: ${command}`);
  }

  const cursor = new vscode.Position(insertedLine, indentation.length + command.length);
  editor.selection = new vscode.Selection(cursor, cursor);
}

function getActiveCommandContext(): { editor: vscode.TextEditor; spans: CommandSpan[] } | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isTheoryDocument(editor.document)) {
    vscode.window.showInformationMessage("Open an Isabelle theory to use proof-engineering tools.");
    return undefined;
  }

  const spans = requireDocumentSyncService().getCommandSpans(editor.document);
  if (spans.length === 0) {
    vscode.window.showInformationMessage("No Isabelle command spans found in the active theory.");
    return undefined;
  }

  return { editor, spans };
}

function protocolPosition(position: vscode.Position): ProtocolPosition {
  return {
    line: position.line,
    character: position.character
  };
}

function vscodeRange(span: CommandSpan): vscode.Range {
  return new vscode.Range(
    span.range.start.line,
    span.range.start.character,
    span.range.end.line,
    span.range.end.character
  );
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

function requireDocumentSyncService(): DocumentSyncService {
  if (!documentSyncService) {
    throw new Error("Isabelle document sync service is not activated.");
  }
  return documentSyncService;
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

function isTheoryDocument(document: vscode.TextDocument): boolean {
  return document.languageId === "isabelle" || document.uri.fsPath.endsWith(".thy");
}
