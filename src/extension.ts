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
import {
  isEmptyPreviewSnapshot,
  PidePreviewSnapshot,
  PidePreviewSubscriber
} from "./api/PidePreviewSubscriber";
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
import { ProofGapAuditService } from "./audit/ProofGapAuditService";
import { BuildService } from "./build/BuildService";
import { createBuildCommand } from "./build/buildArgs";
import { CommandSpanDecorationsService } from "./document/CommandSpanDecorations";
import { DocumentStatusService } from "./document/DocumentStatusService";
import { DocumentSyncService } from "./document/DocumentSyncService";
import { PideDecorationOverlayService } from "./document/PideDecorationOverlayService";
import { IsabelleLanguageClient } from "./lsp/IsabelleLanguageClient";
import { LanguageServerStatusBar } from "./lsp/LanguageServerStatusBar";
import { resolveLanguageServerRuntime } from "./lsp/languageServerRuntime";
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
  PideVersionParams,
  PideVersionResult,
  ProtocolPosition,
  VersionParams,
  VersionResult,
  CheckWithPideParams,
  CheckWithPideResult,
  WarmupParams,
  WarmupResult,
  InvalidatePideCacheResult,
  ProofStateWithPideParams,
  ProofStateWithPideResult,
  SledgehammerRunParams,
  SledgehammerRunResult
} from "./protocol/messages";
import { formatPideBackendStatus } from "./backend/showPideBackendStatus";
import { formatPideDocumentStatus, formatErrorMessages } from "./backend/showPideDocumentStatus";
import { formatPideProofState } from "./backend/showPideProofState";
import { parseProofBody } from "./sledgehammer/minimizeProofParser";
import { runCheckWithPideUx } from "./backend/checkWithPide";
import { decideOomToast } from "./backend/oomToast";
import { SESSION_CASCADE_HOL_WARNING_KEY } from "./session/sessionCascade";
import { resolvePideSession, ResolvePideSessionDeps } from "./session/resolvePideSession";
import { REPAIR_PREVIEW_SCHEME, RepairPreviewProvider } from "./repair/RepairPreviewProvider";
import { ManualPasteBackRepairAiProvider } from "./repair/ManualPasteBackRepairAiProvider";
import { RepairAiProviderRegistry } from "./repair/repairAiProvider";
import { RepairAiSecretStore } from "./repair/RepairAiSecretStore";
import { RepairService } from "./repair/RepairService";
import { RepairVerificationContext } from "./repair/verificationPlan";
import { IsabelleDefinitionProvider } from "./semantic/IsabelleDefinitionProvider";
import { IsabelleDocumentLinkProvider } from "./semantic/IsabelleDocumentLinkProvider";
import { IsabelleDocumentSymbolProvider } from "./semantic/IsabelleDocumentSymbolProvider";
import { IsabelleFoldingRangeProvider } from "./semantic/IsabelleFoldingRangeProvider";
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
import {
  ExplainModeAccessors,
  ExplainModeReport,
  LanguageServerEnabledSetting,
  buildExplainModeReport
} from "./setup/explainCurrentMode";
import {
  ExplainModeNextStepAction,
  explainModeActionsForReport
} from "./setup/explainCurrentModeActions";
import { formatExplainModeReport } from "./setup/explainCurrentModeFormatter";
import { realAutoDetectDependencies, realIsabellePathLookup, realSpawn, resolveActivationJavaCommand } from "./setup/runtime";
import {
  LanguageServerStartupDecision,
  autoStartOutcomeIsFailure,
  computeAutoStartFailureKey,
  decideLanguageServerStartup
} from "./setup/lspAutoStart";

const TIER2_SMOKE_ENV = "ISABELLE_VSCODE_TIER2_SMOKE";
const TIER2_SMOKE_COMMAND_ID = "isabelle.internal.runTier2Smoke";
const TIER2_SMOKE_SESSION = "Isabelle_VSCode_Smoke";
const TIER2_SMOKE_PREVIEW_TIMEOUT_MS = 60_000;

interface Tier2SmokeCommandOptions {
  readonly theoryPath?: string;
  readonly sessionName?: string;
  readonly isabelleExecutablePath?: string;
  readonly runSledgehammer?: boolean;
}

interface Tier2SmokePhase {
  readonly name: string;
  readonly ok: boolean;
  readonly detail?: string;
}

interface Tier2SmokeResult {
  readonly theoryUri: string;
  readonly sessionName: string;
  readonly phases: readonly Tier2SmokePhase[];
  readonly prerequisite?: PrerequisiteState;
  readonly discoveredSessionCount: number;
  readonly backendHealth: HealthResult;
  readonly pideBackend: PideVersionResult;
  readonly languageServer: IsabelleLanguageServerStatus;
  readonly pideDocument: CheckWithPideResult;
  readonly pideProofState: ProofStateWithPideResult;
  readonly buildExitCode: number;
  readonly preview?: Tier2SmokePreviewResult;
  readonly sledgehammer?: SledgehammerRunResult;
}

interface Tier2SmokePreviewResult {
  readonly sent: boolean;
  readonly received: boolean;
  readonly label?: string;
  readonly contentLength?: number;
}

let backendManager: BackendManager | undefined;
let buildService: BuildService | undefined;
let commandSpanDecorationsService: CommandSpanDecorationsService | undefined;
let documentStatusService: DocumentStatusService | undefined;
let proofGapAuditService: ProofGapAuditService | undefined;
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
/**
 * Most recent {@link PrerequisiteState} produced by
 * `runPrerequisiteCheck()`. Cached so `Isabelle: Explain Current Mode`
 * can render a snapshot without re-spawning `java -version` /
 * `isabelle version` on every invocation.
 */
let lastPrerequisiteState: PrerequisiteState | undefined;
/**
 * Java command resolved at activation time (either the bundled
 * `extension/jre/...` path on a per-platform `.vsix` or the literal
 * `"java"` on the universal `.vsix`). Cached so the Explain Current Mode
 * accessor can report whether the prereq probe accepted the bundled
 * candidate or fell back to PATH.
 */
let activationJavaCommand: string | undefined;
/**
 * Dedicated output channel for `Isabelle: Explain Current Mode`. Created
 * lazily on first command invocation so cold startup does not pay for it.
 */
let explainCurrentModeOutput: vscode.OutputChannel | undefined;
/**
 * Reference to the extension context retained at activation so
 * top-level command handlers can persist/read `workspaceState` and
 * `globalState`. Phase 2a uses this for the HOL-fallback warning
 * dedupe and the OOM toast dedupe.
 */
let extensionContextRef: vscode.ExtensionContext | undefined;

export function activate(context: vscode.ExtensionContext): IsabellePideExtensionApi {
  extensionContextRef = context;
  const output = vscode.window.createOutputChannel("Isabelle PIDE");
  backendManager = new BackendManager(context, output);
  buildService = new BuildService(output);
  const sessions = new SessionService(output, (params) =>
    backendManager!.getClient().request<DiscoverSessionsResult, DiscoverSessionsParams>("session/discover", params)
  );
  sessionService = sessions;
  documentSyncService = new DocumentSyncService(backendManager, output, () => sessions.getActiveSessionName());
  documentStatusService = new DocumentStatusService(documentSyncService, output);
  proofGapAuditService = new ProofGapAuditService(output);
  languageClient = new IsabelleLanguageClient(
    output,
    () => getIsabelleExecutablePath(),
    realIsabellePathLookup
  );
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
    pideQuiescenceTracker,
    () => resolvePideSession(buildResolvePideSessionDeps())
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
    proofGapAuditService,
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
    vscode.languages.registerFoldingRangeProvider(
      { language: "isabelle", scheme: "file" },
      new IsabelleFoldingRangeProvider()
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
    vscode.commands.registerCommand("isabelle.showPideBackendStatus", async () => showPideBackendStatus(output)),
    vscode.commands.registerCommand("isabelle.showPideDocumentStatus", async () => showPideDocumentStatus(output)),
    vscode.commands.registerCommand("isabelle.invalidatePideCache", async () => invalidatePideCache(output)),
    vscode.commands.registerCommand("isabelle.showPideProofState", async () => showPideProofState(output)),
    vscode.commands.registerCommand("isabelle.minimizeSledgehammerProof", async () => minimizeSledgehammerProof(output)),
    vscode.commands.registerCommand("isabelle.discoverSessions", async () => discoverSessions(output)),
    vscode.commands.registerCommand("isabelle.refreshSessions", async () => discoverSessions(output)),
    vscode.commands.registerCommand("isabelle.selectSession", async (sessionName?: string) => selectSession(sessionName, output)),
    vscode.commands.registerCommand("isabelle.openTheory", async (theoryPath?: string) => openTheory(theoryPath)),
    vscode.commands.registerCommand("isabelle.buildActiveSession", async () => buildActiveSession(output)),
    vscode.commands.registerCommand("isabelle.cancelBuild", () => cancelBuild()),
    vscode.commands.registerCommand("isabelle.resyncOpenTheories", async () => documentSyncService?.resyncOpenTheories()),
    vscode.commands.registerCommand("isabelle.showDocumentStatus", () => documentStatusService?.showActiveDocumentStatus()),
    vscode.commands.registerCommand("isabelle.auditProofGaps", () => proofGapAuditService?.auditOpenDocuments()),
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
    vscode.commands.registerCommand("isabelle.startLanguageServer", async () => startLanguageServer(output, context)),
    vscode.commands.registerCommand("isabelle.retryLanguageServerAutoStart", async () => retryLanguageServerAutoStart(output, context)),
    vscode.commands.registerCommand("isabelle.stopLanguageServer", async () => stopLanguageServer(output)),
    vscode.commands.registerCommand("isabelle.restartLanguageServer", async () => restartLanguageServer(output, context)),
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
    vscode.commands.registerCommand("isabelle.explainCurrentMode", async () => showExplainCurrentMode()),
    ...(process.env[TIER2_SMOKE_ENV] === "1"
      ? [
          vscode.commands.registerCommand(TIER2_SMOKE_COMMAND_ID, (options?: Tier2SmokeCommandOptions) =>
            runTier2Smoke(options, output)
          )
        ]
      : []),
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
  proofGapAuditService.start();
  commandSpanDecorationsService.start();
  pideDecorationOverlayService.start();

  // Explicit-enable path stays fast: if the user has *explicitly* set
  // `isabelle.languageServer.enabled: true` at any scope, start the
  // client immediately in parallel with the prerequisite probe so we
  // don't add startup latency to users who deliberately opted in.
  const initialDecision = decideExtensionLanguageServerStartup(context);
  if (initialDecision === "explicit-start") {
    void (async () => {
      try {
        await languageClient.start();
        if (languageClient.getStatus().state === "running") {
          await clearAutoStartFailureForCurrentRuntime(context);
        }
      } catch (error) {
        output.appendLine(
          `Isabelle language server: initial start failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    })();
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

  // Phase 2c: opt-in eager warmup of the cached HeadlessFacade so
  // power users do not pay the 5-30 s bootstrap on their first
  // user-facing PIDE call. Default `false` so users who never touch
  // PIDE features pay nothing on activation.
  context.subscriptions.push(maybePrewarmPide(output));

  return createIsabellePideExtensionApi(repairAiProviderRegistry, repairAiSecretStore);
}

function createPrerequisiteChecker(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel
): PrerequisiteChecker {
  const walkthroughId = `${context.extension.id}#isabelle.getStarted`;
  const javaCommand = resolveActivationJavaCommand(context.extensionPath);
  activationJavaCommand = javaCommand;
  if (javaCommand !== "java") {
    output.appendLine(`Isabelle setup: using bundled Java runtime at ${javaCommand}`);
  }
  return new PrerequisiteChecker({
    spawn: realSpawn,
    autoDetect: realAutoDetectDependencies(),
    walkthroughId,
    javaCommand,
    isabellePathLookup: realIsabellePathLookup,
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
  options: { readonly force?: boolean; readonly notifyIfMissing?: boolean } = {}
): Promise<PrerequisiteState | undefined> {
  if (!prerequisiteChecker) {
    return undefined;
  }
  const state = await prerequisiteChecker.runCheck();
  // Push the prereq-validated Java command into the backend so its
  // `getClient()` launch path uses the same runtime the activation-time
  // probe accepted. This closes a divergence where a bundled JRE that is
  // filesystem-executable but fails the version check would be rejected
  // by the prereq probe AND still picked up by `BackendManager`'s
  // filesystem-only `resolveJavaCommand`. When the probe could not even
  // determine a working command, `state.javaCommand` is undefined and we
  // clear any prior override so the backend falls back to its own
  // resolver. Guarded so it works for both the activation-time path and
  // the manual "Isabelle: Check Setup Prerequisites" command.
  backendManager?.setJavaCommand(state.javaCommand);
  lastPrerequisiteState = state;
  if (options.notifyIfMissing !== false) {
    await prerequisiteChecker.notifyIfMissing(state, options);
  }
  return state;
}

/**
 * Snapshot of the `isabelle.languageServer.enabled` setting across every
 * scope so we can distinguish "user explicitly set it" from "it's still at
 * the package default of false". Iterating workspace folders catches the
 * multi-root case the rubber-duck flagged.
 *
 * Returns both whether the user set the value anywhere (so we know to
 * defer to it instead of the auto-start branch) and the effective
 * resolved value VS Code computes via its normal scope precedence
 * (folder > workspace > user). The latter is what the LSP toggle in
 * `onDidChangeConfiguration` already reads, so using it here keeps
 * activation and later toggles consistent for the same user.
 */
function inspectLanguageServerEnabledAcrossScopes(): {
  userExplicitlySet: boolean;
  effectiveEnabled: boolean;
} {
  const inspections = [
    vscode.workspace.getConfiguration("isabelle").inspect<boolean>("languageServer.enabled"),
    ...(vscode.workspace.workspaceFolders ?? []).map((folder) =>
      vscode.workspace
        .getConfiguration("isabelle", folder.uri)
        .inspect<boolean>("languageServer.enabled")
    )
  ];
  let userExplicitlySet = false;
  for (const inspection of inspections) {
    if (!inspection) continue;
    for (const value of [
      inspection.globalValue,
      inspection.workspaceValue,
      inspection.workspaceFolderValue
    ]) {
      if (value !== undefined) {
        userExplicitlySet = true;
      }
    }
  }
  const effectiveEnabled = vscode.workspace
    .getConfiguration("isabelle")
    .get<boolean>("languageServer.enabled", false);
  return { userExplicitlySet, effectiveEnabled };
}

function resolveAutoStartFailureKey(): string {
  // Route both inputs through the shared `resolveLanguageServerRuntime`
  // helper so the failure-key identity cannot drift from the runtime
  // that `IsabelleLanguageClient.doStart` actually spawns.
  const runtime = resolveLanguageServerRuntime(
    getIsabelleExecutablePath,
    vscode.workspace.getConfiguration("isabelle")
  );
  return computeAutoStartFailureKey(runtime.executable, runtime.extraArgs);
}

function decideExtensionLanguageServerStartup(
  context: vscode.ExtensionContext,
  prereqState?: PrerequisiteState
): LanguageServerStartupDecision {
  const { userExplicitlySet, effectiveEnabled } = inspectLanguageServerEnabledAcrossScopes();
  const autoStartSetting = vscode.workspace
    .getConfiguration("isabelle")
    .get<boolean>("languageServer.autoStart", true);
  const failureKey = resolveAutoStartFailureKey();
  const autoStartFailedForResolved = Boolean(context.workspaceState.get<boolean>(failureKey));
  return decideLanguageServerStartup({
    userExplicitlySet,
    effectiveEnabled,
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
  let startThrew = false;
  let startThrewMessage: string | undefined;
  try {
    await languageClient.start();
  } catch (error) {
    startThrew = true;
    startThrewMessage = error instanceof Error ? error.message : String(error);
    output.appendLine(`Isabelle language server: auto-start threw: ${startThrewMessage}`);
  }
  // start() normally swallows reach-check / spawn failures and
  // transitions the client to state: "failed" internally, but an
  // unrelated throw (programming error, OOM, transport setup failure
  // before the first state transition) can bubble out with state still
  // at "starting" or "disabled". Treat either signal as a failed
  // auto-start so the failure flag is persisted and the warning toast
  // fires — otherwise the throw would silently retry on every
  // activation.
  const status = languageClient.getStatus();
  const failureKey = resolveAutoStartFailureKey();
  if (autoStartOutcomeIsFailure(startThrew, status.state)) {
    await context.workspaceState.update(failureKey, true);
    const errorDetail = startThrewMessage ?? status.lastError ?? "see output";
    const retryNow = "Retry Now";
    const openSettings = "Open Settings";
    const showOutput = "Show Output";
    const choice = await vscode.window.showWarningMessage(
      `Isabelle PIDE: language server auto-start failed (${errorDetail}). ` +
        "Auto-start is paused for this runtime until you change the configuration or retry successfully.",
      retryNow,
      openSettings,
      showOutput
    );
    if (choice === retryNow) {
      void vscode.commands.executeCommand("isabelle.retryLanguageServerAutoStart");
    } else if (choice === openSettings) {
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

async function clearAutoStartFailureForCurrentRuntime(
  context: vscode.ExtensionContext
): Promise<void> {
  const failureKey = resolveAutoStartFailureKey();
  if (context.workspaceState.get<boolean>(failureKey)) {
    await context.workspaceState.update(failureKey, undefined);
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
  proofGapAuditService?.dispose();
  proofGapAuditService = undefined;
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
  explainCurrentModeOutput?.dispose();
  explainCurrentModeOutput = undefined;
  lastPrerequisiteState = undefined;
  activationJavaCommand = undefined;
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

async function showPideBackendStatus(output: vscode.OutputChannel): Promise<void> {
  try {
    const client = requireBackendManager().getClient();
    const result = await client.request<PideVersionResult, PideVersionParams>(
      "isabelle/pideVersion",
      { isabelleExecutablePath: getIsabelleExecutablePath() }
    );

    const formatted = formatPideBackendStatus(result);
    output.appendLine("--- PIDE backend status ---");
    output.appendLine(`bridge: ${result.bridge}`);
    output.appendLine(`version: ${result.version || "(unavailable)"}`);
    if (result.isabelleHome) {
      output.appendLine(`isabelleHome: ${result.isabelleHome}`);
    }
    output.appendLine(`source: ${result.source}`);
    output.appendLine(`classloaderReady: ${result.classloaderReady}`);
    output.appendLine(`proofOfLife: ${result.proofOfLife}`);
    if (result.reason) {
      output.appendLine(`reason: ${result.reason}`);
    }
    output.appendLine(`message: ${result.message}`);

    const fullMessage = `${formatted.title}\n${formatted.detail}`;
    if (formatted.severity === "info") {
      vscode.window.showInformationMessage(fullMessage);
    } else {
      vscode.window.showWarningMessage(fullMessage);
    }
  } catch (error) {
    showBackendError("Unable to check Isabelle/PIDE backend status", error, output);
  }
}

async function showPideDocumentStatus(output: vscode.OutputChannel): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== "isabelle") {
    vscode.window.showInformationMessage("Open an Isabelle theory file before running `Isabelle: Show PIDE Document Status`.");
    return;
  }

  // 4-step session cascade (Phase 2a item 1). Reuses the existing
  // M2 ROOT/ROOTS discovery — does not re-implement it. The shared
  // resolver wraps the pure cascade with the side-effect surface
  // (persist on auto-select, quickpick, HOL warning).
  const resolved = await resolvePideSession(buildResolvePideSessionDeps());
  if (resolved.kind === "cancelled") {
    return;
  }
  const session = resolved.session;
  const sessionDirectories = pideSessionDirectories(session);

  // Derive a friendly theory name from the document basename.
  const basename = editor.document.fileName.split(/[\\/]/).pop() ?? "Theory.thy";
  const theoryName = basename.endsWith(".thy") ? basename.slice(0, -4) : basename;
  const workspaceUri = vscode.workspace.getWorkspaceFolder(editor.document.uri)?.uri.toString() ?? "default";

  const params: CheckWithPideParams = {
    uri: editor.document.uri.toString(),
    version: editor.document.version,
    session,
    theoryName,
    workspaceUri,
    isabelleExecutablePath: getIsabelleExecutablePath(),
    sessionDirectories,
    text: editor.document.getText()
  };

  try {
    const result = await runCheckWithPideUx(
      requireBackendManager().getClient(),
      params,
      { theoryDisplayName: theoryName, sessionDisplayName: session }
    );

    output.appendLine("--- PIDE document status ---");
    output.appendLine(`uri: ${result.uri}`);
    output.appendLine(`theory: ${result.theoryName}  session: ${result.session ?? "(none)"}`);
    output.appendLine(`status: ${result.status}  bridge: ${result.bridge}`);
    if (typeof result.nodeCount === "number") {
      output.appendLine(`nodes: ${result.nodeCount}  errors: ${result.errorCount ?? 0}`);
    }
    if (typeof result.elapsedMs === "number" || typeof result.bootstrapElapsedMs === "number") {
      output.appendLine(`timings: bootstrap=${result.bootstrapElapsedMs ?? 0}ms check=${result.elapsedMs ?? 0}ms`);
    }
    if (result.errorMessages && result.errorMessages.length > 0) {
      output.appendLine(`errors:\n${formatErrorMessages(result.errorMessages)}`);
    }
    if (result.notes && result.notes.length > 0) {
      output.appendLine(`notes:\n  ${result.notes.join("\n  ")}`);
    }
    output.appendLine(`message: ${result.message}`);

    const oom = decideOomToast({
      errorMessage: result.message,
      reason: result.reason,
      alreadyShown: (key) => extensionContextRef?.globalState.get<boolean>(key, false) ?? false
    });
    if (oom.shouldShow) {
      const action = await vscode.window.showErrorMessage(oom.title + " " + oom.detail, "Open Setting");
      await extensionContextRef?.globalState.update(oom.storageKey, true);
      if (action === "Open Setting") {
        await vscode.commands.executeCommand("workbench.action.openSettings", "isabelle.backend.maxHeapMb");
      }
      return;
    }

    const formatted = formatPideDocumentStatus(result);
    const fullMessage = `${formatted.title}\n${formatted.detail}`;
    if (formatted.severity === "info") {
      vscode.window.showInformationMessage(fullMessage);
    } else if (formatted.severity === "warning") {
      vscode.window.showWarningMessage(fullMessage);
    } else {
      vscode.window.showErrorMessage(fullMessage);
    }
  } catch (error) {
    showBackendError("Unable to run PIDE document check", error, output);
  }
}

async function invalidatePideCache(output: vscode.OutputChannel): Promise<void> {
  try {
    const client = requireBackendManager().getClient();
    const result = await client.request<InvalidatePideCacheResult, Record<string, never>>(
      "pide/invalidateCache",
      {}
    );
    output.appendLine("--- PIDE cache invalidation ---");
    output.appendLine(`invalidated: ${result.invalidated}`);
    if (result.previousFingerprint) {
      output.appendLine(`previousSession: ${result.previousFingerprint.sessionName}`);
      output.appendLine(`previousHome: ${result.previousFingerprint.canonicalHome}`);
    }
    output.appendLine(`message: ${result.message}`);
    vscode.window.showInformationMessage(result.message);
  } catch (error) {
    showBackendError("Unable to invalidate Isabelle/PIDE cache", error, output);
  }
}

/**
 * Phase 3a: ad-hoc proof-state query at the cursor. Routes through
 * `proofState/getWithPide` which uses the cached `Headless.Session`
 * (Phase 2a) + per-(uri, version, session) snapshot cache (Phase 3)
 * for sub-second responses after the first call.
 *
 * Phase 3a returns command identity + status (we identify which
 * command the cursor is on); full proof-goal printing requires the
 * reflective Print_Operation surface which lands in Phase 3b. The
 * formatter surfaces this honestly so users know what they're
 * looking at.
 */
async function showPideProofState(output: vscode.OutputChannel): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== "isabelle") {
    vscode.window.showInformationMessage("Open an Isabelle theory file before running `Isabelle: Show PIDE Proof State at Cursor`.");
    return;
  }

  // 4-step session cascade — same resolver used by every other
  // backend-bound PIDE command. Replaces the previous "ask the user
  // to run Isabelle: Select Active Session" guard so the
  // single-root / HOL-fallback / auto-persist UX is shared.
  const resolved = await resolvePideSession(buildResolvePideSessionDeps());
  if (resolved.kind === "cancelled") {
    return;
  }
  const session = resolved.session;
  const sessionDirectories = pideSessionDirectories(session);

  const basename = editor.document.fileName.split(/[\\/]/).pop() ?? "Theory.thy";
  const theoryName = basename.endsWith(".thy") ? basename.slice(0, -4) : basename;
  const workspaceUri = vscode.workspace.getWorkspaceFolder(editor.document.uri)?.uri.toString() ?? "default";
  const cursor = editor.selection.active;

  const params: ProofStateWithPideParams = {
    uri: editor.document.uri.toString(),
    version: editor.document.version,
    session,
    theoryName,
    workspaceUri,
    position: { line: cursor.line, character: cursor.character },
    isabelleExecutablePath: getIsabelleExecutablePath(),
    sessionDirectories,
    text: editor.document.getText()
  };

  try {
    const client = requireBackendManager().getClient();
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        cancellable: true,
        title: `Isabelle: querying PIDE proof state for ${theoryName} (session ${session})`
      },
      async (progress, token) => {
        progress.report({ message: "warming up Headless session if needed (first call may take 5-30 seconds)" });
        const cancelSubscription = token.onCancellationRequested(() => {
          vscode.window.setStatusBarMessage(
            "Isabelle: PIDE session cancelled; will rebuild on next request (~20 s)...",
            25_000
          );
          void client.request("pide/cancelWarmup", {}).catch(() => undefined);
        });
        try {
          return await client.request<ProofStateWithPideResult, ProofStateWithPideParams>(
            "proofState/getWithPide",
            params
          );
        } finally {
          cancelSubscription.dispose();
        }
      }
    );

    output.appendLine("--- PIDE proof state ---");
    output.appendLine(`status: ${result.status}  bridge: ${result.bridge}  fromCache: ${result.fromCache ?? false}`);
    if (result.command) {
      output.appendLine(`command: kind=${result.command.kind} name=${result.command.name ?? "(none)"} offsets=[${result.command.startOffset ?? "?"}, ${result.command.endOffset ?? "?"})`);
    }
    if (result.goals?.length) {
      output.appendLine(`goals (${result.goals.length}):`);
      result.goals.forEach((g) => output.appendLine(`  [${g.index}] ${g.text}`));
    }
    if (result.raw) {
      output.appendLine(`raw:\n${result.raw}`);
    }
    if (result.notes?.length) {
      output.appendLine(`notes:\n  ${result.notes.join("\n  ")}`);
    }
    if (result.message) {
      output.appendLine(`message: ${result.message}`);
    }

    const formatted = formatPideProofState(result);
    const fullMessage = `${formatted.title}\n${formatted.detail}`;
    if (formatted.severity === "info") {
      vscode.window.showInformationMessage(fullMessage);
    } else if (formatted.severity === "warning") {
      vscode.window.showWarningMessage(fullMessage);
    } else {
      vscode.window.showErrorMessage(fullMessage);
    }
  } catch (error) {
    showBackendError("Unable to query PIDE proof state", error, output);
  }
}

/**
 * Phase 5: Sledgehammer minimization. Take the proof body at the
 * cursor (e.g. `by (metis foo bar baz qux)`), parse it via the pure
 * [`parseProofBody`] helper, and re-run Sledgehammer with
 * `onlyFacts: [foo, bar, baz, qux]` + `minimize=true`. Sledgehammer's
 * built-in minimizer then reduces the fact list, returning a smaller
 * equivalent like `by (metis foo bar)`.
 *
 * Falls back to the existing `runSledgehammer` flow when no proof body
 * is detected at the cursor.
 */
async function minimizeSledgehammerProof(output: vscode.OutputChannel): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== "isabelle") {
    vscode.window.showInformationMessage(
      "Open an Isabelle theory file before running `Isabelle: Minimize Sledgehammer Proof at Cursor`."
    );
    return;
  }
  const lineText = editor.document.lineAt(editor.selection.active.line).text;
  const parsed = parseProofBody(lineText);
  if (!parsed) {
    vscode.window.showWarningMessage(
      "No proof body recognized at the cursor (expected `by (metis fact1 fact2)` or `using ... by metis`). Use `Isabelle: Run Sledgehammer` instead to search from scratch."
    );
    return;
  }

  const allFacts = [...parsed.usingFacts, ...parsed.facts];
  if (allFacts.length === 0) {
    vscode.window.showInformationMessage(
      `Proof body \`by ${parsed.method}\` has no facts to minimize. Use \`Isabelle: Run Sledgehammer\` to search.`
    );
    return;
  }

  // 4-step session cascade — shared with the rest of the PIDE
  // commands so a fresh workspace just works.
  const resolved = await resolvePideSession(buildResolvePideSessionDeps());
  if (resolved.kind === "cancelled") {
    return;
  }
  const session = resolved.session;
  const sessionDirectories = pideSessionDirectories(session);

  const basename = editor.document.fileName.split(/[\\/]/).pop() ?? "Theory.thy";
  const theoryName = basename.endsWith(".thy") ? basename.slice(0, -4) : basename;
  const workspaceUri = vscode.workspace.getWorkspaceFolder(editor.document.uri)?.uri.toString() ?? "default";
  const cursor = editor.selection.active;
  const requestId = `minimize-${Date.now()}`;

  const params = {
    requestId,
    uri: editor.document.uri.toString(),
    version: editor.document.version,
    session,
    theoryName,
    workspaceUri,
    position: { line: cursor.line, character: cursor.character },
    isabelleExecutablePath: getIsabelleExecutablePath(),
    sessionDirectories,
    text: editor.document.getText(),
    sledgehammerOptions: { minimize: "true", preplay_timeout: "10" },
    onlyFacts: allFacts
  };

  try {
    const client = requireBackendManager().getClient();
    output.appendLine(`--- PIDE Sledgehammer minimization ---`);
    output.appendLine(`detected: by ${parsed.method} with ${allFacts.length} fact(s): ${allFacts.join(" ")}`);
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        cancellable: true,
        title: `Isabelle: minimizing proof for ${theoryName} (session ${session})`
      },
      async (progress, token) => {
        progress.report({ message: `running sledgehammer with only: ${allFacts.join(" ")}` });
        const cancelSub = token.onCancellationRequested(() => {
          vscode.window.setStatusBarMessage(
            "Isabelle: minimization cancelled; PIDE session will rebuild on next request (~20 s)...",
            25_000
          );
          void client.request("sledgehammer/cancel", { requestId }).catch(() => undefined);
        });
        try {
          return await client.request<SledgehammerRunResult, typeof params>(
            "sledgehammer/run",
            params
          );
        } finally {
          cancelSub.dispose();
        }
      }
    );

    output.appendLine(`status: ${result.status}  injected: ${result.injectedCommand ?? "?"}`);
    if (result.suggestions.length > 0) {
      output.appendLine(`minimized suggestions (${result.suggestions.length}):`);
      for (const s of result.suggestions) {
        output.appendLine(`  [${s.method}] ${s.proofText}${s.description ? `  (${s.description})` : ""}`);
      }
      const top = result.suggestions[0];
      const reduction = allFacts.length - (top.proofText.match(/\b\w+\b/g) ?? []).length;
      vscode.window.showInformationMessage(
        `Sledgehammer minimized to: ${top.proofText}${top.description ? `  (${top.description})` : ""}${
          reduction > 0 ? `  — ~${reduction} fact(s) eliminated` : ""
        }`
      );
    } else {
      vscode.window.showWarningMessage(
        result.message ??
          "Sledgehammer ran but could not minimize the proof (try a longer preplay_timeout or use the original proof)."
      );
    }
  } catch (error) {
    showBackendError("Unable to minimize proof via PIDE", error, output);
  }
}

/**
 * Phase 2c: honor `isabelle.pide.prewarmOnActivation` by triggering
 * an eager `pide/warmup` for the user's currently-active session
 * shortly after activation. Runs in the background (non-blocking) so
 * activation does not pay the 5-30 s bootstrap cost for users who
 * left the setting at its `false` default. Failures are logged to
 * the output channel only — no user-facing toast — because a failed
 * prewarm is harmless (the next user-facing PIDE call retries from
 * scratch).
 */
function maybePrewarmPide(output: vscode.OutputChannel): vscode.Disposable {
  const config = vscode.workspace.getConfiguration("isabelle");
  if (!config.get<boolean>("pide.prewarmOnActivation", false)) {
    return new vscode.Disposable(() => {});
  }
  const session = (config.get<string>("session.active", "") ?? "").trim();
  if (session.length === 0) {
    output.appendLine(
      "PIDE prewarm skipped: `isabelle.pide.prewarmOnActivation` is enabled but `isabelle.session.active` is empty."
    );
    return new vscode.Disposable(() => {});
  }
  const handle = setTimeout(() => {
    void (async () => {
      try {
        const client = requireBackendManager().getClient();
        const params: WarmupParams = {
          session,
          isabelleExecutablePath: getIsabelleExecutablePath()
        };
        const result = await client.request<WarmupResult, WarmupParams>("pide/warmup", params);
        output.appendLine(
          `PIDE prewarm: status=${result.status} session=${result.session ?? session} ` +
            `elapsedMs=${result.elapsedMs ?? "?"} alreadyCached=${result.alreadyCached ?? "?"}`
        );
        if (result.status !== "ready") {
          output.appendLine(`  reason: ${result.reason ?? "(none)"}`);
          output.appendLine(`  message: ${result.message}`);
        }
      } catch (error) {
        output.appendLine(`PIDE prewarm failed (non-fatal): ${error instanceof Error ? error.message : String(error)}`);
      }
    })();
  }, 1500);
  return new vscode.Disposable(() => clearTimeout(handle));
}

async function runTier2Smoke(
  options: Tier2SmokeCommandOptions | undefined,
  output: vscode.OutputChannel
): Promise<Tier2SmokeResult> {
  const phases: Tier2SmokePhase[] = [];
  const sessionName = options?.sessionName?.trim() || TIER2_SMOKE_SESSION;
  const isabelleExecutablePath = options?.isabelleExecutablePath?.trim() || getIsabelleExecutablePath();
  const document = await openTier2SmokeDocument(options?.theoryPath);
  const editor = await vscode.window.showTextDocument(document);
  const theoryName = theoryNameFromDocument(document);
  const workspaceUri = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.toString() ?? "default";

  logTier2SmokeProgress(output, "start", `theory=${theoryName} session=${sessionName}`);
  logTier2SmokeProgress(output, "prerequisites:start");
  const prerequisite = await runPrerequisiteCheck({ force: true, notifyIfMissing: false });
  addTier2SmokePhase(
    phases,
    "prerequisites",
    Boolean(prerequisite?.java && prerequisite.isabelle),
    prerequisite
      ? `java=${prerequisite.java ? "ok" : "missing"} isabelle=${prerequisite.isabelle ? "ok" : "missing"}`
      : "prerequisite checker did not return a state"
  );
  logTier2SmokeProgress(output, "prerequisites:ok");

  logTier2SmokeProgress(output, "session-discovery:start");
  const discovery = await requireSessionService().refresh();
  const session = discovery.sessions.find((candidate) => candidate.name === sessionName);
  if (!session) {
    const detail = `found ${discovery.sessions.length} session(s); wanted ${sessionName}`;
    phases.push({ name: "session-discovery", ok: false, detail });
    throw new Error(`Tier-2 smoke phase failed: session-discovery (${detail})`);
  }
  addTier2SmokePhase(
    phases,
    "session-discovery",
    true,
    `found ${discovery.sessions.length} session(s); wanted ${sessionName}`
  );
  logTier2SmokeProgress(output, "session-discovery:ok", `found=${discovery.sessions.length}`);
  const sessionDirectories = pideSessionDirectories(sessionName);

  const client = requireBackendManager().getClient();
  logTier2SmokeProgress(output, "backend-health:start");
  const backendHealth = await client.request<HealthResult, HealthParams>("server/health", {
    isabelleExecutablePath
  });
  addTier2SmokePhase(
    phases,
    "backend-health",
    backendHealth.backend.status === "ok" && backendHealth.isabelle.status === "ok",
    formatIsabelleHealth(backendHealth)
  );
  logTier2SmokeProgress(output, "backend-health:ok");

  logTier2SmokeProgress(output, "pide-backend:start");
  const pideBackend = await client.request<PideVersionResult, PideVersionParams>(
    "isabelle/pideVersion",
    { isabelleExecutablePath }
  );
  addTier2SmokePhase(
    phases,
    "pide-backend",
    pideBackend.bridge === "pide-enabled" && pideBackend.classloaderReady,
    pideBackend.message
  );
  logTier2SmokeProgress(output, "pide-backend:ok", pideBackend.bridge);

  if (!languageClient) {
    throw new Error("Tier-2 smoke requires the Isabelle language client to be activated.");
  }
  logTier2SmokeProgress(output, "language-server:start");
  await languageClient.start();
  const languageServer = languageClient.getStatus();
  addTier2SmokePhase(
    phases,
    "language-server",
    languageServer.state === "running",
    languageServer.lastError ?? languageServer.commandLine ?? languageServer.state
  );
  logTier2SmokeProgress(output, "language-server:ok", languageServer.state);

  logTier2SmokeProgress(output, "pide-document:start");
  const pideDocument = await client.request<CheckWithPideResult, CheckWithPideParams>(
    "document/checkWithPide",
    {
      uri: document.uri.toString(),
      version: document.version,
      session: sessionName,
      theoryName,
      workspaceUri,
      isabelleExecutablePath,
      sessionDirectories,
      text: document.getText()
    }
  );
  addTier2SmokePhase(
    phases,
    "pide-document",
    pideDocument.bridge === "pide-enabled" &&
      (pideDocument.status === "pide-ok" || pideDocument.status === "pide-errors"),
    `${pideDocument.status}: ${pideDocument.message}`
  );
  logTier2SmokeProgress(output, "pide-document:ok", pideDocument.status);

  editor.selection = new vscode.Selection(
    findTier2SmokePosition(document, "by simp"),
    findTier2SmokePosition(document, "by simp")
  );
  const cursor = editor.selection.active;
  logTier2SmokeProgress(output, "pide-proof-state:start");
  const pideProofState = await client.request<ProofStateWithPideResult, ProofStateWithPideParams>(
    "proofState/getWithPide",
    {
      uri: document.uri.toString(),
      version: document.version,
      position: { line: cursor.line, character: cursor.character },
      session: sessionName,
      theoryName,
      workspaceUri,
      isabelleExecutablePath,
      sessionDirectories,
      text: document.getText()
    }
  );
  addTier2SmokePhase(
    phases,
    "pide-proof-state",
    pideProofState.bridge === "pide-enabled" && pideProofState.status === "ready",
    pideProofState.message ?? pideProofState.raw
  );
  logTier2SmokeProgress(output, "pide-proof-state:ok", pideProofState.status);

  const config = vscode.workspace.getConfiguration("isabelle");
  logTier2SmokeProgress(output, "isabelle-build:start");
  const buildExitCode = await requireBuildService().runBuild(session, {
    isabelleExecutablePath,
    extraArgs: config.get<string[]>("build.extraArgs", [])
  });
  addTier2SmokePhase(
    phases,
    "isabelle-build",
    buildExitCode === 0,
    `exitCode=${buildExitCode}`
  );
  logTier2SmokeProgress(output, "isabelle-build:ok", `exitCode=${buildExitCode}`);

  logTier2SmokeProgress(output, "pide-preview:start");
  const preview = await runTier2SmokePreview(document.uri.toString());
  addTier2SmokePhase(
    phases,
    "pide-preview",
    preview.sent && preview.received,
    preview.received
      ? `received ${preview.contentLength ?? 0} byte(s)`
      : `sent=${preview.sent} received=${preview.received}`
  );
  logTier2SmokeProgress(output, "pide-preview:ok", `received=${preview.received}`);

  if (options?.runSledgehammer) {
    logTier2SmokeProgress(output, "sledgehammer:start");
  }
  const sledgehammer = options?.runSledgehammer
    ? await runTier2SmokeSledgehammer(
        client,
        document,
        sessionName,
        theoryName,
        workspaceUri,
        isabelleExecutablePath,
        sessionDirectories
      )
    : undefined;
  if (sledgehammer) {
    addTier2SmokePhase(
      phases,
      "sledgehammer",
      sledgehammer.status === "completed" && sledgehammer.suggestions.length > 0,
      sledgehammer.message ?? sledgehammer.raw
    );
    logTier2SmokeProgress(output, "sledgehammer:ok", `suggestions=${sledgehammer.suggestions.length}`);
  }

  logTier2SmokeProgress(
    output,
    "complete",
    `${theoryName}: ${phases.map((phase) => `${phase.name}=ok`).join(", ")}`
  );

  return {
    theoryUri: document.uri.toString(),
    sessionName,
    phases,
    prerequisite,
    discoveredSessionCount: discovery.sessions.length,
    backendHealth,
    pideBackend,
    languageServer,
    pideDocument,
    pideProofState,
    buildExitCode,
    preview,
    sledgehammer
  };
}

async function openTier2SmokeDocument(theoryPath: string | undefined): Promise<vscode.TextDocument> {
  const resolvedPath = theoryPath?.trim();
  if (resolvedPath) {
    return vscode.workspace.openTextDocument(vscode.Uri.file(resolvedPath));
  }

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    throw new Error("Tier-2 smoke requires a workspace folder containing examples/Smoke.thy.");
  }
  return vscode.workspace.openTextDocument(
    vscode.Uri.joinPath(workspaceFolder.uri, "examples", "Smoke.thy")
  );
}

function theoryNameFromDocument(document: vscode.TextDocument): string {
  const basename = document.fileName.split(/[\\/]/).pop() ?? "Theory.thy";
  return basename.endsWith(".thy") ? basename.slice(0, -4) : basename;
}

function findTier2SmokePosition(document: vscode.TextDocument, needle: string): vscode.Position {
  for (let line = 0; line < document.lineCount; line += 1) {
    const text = document.lineAt(line).text;
    const character = text.indexOf(needle);
    if (character >= 0) {
      return new vscode.Position(line, character);
    }
  }
  throw new Error(`Tier-2 smoke fixture did not contain expected text: ${needle}`);
}

function addTier2SmokePhase(
  phases: Tier2SmokePhase[],
  name: string,
  ok: boolean,
  detail?: string
): void {
  phases.push({ name, ok, detail });
  if (!ok) {
    throw new Error(`Tier-2 smoke phase failed: ${name}${detail ? ` (${detail})` : ""}`);
  }
}

function logTier2SmokeProgress(
  output: vscode.OutputChannel,
  phase: string,
  detail?: string
): void {
  const message = `[tier2-smoke] ${new Date().toISOString()} ${phase}${detail ? ` ${detail}` : ""}`;
  output.appendLine(message);
  console.log(message);
}

async function runTier2SmokePreview(uri: string): Promise<Tier2SmokePreviewResult> {
  const subscriber = pidePreviewSubscriber;
  if (!subscriber) {
    return { sent: false, received: false };
  }

  const existing = subscriber.getLatest();
  if (existing && existing.uri === uri && !isEmptyPreviewSnapshot(existing)) {
    return previewSmokeResult(true, existing);
  }

  let timer: NodeJS.Timeout | undefined;
  let subscription: { dispose(): void } | undefined;
  const cleanup = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    subscription?.dispose();
    subscription = undefined;
  };

  const received = new Promise<Tier2SmokePreviewResult>((resolve) => {
    const complete = (result: Tier2SmokePreviewResult): void => {
      cleanup();
      resolve(result);
    };

    subscription = subscriber.onSnapshot((snapshot) => {
      if (snapshot.uri !== uri || isEmptyPreviewSnapshot(snapshot)) {
        return;
      }
      complete(previewSmokeResult(true, snapshot));
    });
    timer = setTimeout(() => {
      complete({ sent: true, received: false });
    }, TIER2_SMOKE_PREVIEW_TIMEOUT_MS);
    timer.unref();
  });

  const sent = subscriber.requestPreview(uri, vscode.ViewColumn.Beside);
  if (!sent) {
    cleanup();
    return { sent: false, received: false };
  }
  return received;
}

function previewSmokeResult(
  sent: boolean,
  snapshot: PidePreviewSnapshot
): Tier2SmokePreviewResult {
  return {
    sent,
    received: true,
    label: snapshot.label,
    contentLength: snapshot.content.length
  };
}

async function runTier2SmokeSledgehammer(
  client: ReturnType<BackendManager["getClient"]>,
  document: vscode.TextDocument,
  sessionName: string,
  theoryName: string,
  workspaceUri: string,
  isabelleExecutablePath: string,
  sessionDirectories: readonly string[]
): Promise<SledgehammerRunResult> {
  const position = findTier2SmokePosition(document, "sorry");
  const params: SledgehammerRunParams = {
    requestId: `tier2-smoke-${Date.now()}`,
    uri: document.uri.toString(),
    version: document.version,
    position: { line: position.line, character: position.character },
    session: sessionName,
    isabelleExecutablePath,
    sessionDirectories: sessionDirectories.slice(),
    text: document.getText(),
    theoryName,
    workspaceUri
  };
  return client.request<SledgehammerRunResult, SledgehammerRunParams>("sledgehammer/run", params);
}

function pideSessionDirectories(sessionName: string): string[] {
  const session = sessionService?.getSessions().find((candidate) => candidate.name === sessionName);
  if (!session) {
    return [];
  }
  return Array.from(
    new Set(
      [session.sessionDirectory, session.rootDirectory].filter((entry) => entry.trim().length > 0)
    )
  );
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

/**
 * Build the dependency bundle the shared {@link resolvePideSession}
 * helper expects, wired to the live VS Code surface (settings,
 * workspaceState, quickpick / warning toasts, command dispatcher).
 *
 * Used by every backend-bound command that consumes a session: PIDE
 * document status, PIDE proof state, Sledgehammer minimization, and
 * (via {@link buildResolvePideSessionDepsForPanel}) the Sledgehammer
 * panel's `executeBackendRun` path.
 */
function buildResolvePideSessionDeps(): ResolvePideSessionDeps {
  const sessionsConfig = vscode.workspace.getConfiguration("isabelle");
  const activeSessionSetting = (sessionsConfig.get<string>("session.active", "") ?? "").trim();
  const discovered = sessionService ? sessionService.getSessions().map((s) => s.name) : [];
  return {
    activeSessionSetting,
    discoveredSessions: discovered,
    getHolWarningSeen: () =>
      extensionContextRef?.workspaceState.get<boolean>(SESSION_CASCADE_HOL_WARNING_KEY, false) ?? false,
    setHolWarningSeen: async (value) => {
      await extensionContextRef?.workspaceState.update(SESSION_CASCADE_HOL_WARNING_KEY, value);
    },
    persistActiveSession: async (session) => {
      await sessionsConfig.update("session.active", session, vscode.ConfigurationTarget.Workspace);
    },
    showQuickPick: (items, options) => vscode.window.showQuickPick(items.slice(), options),
    showWarningMessage: (message, ...actions) =>
      vscode.window.showWarningMessage(message, ...actions),
    executeCommand: async (command) => {
      await vscode.commands.executeCommand(command);
    }
  };
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

type LanguageServerStartResult =
  | { readonly kind: "not-initialized" }
  | { readonly kind: "completed"; readonly status: IsabelleLanguageServerStatus }
  | { readonly kind: "threw"; readonly error: unknown };

async function tryStartLanguageServer(
  context: vscode.ExtensionContext,
  options: { readonly persistEnabledSetting: boolean }
): Promise<LanguageServerStartResult> {
  if (!languageClient) {
    return { kind: "not-initialized" };
  }
  try {
    if (options.persistEnabledSetting) {
      await vscode.workspace
        .getConfiguration("isabelle")
        .update("languageServer.enabled", true, vscode.ConfigurationTarget.Workspace);
    }
    await languageClient.start();
    const status = languageClient.getStatus();
    if (status.state === "running") {
      await clearAutoStartFailureForCurrentRuntime(context);
    }
    return { kind: "completed", status };
  } catch (error) {
    return { kind: "threw", error };
  }
}

async function startLanguageServer(
  output: vscode.OutputChannel,
  context: vscode.ExtensionContext
): Promise<void> {
  const result = await tryStartLanguageServer(context, { persistEnabledSetting: true });
  if (result.kind === "threw") {
    showBackendError("Unable to start Isabelle language server", result.error, output);
  }
}

async function retryLanguageServerAutoStart(
  output: vscode.OutputChannel,
  context: vscode.ExtensionContext
): Promise<void> {
  if (!languageClient) {
    return;
  }
  const failureKey = resolveAutoStartFailureKey();
  await clearAutoStartFailureForCurrentRuntime(context);
  output.appendLine(
    `Isabelle language server: cleared remembered auto-start failure ${failureKey}; retrying.`
  );
  const result = await tryStartLanguageServer(context, { persistEnabledSetting: false });
  if (result.kind === "threw") {
    showBackendError("Unable to retry Isabelle language server auto-start", result.error, output);
    return;
  }
  if (result.kind === "completed" && result.status.state === "running") {
    void vscode.window.showInformationMessage(
      "Isabelle language server is running; auto-start will be tried again on future activations."
    );
    return;
  }
  await context.workspaceState.update(failureKey, true);
  void vscode.window.showWarningMessage(
    "Isabelle language server did not reach running state; auto-start remains paused for this runtime.",
    "Show Status"
  ).then((choice) => {
    if (choice === "Show Status") {
      showLanguageServerStatus();
    }
  });
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

async function restartLanguageServer(
  output: vscode.OutputChannel,
  context: vscode.ExtensionContext
): Promise<void> {
  if (!languageClient) {
    return;
  }
  try {
    await vscode.workspace
      .getConfiguration("isabelle")
      .update("languageServer.enabled", true, vscode.ConfigurationTarget.Workspace);
    await languageClient.restart();
    if (languageClient.getStatus().state === "running") {
      await clearAutoStartFailureForCurrentRuntime(context);
    }
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

async function showExplainCurrentMode(): Promise<void> {
  const accessors = createExplainModeAccessors();
  const report = buildExplainModeReport(accessors);
  const text = formatExplainModeReport(report);
  if (!explainCurrentModeOutput) {
    explainCurrentModeOutput = vscode.window.createOutputChannel("Isabelle PIDE — Current Mode");
  }
  explainCurrentModeOutput.clear();
  explainCurrentModeOutput.appendLine(text);
  explainCurrentModeOutput.show(true);
  await promptExplainModeAction(report);
}

interface ExplainModeActionQuickPickItem extends vscode.QuickPickItem {
  readonly action: ExplainModeNextStepAction;
}

async function promptExplainModeAction(report: ExplainModeReport): Promise<void> {
  const setupWalkthroughId = extensionContextRef
    ? `${extensionContextRef.extension.id}#isabelle.getStarted`
    : undefined;
  const actions = explainModeActionsForReport(report, { setupWalkthroughId });
  if (actions.length === 0) {
    return;
  }
  const picked = await vscode.window.showQuickPick<ExplainModeActionQuickPickItem>(
    actions.map((action) => ({
      label: `$(play) ${action.label}`,
      description: action.command.startsWith("isabelle.") ? "Isabelle command" : "VS Code command",
      detail: action.detail,
      action
    })),
    {
      placeHolder: "Run a recommended Isabelle current-mode action",
      matchOnDescription: true,
      matchOnDetail: true
    }
  );
  if (!picked) {
    return;
  }
  await vscode.commands.executeCommand(picked.action.command, ...picked.action.args);
}

function createExplainModeAccessors(): ExplainModeAccessors {
  return {
    getLanguageServerStatus: () => languageClient?.getStatus(),
    getPrerequisiteState: () => lastPrerequisiteState,
    getBackendRunning: () => backendManager?.isClientStarted() ?? false,
    getActiveSessionName: () => sessionService?.getActiveSessionName(),
    getLanguageServerEnabledSetting: (): LanguageServerEnabledSetting => {
      const { userExplicitlySet, effectiveEnabled } = inspectLanguageServerEnabledAcrossScopes();
      if (!userExplicitlySet) return "default";
      return effectiveEnabled ? "true" : "false";
    },
    getLanguageServerAutoStart: () =>
      vscode.workspace.getConfiguration("isabelle").get<boolean>("languageServer.autoStart", true),
    getLanguageServerExtraArgs: () =>
      resolveLanguageServerRuntime(
        getIsabelleExecutablePath,
        vscode.workspace.getConfiguration("isabelle")
      ).extraArgs,
    getAutoStartFailure: () => {
      if (!extensionContextRef) {
        return { remembered: false, key: undefined };
      }
      const key = resolveAutoStartFailureKey();
      return {
        remembered: Boolean(extensionContextRef.workspaceState.get<boolean>(key)),
        key
      };
    },
    getIsabelleExecutablePathSetting: () => getIsabelleExecutablePath(),
    getBackendCommandSetting: () => {
      const configured = vscode.workspace
        .getConfiguration("isabelle")
        .get<string>("backend.command", "")
        .trim();
      return configured.length > 0 ? configured : undefined;
    },
    getJavaIsBundled: () => {
      const command = lastPrerequisiteState?.javaCommand;
      if (!command) return undefined;
      // The bundled JRE path is whatever `resolveActivationJavaCommand`
      // produced at activation. If the accepted command differs from
      // that bundled candidate (because the probe fell back to PATH
      // "java" or the universal VSIX never injected a candidate), it
      // is system-provided.
      if (activationJavaCommand && activationJavaCommand !== "java") {
        return command === activationJavaCommand;
      }
      return false;
    }
  };
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
