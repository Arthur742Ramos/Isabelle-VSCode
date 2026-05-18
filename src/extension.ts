import * as vscode from "vscode";
import { BackendManager } from "./backend/BackendManager";
import {
  createIsabellePideExtensionApi,
  IsabellePideExtensionApi
} from "./api/IsabellePideExtensionApi";
import { PideDocumentationCache } from "./api/PideDocumentationCache";
import {
  browseIsabelleDocumentation,
  SHOW_DOCUMENTATION_COMMAND_ID,
  ShowDocumentationQuickPickItem,
  ShowDocumentationUi
} from "./api/browseIsabelleDocumentation";
import { PidePreviewSubscriber } from "./api/PidePreviewSubscriber";
import {
  PREVIEW_THEORY_COMMAND_ID,
  PREVIEW_THEORY_SPLIT_COMMAND_ID,
  PreviewTheoryActiveEditor,
  PreviewTheoryPanel,
  PreviewTheoryUi,
  previewActiveTheory,
  wirePreviewSnapshotsToPanel
} from "./api/previewTheory";
import {
  EXCLUDE_WORD_COMMAND_ID,
  EXCLUDE_WORD_PERMANENTLY_COMMAND_ID,
  INCLUDE_WORD_COMMAND_ID,
  INCLUDE_WORD_PERMANENTLY_COMMAND_ID,
  RESET_WORDS_COMMAND_ID,
  SpellCheckerCaretEditor,
  SpellCheckerUi,
  SpellCheckerWordAction,
  dispatchResetWords,
  dispatchSpellCheckerWord
} from "./api/spellCheckerCommands";
import { BuildService } from "./build/BuildService";
import { createBuildCommand } from "./build/buildArgs";
import { CommandSpanDecorationsService } from "./document/CommandSpanDecorations";
import { DocumentStatusService } from "./document/DocumentStatusService";
import { DocumentSyncService } from "./document/DocumentSyncService";
import { PideDecorationOverlayService } from "./document/PideDecorationOverlayService";
import { IsabelleLanguageClient } from "./lsp/IsabelleLanguageClient";
import { LanguageServerStatusBar } from "./lsp/LanguageServerStatusBar";
import { IsabelleLanguageServerStatus } from "./lsp/lspTypes";
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
import { ManualPasteBackRepairAiProvider } from "./repair/ManualPasteBackRepairAiProvider";
import { RepairAiProviderRegistry } from "./repair/repairAiProvider";
import { RepairAiSecretStore } from "./repair/RepairAiSecretStore";
import { RepairService } from "./repair/RepairService";
import { RepairVerificationContext } from "./repair/verificationPlan";
import { IsabelleDefinitionProvider } from "./semantic/IsabelleDefinitionProvider";
import { IsabelleDocumentLinkProvider } from "./semantic/IsabelleDocumentLinkProvider";
import { IsabelleDocumentSymbolProvider } from "./semantic/IsabelleDocumentSymbolProvider";
import { IsabelleHoverProvider } from "./semantic/IsabelleHoverProvider";
import { PideAbbrevsCache } from "./semantic/PideAbbrevsCache";
import { registerPideAbbrevsCompletionProvider } from "./semantic/PideAbbrevsCompletionProvider";
import {
  ISABELLE_SEMANTIC_TOKENS_LEGEND,
  IsabelleSemanticTokensProvider
} from "./semantic/IsabelleSemanticTokensProvider";
import { TheoryOutlineTreeProvider } from "./semantic/TheoryOutlineTreeProvider";
import { SessionService } from "./session/SessionService";
import { SessionTreeProvider } from "./session/SessionTreeProvider";
import { SledgehammerPanel } from "./sledgehammer/SledgehammerPanel";
import { PideQuiescenceTracker } from "./sledgehammer/PideQuiescenceTracker";
import { PideSledgehammerProversCache } from "./sledgehammer/PideSledgehammerProversCache";
import { TheoryGraphTreeProvider } from "./theoryGraph/TheoryGraphTreeProvider";
import { formatUserVisibleError } from "./ui/errorMessages";
import { PrerequisiteChecker, PrerequisiteState } from "./setup/PrerequisiteChecker";
import { realAutoDetectDependencies, realSpawn } from "./setup/runtime";
import {
  LanguageServerStartupDecision,
  computeAutoStartFailureKey,
  decideLanguageServerStartup
} from "./setup/lspAutoStart";

let backendManager: BackendManager | undefined;
let buildService: BuildService | undefined;
let commandSpanDecorationsService: CommandSpanDecorationsService | undefined;
let documentStatusService: DocumentStatusService | undefined;
let documentSyncService: DocumentSyncService | undefined;
let languageClient: IsabelleLanguageClient | undefined;
let languageServerStatusBar: LanguageServerStatusBar | undefined;
let pideQuiescenceTracker: PideQuiescenceTracker | undefined;
let pideSledgehammerProversCache: PideSledgehammerProversCache | undefined;
let pideDecorationOverlayService: PideDecorationOverlayService | undefined;
let pideAbbrevsCache: PideAbbrevsCache | undefined;
let pideDocumentationCache: PideDocumentationCache | undefined;
let pidePreviewSubscriber: PidePreviewSubscriber | undefined;
let pidePreviewPanel: vscode.WebviewPanel | undefined;
let pidePreviewSnapshotWiring: { dispose(): void } | undefined;
let proofOutlineProvider: ProofOutlineProvider | undefined;
let proofStatePanel: ProofStatePanel | undefined;
let repairPreviewProvider: RepairPreviewProvider | undefined;
let repairAiProviderRegistry: RepairAiProviderRegistry | undefined;
let repairAiSecretStore: RepairAiSecretStore | undefined;
let repairService: RepairService | undefined;
let sessionService: SessionService | undefined;
let sledgehammerPanel: SledgehammerPanel | undefined;
let statusBar: vscode.StatusBarItem | undefined;
let theoryGraphTree: TheoryGraphTreeProvider | undefined;
let theoryOutlineTree: TheoryOutlineTreeProvider | undefined;
let prerequisiteChecker: PrerequisiteChecker | undefined;

export function activate(context: vscode.ExtensionContext): IsabellePideExtensionApi {
  const output = vscode.window.createOutputChannel("Isabelle PIDE");
  backendManager = new BackendManager(context, output);
  buildService = new BuildService(output);
  const sessions = new SessionService(output, (params) =>
    backendManager!.getClient().request<DiscoverSessionsResult, DiscoverSessionsParams>("session/discover", params)
  );
  sessionService = sessions;
  documentSyncService = new DocumentSyncService(backendManager, output, () => sessions.getActiveSessionName());
  documentStatusService = new DocumentStatusService(documentSyncService, output);
  languageClient = new IsabelleLanguageClient(output, () => getIsabelleExecutablePath());
  languageServerStatusBar = new LanguageServerStatusBar(languageClient);
  pideSledgehammerProversCache = new PideSledgehammerProversCache(languageClient, output);
  pideQuiescenceTracker = new PideQuiescenceTracker(vscode.workspace);
  commandSpanDecorationsService = new CommandSpanDecorationsService(documentSyncService, languageClient);
  pideDecorationOverlayService = new PideDecorationOverlayService(languageClient, output);
  pideAbbrevsCache = new PideAbbrevsCache(languageClient, output);
  pideDocumentationCache = new PideDocumentationCache(languageClient, output);
  pidePreviewSubscriber = new PidePreviewSubscriber(languageClient, output);
  pidePreviewSnapshotWiring = wirePreviewSnapshotsToPanel(
    pidePreviewSubscriber,
    makePreviewTheoryUi()
  );
  proofStatePanel = new ProofStatePanel(backendManager, output, languageClient);
  proofOutlineProvider = new ProofOutlineProvider(documentSyncService, sessions);
  sledgehammerPanel = new SledgehammerPanel(
    backendManager,
    output,
    () => sessions.getActiveSessionName(),
    languageClient,
    pideSledgehammerProversCache,
    pideQuiescenceTracker
  );
  repairPreviewProvider = new RepairPreviewProvider();
  repairAiProviderRegistry = new RepairAiProviderRegistry();
  repairAiSecretStore = new RepairAiSecretStore(context.secrets);
  repairAiProviderRegistry.register(
    new ManualPasteBackRepairAiProvider({
      writeClipboard: (text) => Promise.resolve(vscode.env.clipboard.writeText(text)),
      showInformationMessage: (message, ...actions) =>
        Promise.resolve(vscode.window.showInformationMessage(message, ...actions)),
      showPatchOpenDialog: async () => {
        const picked = await vscode.window.showOpenDialog({
          canSelectFiles: true,
          canSelectFolders: false,
          canSelectMany: false,
          filters: {
            "Patch files": ["patch", "diff"],
            "All files": ["*"]
          },
          openLabel: "Use as AI repair patch"
        });
        return picked?.[0]?.fsPath;
      },
      readTextFile: async (p) => {
        const fs = await import("fs");
        return fs.promises.readFile(p, "utf8");
      }
    })
  );
  prerequisiteChecker = createPrerequisiteChecker(context, output);
  repairService = new RepairService(
    backendManager,
    output,
    repairPreviewProvider,
    createRepairVerificationContext,
    repairAiProviderRegistry
  );
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
    languageClient,
    languageServerStatusBar,
    pideQuiescenceTracker,
    pideSledgehammerProversCache,
    pideDecorationOverlayService,
    pideAbbrevsCache,
    pideDocumentationCache,
    pidePreviewSubscriber,
    proofOutlineProvider,
    proofStatePanel,
    repairPreviewProvider,
    sessions,
    sledgehammerPanel,
    sessionTree,
    theoryGraphTree,
    theoryOutlineTree,
    statusBar,
    prerequisiteChecker,
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
    registerPideAbbrevsCompletionProvider(pideAbbrevsCache),
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
    vscode.commands.registerCommand("isabelle.pickSledgehammerSuggestion", async () => sledgehammerPanel?.pickAndInsertSuggestion()),
    vscode.commands.registerCommand("isabelle.replaySledgehammerRun", async (requestId?: string) =>
      replaySledgehammerRun(requestId)
    ),
    vscode.commands.registerCommand("isabelle.clearSledgehammerHistory", () => sledgehammerPanel?.clearHistory()),
    vscode.commands.registerCommand("isabelle.createRepairRequest", async () => repairService?.createRepairRequest()),
    vscode.commands.registerCommand("isabelle.copyRepairRequestToClipboard", async () => repairService?.copyRepairRequestToClipboard()),
    vscode.commands.registerCommand("isabelle.requestAiRepairSuggestion", async () => repairService?.requestAiRepairSuggestion()),
    vscode.commands.registerCommand("isabelle.setAiProviderSecret", async () => setAiProviderSecret(output)),
    vscode.commands.registerCommand("isabelle.clearAiProviderSecret", async () => clearAiProviderSecret(output)),
    vscode.commands.registerCommand("isabelle.previewRepairPatch", async () => repairService?.previewRepairPatch()),
    vscode.commands.registerCommand("isabelle.checkRepairWorkspace", async () => repairService?.checkCurrentWorkspaceForRepair()),
    vscode.commands.registerCommand("isabelle.refreshTheoryGraph", async () => refreshTheoryGraph(output)),
    vscode.commands.registerCommand("isabelle.showTheoryDependents", async () => showTheoryDependents(output)),
    vscode.commands.registerCommand("isabelle.toggleTheoryGraphMode", () => toggleTheoryGraphMode()),
    vscode.commands.registerCommand("isabelle.refreshTheoryOutline", () => theoryOutlineTree?.refresh()),
    vscode.commands.registerCommand("isabelle.startLanguageServer", async () => startLanguageServer(output)),
    vscode.commands.registerCommand("isabelle.stopLanguageServer", async () => stopLanguageServer(output)),
    vscode.commands.registerCommand("isabelle.restartLanguageServer", async () => restartLanguageServer(output)),
    vscode.commands.registerCommand("isabelle.showLanguageServerStatus", () => showLanguageServerStatus()),
    vscode.commands.registerCommand(SHOW_DOCUMENTATION_COMMAND_ID, () => browseDocumentationCommand(output)),
    vscode.commands.registerCommand(PREVIEW_THEORY_COMMAND_ID, () => previewTheoryCommand(output, { split: false })),
    vscode.commands.registerCommand(PREVIEW_THEORY_SPLIT_COMMAND_ID, () => previewTheoryCommand(output, { split: true })),
    vscode.commands.registerCommand(INCLUDE_WORD_COMMAND_ID, () => spellCheckerWordCommand(output, "include")),
    vscode.commands.registerCommand(INCLUDE_WORD_PERMANENTLY_COMMAND_ID, () => spellCheckerWordCommand(output, "include-permanently")),
    vscode.commands.registerCommand(EXCLUDE_WORD_COMMAND_ID, () => spellCheckerWordCommand(output, "exclude")),
    vscode.commands.registerCommand(EXCLUDE_WORD_PERMANENTLY_COMMAND_ID, () => spellCheckerWordCommand(output, "exclude-permanently")),
    vscode.commands.registerCommand(RESET_WORDS_COMMAND_ID, () => spellCheckerResetCommand(output)),
    vscode.commands.registerCommand("isabelle.toggleProofStateAutoUpdate", () => toggleProofStateAutoUpdateCommand()),
    vscode.commands.registerCommand("isabelle.relocateProofState", () => relocateProofStateCommand()),
    vscode.commands.registerCommand("isabelle.checkPrerequisites", () => runPrerequisiteCheck({ force: true })),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("isabelle.session.active")) {
        updateSessionStatus();
      }
      if (
        event.affectsConfiguration("isabelle.executablePath") ||
        event.affectsConfiguration("isabelle.languageServer.enabled") ||
        event.affectsConfiguration("isabelle.languageServer.extraArgs") ||
        event.affectsConfiguration("isabelle.languageServer.autoStart")
      ) {
        // Any of these changes invalidate a previously recorded auto-start
        // failure: the user might have fixed the underlying problem (new
        // Isabelle path, different args) or explicitly toggled enabled.
        clearAutoStartFailureFlags(context);
      }
      if (event.affectsConfiguration("isabelle.languageServer.enabled")) {
        const enabled = vscode.workspace
          .getConfiguration("isabelle")
          .get<boolean>("languageServer.enabled", false);
        if (enabled) {
          void languageClient?.start().catch((error) => {
            output.appendLine(
              `Isabelle language server: start failed after configuration change: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
          });
        } else {
          void languageClient?.stop().catch((error) => {
            output.appendLine(
              `Isabelle language server: stop failed after configuration change: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
          });
        }
      }
    })
  );

  documentSyncService.start();
  documentStatusService.start();
  commandSpanDecorationsService.start();
  pideDecorationOverlayService.start();

  // Explicit-enable path stays fast: if the user has *explicitly* set
  // `isabelle.languageServer.enabled: true` at any scope, start the
  // client immediately in parallel with the prerequisite probe so we
  // don't add startup latency to users who deliberately opted in.
  const initialDecision = decideExtensionLanguageServerStartup(context);
  if (initialDecision === "explicit-start") {
    void languageClient.start().catch((error) => {
      output.appendLine(
        `Isabelle language server: initial start failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    });
  }

  // Auto-start path: kick off the prerequisite check, then conditionally
  // start the LSP once the probe finishes. Decision-making goes through
  // the pure helper so the policy is unit-tested.
  void (async () => {
    try {
      const state = await runPrerequisiteCheck();
      if (!state) {
        return;
      }
      const decision = decideExtensionLanguageServerStartup(context, state);
      if (decision === "auto-start") {
        await attemptLanguageServerAutoStart(context, output);
      }
    } catch (error) {
      output.appendLine(
        `Isabelle prerequisite check: unexpected failure: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  })();

  return createIsabellePideExtensionApi(repairAiProviderRegistry, repairAiSecretStore);
}

function createPrerequisiteChecker(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel
): PrerequisiteChecker {
  const walkthroughId = `${context.extension.id}#isabelle.getStarted`;
  return new PrerequisiteChecker({
    spawn: realSpawn,
    autoDetect: realAutoDetectDependencies(),
    walkthroughId,
    logger: {
      log: (message) => output.appendLine(`Isabelle setup: ${message}`)
    },
    ui: {
      showInformation: (message, ...actions) =>
        Promise.resolve(vscode.window.showInformationMessage(message, ...actions)),
      showWarning: (message, ...actions) =>
        Promise.resolve(vscode.window.showWarningMessage(message, ...actions)),
      executeCommand: (command, ...args) =>
        Promise.resolve(vscode.commands.executeCommand(command, ...args)),
      setContext: (key, value) =>
        Promise.resolve(vscode.commands.executeCommand("setContext", key, value)),
      hasWorkspaceFolders: () => Boolean(vscode.workspace.workspaceFolders?.length),
      getConfig: <T,>(section: string, defaultValue: T): T =>
        vscode.workspace.getConfiguration("isabelle").get<T>(section, defaultValue),
      updateConfig: (section, value, target) =>
        Promise.resolve(
          vscode.workspace
            .getConfiguration("isabelle")
            .update(
              section,
              value,
              target === 1
                ? vscode.ConfigurationTarget.Global
                : target === 2
                  ? vscode.ConfigurationTarget.Workspace
                  : vscode.ConfigurationTarget.WorkspaceFolder
            )
        )
    }
  });
}

async function runPrerequisiteCheck(
  options: { readonly force?: boolean } = {}
): Promise<PrerequisiteState | undefined> {
  if (!prerequisiteChecker) {
    return undefined;
  }
  const state = await prerequisiteChecker.runCheck();
  await prerequisiteChecker.notifyIfMissing(state, options);
  return state;
}

/**
 * Snapshot of the `isabelle.languageServer.enabled` setting across every
 * scope so we can distinguish "user explicitly set it" from "it's still at
 * the package default of false". Iterating workspace folders catches the
 * multi-root case the rubber-duck flagged.
 */
function inspectLanguageServerEnabledAcrossScopes(): {
  explicitEnabled: boolean;
  explicitDisabled: boolean;
} {
  const inspections = [
    vscode.workspace.getConfiguration("isabelle").inspect<boolean>("languageServer.enabled"),
    ...(vscode.workspace.workspaceFolders ?? []).map((folder) =>
      vscode.workspace
        .getConfiguration("isabelle", folder.uri)
        .inspect<boolean>("languageServer.enabled")
    )
  ];
  let explicitEnabled = false;
  let explicitDisabled = false;
  for (const inspection of inspections) {
    if (!inspection) continue;
    for (const value of [
      inspection.globalValue,
      inspection.workspaceValue,
      inspection.workspaceFolderValue
    ]) {
      if (value === true) explicitEnabled = true;
      if (value === false) explicitDisabled = true;
    }
  }
  return { explicitEnabled, explicitDisabled };
}

function resolveAutoStartFailureKey(): string {
  const config = vscode.workspace.getConfiguration("isabelle");
  const executable = config.get<string>("executablePath", "isabelle");
  const extraArgs = config.get<readonly string[]>("languageServer.extraArgs", []);
  return computeAutoStartFailureKey(executable, extraArgs);
}

function decideExtensionLanguageServerStartup(
  context: vscode.ExtensionContext,
  prereqState?: PrerequisiteState
): LanguageServerStartupDecision {
  const { explicitEnabled, explicitDisabled } = inspectLanguageServerEnabledAcrossScopes();
  const autoStartSetting = vscode.workspace
    .getConfiguration("isabelle")
    .get<boolean>("languageServer.autoStart", true);
  const failureKey = resolveAutoStartFailureKey();
  const autoStartFailedForResolved = Boolean(context.workspaceState.get<boolean>(failureKey));
  return decideLanguageServerStartup({
    explicitEnabled,
    explicitDisabled,
    autoStartSetting,
    javaOk: prereqState?.java ?? false,
    isabelleOk: prereqState?.isabelle ?? false,
    autoStartFailedForResolved
  });
}

async function attemptLanguageServerAutoStart(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel
): Promise<void> {
  if (!languageClient) return;
  output.appendLine(
    "Isabelle language server: Isabelle detected, auto-starting. " +
      "To opt out, set `isabelle.languageServer.enabled` to false or " +
      "`isabelle.languageServer.autoStart` to false."
  );
  try {
    await languageClient.start();
  } catch (error) {
    output.appendLine(
      `Isabelle language server: auto-start threw: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  // start() swallows reach-check / spawn failures and transitions the
  // client to state: "failed" internally — checking the status is the
  // only reliable way to detect that case.
  const status = languageClient.getStatus();
  const failureKey = resolveAutoStartFailureKey();
  if (status.state === "failed") {
    await context.workspaceState.update(failureKey, true);
    const openSettings = "Open Settings";
    const showOutput = "Show Output";
    const choice = await vscode.window.showWarningMessage(
      `Isabelle PIDE: language server auto-start failed (${
        status.lastError ?? "see output"
      }). Auto-start is disabled for this runtime until you change the configuration.`,
      openSettings,
      showOutput
    );
    if (choice === openSettings) {
      void vscode.commands.executeCommand("workbench.action.openSettings", "isabelle.languageServer");
    } else if (choice === showOutput) {
      output.show(true);
    }
  } else {
    // Successful auto-start clears any stale failure flag for this exact
    // resolved runtime so the next activation won't second-guess it.
    if (context.workspaceState.get<boolean>(failureKey)) {
      await context.workspaceState.update(failureKey, undefined);
    }
  }
}

/**
 * Wipe every workspaceState entry whose key starts with the
 * auto-start-failure prefix. Called when any setting that affects the
 * resolved runtime changes, so a user fixing the underlying issue
 * (different Isabelle path, different args, explicit toggle) gets a
 * fresh chance on the next activation.
 */
function clearAutoStartFailureFlags(context: vscode.ExtensionContext): void {
  for (const key of context.workspaceState.keys()) {
    if (key.startsWith("isabelle.lsp.autoStartFailed.")) {
      void context.workspaceState.update(key, undefined);
    }
  }
}

export async function deactivate(): Promise<void> {
  pideSledgehammerProversCache?.dispose();
  pideSledgehammerProversCache = undefined;
  pideAbbrevsCache?.dispose();
  pideAbbrevsCache = undefined;
  pideDocumentationCache?.dispose();
  pideDocumentationCache = undefined;
  pidePreviewSnapshotWiring?.dispose();
  pidePreviewSnapshotWiring = undefined;
  pidePreviewSubscriber?.dispose();
  pidePreviewSubscriber = undefined;
  pidePreviewPanel?.dispose();
  pidePreviewPanel = undefined;
  pideQuiescenceTracker?.dispose();
  pideQuiescenceTracker = undefined;
  await languageClient?.shutdown();
  languageClient = undefined;
  languageServerStatusBar?.dispose();
  languageServerStatusBar = undefined;
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
  repairAiSecretStore = undefined;
  repairAiProviderRegistry = undefined;
  backendManager?.dispose();
  backendManager = undefined;
  buildService?.dispose();
  buildService = undefined;
  documentStatusService?.dispose();
  documentStatusService = undefined;
  commandSpanDecorationsService?.dispose();
  commandSpanDecorationsService = undefined;
  pideDecorationOverlayService?.dispose();
  pideDecorationOverlayService = undefined;
  sessionService?.dispose();
  sessionService = undefined;
  theoryGraphTree?.dispose();
  theoryGraphTree = undefined;
  theoryOutlineTree?.dispose();
  theoryOutlineTree = undefined;
  statusBar?.dispose();
  statusBar = undefined;
}

async function setAiProviderSecret(output: vscode.OutputChannel): Promise<void> {
  if (!repairAiSecretStore || !repairAiProviderRegistry) {
    vscode.window.showWarningMessage("AI repair seam is not initialised.");
    return;
  }
  const known = repairAiProviderRegistry.listIds();
  const configured = vscode.workspace
    .getConfiguration("isabelle")
    .get<string>("repair.aiProvider", "")
    .trim();
  const fallbackId = configured.length > 0 ? configured : (known[0] ?? "");
  const providerId = await vscode.window.showInputBox({
    title: "Set AI repair provider secret",
    prompt:
      "Provider id (matches RepairAiProvider.id). Stored under isabelle.repair.aiSecret.<id> via vscode.SecretStorage.",
    value: fallbackId,
    ignoreFocusOut: true,
    placeHolder: "my-provider"
  });
  if (!providerId) {
    return;
  }
  const secret = await vscode.window.showInputBox({
    title: `Secret for "${providerId}"`,
    prompt: "Leave empty to delete the existing entry.",
    password: true,
    ignoreFocusOut: true
  });
  if (secret === undefined) {
    return;
  }
  try {
    await repairAiSecretStore.set(providerId, secret);
    if (secret.length === 0) {
      vscode.window.showInformationMessage(
        `Cleared the stored secret for AI repair provider "${providerId}".`
      );
    } else {
      vscode.window.showInformationMessage(
        `Stored a secret for AI repair provider "${providerId}". Providers can read it via the extension API.`
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    output.appendLine(`Set AI provider secret failed: ${message}`);
    vscode.window.showErrorMessage(`Unable to store AI repair secret: ${message}`);
  }
}

async function clearAiProviderSecret(output: vscode.OutputChannel): Promise<void> {
  if (!repairAiSecretStore || !repairAiProviderRegistry) {
    vscode.window.showWarningMessage("AI repair seam is not initialised.");
    return;
  }
  const known = repairAiProviderRegistry.listIds();
  const configured = vscode.workspace
    .getConfiguration("isabelle")
    .get<string>("repair.aiProvider", "")
    .trim();
  const fallbackId = configured.length > 0 ? configured : (known[0] ?? "");
  const providerId = await vscode.window.showInputBox({
    title: "Clear AI repair provider secret",
    prompt: "Provider id whose stored secret should be deleted.",
    value: fallbackId,
    ignoreFocusOut: true,
    placeHolder: "my-provider"
  });
  if (!providerId) {
    return;
  }
  try {
    await repairAiSecretStore.clear(providerId);
    vscode.window.showInformationMessage(
      `Cleared the stored secret for AI repair provider "${providerId}".`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    output.appendLine(`Clear AI provider secret failed: ${message}`);
    vscode.window.showErrorMessage(`Unable to clear AI repair secret: ${message}`);
  }
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

async function showTheoryDependents(output: vscode.OutputChannel): Promise<void> {
  try {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isTheoryDocument(editor.document) || editor.document.uri.scheme !== "file") {
      vscode.window.showInformationMessage("Open an Isabelle theory file to look up its dependents.");
      return;
    }

    const service = requireSessionService();
    if (service.getSessions().length === 0) {
      await service.refresh();
    }

    const tree = requireTheoryGraphTree();
    const node = await tree.findTheoryByPath(editor.document.uri.fsPath);
    if (!node) {
      vscode.window.showInformationMessage(
        "The active theory is not part of the discovered Isabelle theory graph. Run Isabelle: Discover Sessions and try again."
      );
      return;
    }

    const dependents = await tree.getReverseDependencies(node.id);
    if (dependents.length === 0) {
      vscode.window.showInformationMessage(
        `No discovered Isabelle theory imports ${node.theoryName}.`
      );
      return;
    }

    const picked = await vscode.window.showQuickPick(
      dependents.map((entry) => ({
        label: entry.importerTheoryName,
        description: entry.importerSessionName,
        detail: entry.importerPath ?? "(no source file recorded)",
        entry
      })),
      {
        title: `Isabelle theories that import ${node.theoryName}`,
        placeHolder: "Select a dependent theory to open",
        matchOnDescription: true,
        matchOnDetail: true
      }
    );

    if (!picked) {
      return;
    }

    if (!picked.entry.importerPath) {
      vscode.window.showInformationMessage(
        `${picked.entry.importerTheoryName} has no source file recorded in the discovered graph.`
      );
      return;
    }

    await openTheory(picked.entry.importerPath);
  } catch (error) {
    showBackendError("Unable to compute Isabelle theory dependents", error, output);
  }
}

function toggleTheoryGraphMode(): void {
  const mode = requireTheoryGraphTree().toggleViewMode();
  const label = mode === "dependents" ? "Dependents (imported by)" : "Dependencies (imports)";
  vscode.window.showInformationMessage(`Isabelle theory graph mode: ${label}.`);
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

async function startLanguageServer(output: vscode.OutputChannel): Promise<void> {
  if (!languageClient) {
    return;
  }
  try {
    await vscode.workspace
      .getConfiguration("isabelle")
      .update("languageServer.enabled", true, vscode.ConfigurationTarget.Workspace);
    await languageClient.start();
  } catch (error) {
    showBackendError("Unable to start Isabelle language server", error, output);
  }
}

async function stopLanguageServer(output: vscode.OutputChannel): Promise<void> {
  if (!languageClient) {
    return;
  }
  try {
    await vscode.workspace
      .getConfiguration("isabelle")
      .update("languageServer.enabled", false, vscode.ConfigurationTarget.Workspace);
    await languageClient.stop();
  } catch (error) {
    showBackendError("Unable to stop Isabelle language server", error, output);
  }
}

async function restartLanguageServer(output: vscode.OutputChannel): Promise<void> {
  if (!languageClient) {
    return;
  }
  try {
    await vscode.workspace
      .getConfiguration("isabelle")
      .update("languageServer.enabled", true, vscode.ConfigurationTarget.Workspace);
    await languageClient.restart();
  } catch (error) {
    showBackendError("Unable to restart Isabelle language server", error, output);
  }
}

function showLanguageServerStatus(): void {
  if (!languageClient) {
    void vscode.window.showInformationMessage("Isabelle language server is not initialized.");
    return;
  }

  const status = languageClient.getStatus();
  void vscode.window.showInformationMessage(
    formatLanguageServerStatus(status),
    { modal: false }
  );
}

async function browseDocumentationCommand(output: vscode.OutputChannel): Promise<void> {
  if (!languageClient || !pideDocumentationCache) {
    await vscode.window.showInformationMessage(
      "Isabelle documentation is not initialized yet."
    );
    return;
  }
  const ui: ShowDocumentationUi = {
    showQuickPick: async (items, options) => {
      const picked = await vscode.window.showQuickPick(
        items.map((item) => ({
          label: item.label,
          description: item.description,
          detail: item.detail,
          entry: item.entry
        })),
        {
          placeHolder: options?.placeHolder,
          matchOnDescription: options?.matchOnDescription,
          matchOnDetail: options?.matchOnDetail
        }
      );
      return picked
        ? ({
            label: picked.label,
            description: picked.description,
            detail: picked.detail,
            entry: picked.entry
          } as ShowDocumentationQuickPickItem)
        : undefined;
    },
    showInformationMessage: async (message) =>
      vscode.window.showInformationMessage(message),
    showWarningMessage: async (message) =>
      vscode.window.showWarningMessage(message),
    openExternalFile: async (platformPath) =>
      vscode.env.openExternal(vscode.Uri.file(platformPath))
  };
  await browseIsabelleDocumentation(
    pideDocumentationCache,
    languageClient,
    output,
    ui
  );
}

async function previewTheoryCommand(
  output: vscode.OutputChannel,
  options: { split: boolean }
): Promise<void> {
  if (!languageClient || !pidePreviewSubscriber) {
    await vscode.window.showInformationMessage(
      "Isabelle theory preview is not initialized yet."
    );
    return;
  }
  await previewActiveTheory(
    pidePreviewSubscriber,
    languageClient,
    makePreviewTheoryUi(),
    options
  );
}

function makePreviewTheoryUi(): PreviewTheoryUi {
  return {
    getActiveEditor: () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return undefined;
      return {
        uri: editor.document.uri.toString(),
        isTheoryDocument: isTheoryDocument(editor.document),
        viewColumn: editor.viewColumn ?? vscode.ViewColumn.One
      };
    },
    resolvePreviewColumn: (editor, split) => {
      if (!split) {
        return editor.viewColumn;
      }
      // Mirror upstream `vscode_lib.adjacent_editor_column`: place
      // the preview in the next viewColumn, wrapping at the limit.
      const next = editor.viewColumn + 1;
      return next > vscode.ViewColumn.Nine ? vscode.ViewColumn.One : next;
    },
    ensurePanel: (initialColumn) => {
      if (!pidePreviewPanel) {
        pidePreviewPanel = vscode.window.createWebviewPanel(
          "isabelle.preview",
          "Isabelle Preview",
          initialColumn,
          { enableScripts: false }
        );
        pidePreviewPanel.onDidDispose(() => {
          pidePreviewPanel = undefined;
        });
      }
      const panel = pidePreviewPanel;
      return {
        setContent: (title, html) => {
          panel.title = title;
          panel.webview.html = html;
        },
        reveal: (column) => panel.reveal(column),
        dispose: () => panel.dispose()
      };
    },
    showInformationMessage: async (message) =>
      vscode.window.showInformationMessage(message),
    showWarningMessage: async (message) =>
      vscode.window.showWarningMessage(message)
  };
}

async function spellCheckerWordCommand(
  output: vscode.OutputChannel,
  action: SpellCheckerWordAction
): Promise<void> {
  if (!languageClient) {
    await vscode.window.showInformationMessage(
      "Isabelle language server is not initialized yet."
    );
    return;
  }
  await dispatchSpellCheckerWord(
    action,
    languageClient,
    languageClient,
    makeSpellCheckerUi(),
    output
  );
}

async function spellCheckerResetCommand(output: vscode.OutputChannel): Promise<void> {
  if (!languageClient) {
    await vscode.window.showInformationMessage(
      "Isabelle language server is not initialized yet."
    );
    return;
  }
  await dispatchResetWords(
    languageClient,
    languageClient,
    makeSpellCheckerUi(),
    output
  );
}

function makeSpellCheckerUi(): SpellCheckerUi {
  return {
    getActiveEditor: (): SpellCheckerCaretEditor | undefined => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return undefined;
      return {
        uri: editor.document.uri.toString(),
        isTheoryDocument: isTheoryDocument(editor.document),
        line: editor.selection.active.line,
        character: editor.selection.active.character
      };
    },
    showInformationMessage: async (message) =>
      vscode.window.showInformationMessage(message)
  };
}

function toggleProofStateAutoUpdateCommand(): void {
  if (!proofStatePanel) {
    void vscode.window.showInformationMessage(
      "Isabelle proof state panel is not initialized yet."
    );
    return;
  }
  const enabled = proofStatePanel.toggleAutoUpdate();
  // Persist the user's choice into the workspace setting so reloads
  // pick it up and so the setting reflects the new value in the UI.
  const config = vscode.workspace.getConfiguration("isabelle");
  void config.update("proofState.autoUpdate", enabled, vscode.ConfigurationTarget.Workspace);
  void vscode.window.showInformationMessage(
    `Isabelle proof state auto-update is now ${enabled ? "on" : "off"}.`
  );
}

function relocateProofStateCommand(): void {
  if (!proofStatePanel) {
    void vscode.window.showInformationMessage(
      "Isabelle proof state panel is not initialized yet."
    );
    return;
  }
  proofStatePanel.requestLocate();
}

function formatLanguageServerStatus(status: IsabelleLanguageServerStatus): string {
  const parts: string[] = [`Isabelle language server: ${status.state}`];
  if (status.commandLine) {
    parts.push(`Command: ${status.commandLine}`);
  }
  if (status.isabelleVersion) {
    parts.push(`Isabelle: ${status.isabelleVersion}`);
  }
  if (status.lastStartedAt) {
    parts.push(`Last started: ${status.lastStartedAt}`);
  }
  if (status.lastStoppedAt) {
    parts.push(`Last stopped: ${status.lastStoppedAt}`);
  }
  if (status.lastError) {
    parts.push(`Last error: ${status.lastError}`);
  }
  return parts.join(" \u00b7 ");
}

function isTheoryDocument(document: vscode.TextDocument): boolean {
  return document.languageId === "isabelle" || document.uri.fsPath.endsWith(".thy");
}
