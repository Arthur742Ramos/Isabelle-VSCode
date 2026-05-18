import { resolveIsabelleCommand } from "../lsp/languageServerArgs";
import {
  AutoDetectDependencies,
  DetectedIsabelle,
  detectIsabelleInstallPath
} from "./isabelleAutoDetect";

/**
 * Prerequisite detection + onboarding-toast orchestration for Isabelle PIDE.
 *
 * `runCheck()` spawns `java -version` and `isabelle version` in parallel with
 * short timeouts, sets the corresponding setup context keys for walkthrough
 * completion events, and resolves to a {@link PrerequisiteState} snapshot.
 *
 * `notifyIfMissing()` follows a strict priority so the user never sees more
 * than one setup toast per activation:
 *
 *   1. Java missing → show "install Java" toast.
 *   2. Else Isabelle missing AND a local install was auto-detected →
 *      show "use detected Isabelle?" toast.
 *   3. Else Isabelle missing → show generic "install Isabelle" toast.
 *   4. Else: silent (everything is fine).
 *
 * All side effects are injected: no direct `vscode`, `child_process`, or
 * `fs` imports — tests pass fakes for each.
 */

export interface SpawnResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly spawnFailed: boolean;
  readonly timedOut: boolean;
}

export interface SpawnRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly timeoutMs: number;
}

export type SpawnFn = (request: SpawnRequest) => Promise<SpawnResult>;

export type PromptResult = "open-walkthrough" | "use-detected" | "dont-show-again" | undefined;

export interface PrereqUi {
  showInformation(message: string, ...actions: readonly string[]): Promise<string | undefined>;
  showWarning(message: string, ...actions: readonly string[]): Promise<string | undefined>;
  executeCommand(command: string, ...args: readonly unknown[]): Promise<unknown>;
  setContext(key: string, value: boolean): Promise<unknown>;
  hasWorkspaceFolders(): boolean;
  /** Read a configured value under the `isabelle` section. */
  getConfig<T>(section: string, defaultValue: T): T;
  /**
   * Update a configured value under the `isabelle` section. The `target`
   * argument should be 1 (Global), 2 (Workspace) or 3 (WorkspaceFolder) per
   * VS Code's `ConfigurationTarget` enum.
   */
  updateConfig(section: string, value: unknown, target: 1 | 2 | 3): Promise<unknown>;
}

export interface PrereqLogger {
  log(message: string): void;
}

export interface PrerequisiteCheckerDependencies {
  readonly spawn: SpawnFn;
  readonly autoDetect: AutoDetectDependencies;
  readonly ui: PrereqUi;
  readonly logger: PrereqLogger;
  /** Walkthrough id including publisher + extension name. */
  readonly walkthroughId: string;
  /** Spawn timeout for `java -version` / `isabelle version`. Default 5 s. */
  readonly checkTimeoutMs?: number;
}

export interface PrerequisiteState {
  readonly java: boolean;
  readonly javaVersion?: string;
  readonly isabelle: boolean;
  readonly isabellePath?: string;
  readonly isabelleVersion?: string;
  readonly detectedIsabelle?: DetectedIsabelle;
}

/**
 * Context key names. Mirrored by `package.json` walkthrough completion
 * events (`onContext:isabelle.setup.javaDetected`, etc).
 */
export const PREREQ_CONTEXT_JAVA = "isabelle.setup.javaDetected";
export const PREREQ_CONTEXT_ISABELLE = "isabelle.setup.isabelleDetected";
export const PREREQ_CONTEXT_ALL = "isabelle.setup.allPrereqsMet";

const SUPPRESS_SETTING = "setup.suppressNotifications";
const EXECUTABLE_PATH_SETTING = "executablePath";

export class PrerequisiteChecker {
  private disposed = false;

  public constructor(private readonly deps: PrerequisiteCheckerDependencies) {}

  /**
   * Probe Java and Isabelle, publish context keys, and return a snapshot.
   * Never throws — failures land in the snapshot or the logger.
   */
  public async runCheck(): Promise<PrerequisiteState> {
    if (this.disposed) {
      return emptyState();
    }
    const timeoutMs = this.deps.checkTimeoutMs ?? 5000;
    const isabelleExecutable = this.deps.ui.getConfig<string>(EXECUTABLE_PATH_SETTING, "isabelle");

    const [javaResult, isabelleResult] = await Promise.all([
      this.safeSpawn({ command: "java", args: ["-version"], timeoutMs }),
      this.safeSpawn(
        spawnIsabelleVersion(isabelleExecutable, this.deps.autoDetect.platform, timeoutMs)
      )
    ]);

    const javaOk = !javaResult.spawnFailed && javaResult.exitCode === 0;
    const isabelleOk = !isabelleResult.spawnFailed && isabelleResult.exitCode === 0;

    const detectedIsabelle = isabelleOk ? undefined : detectIsabelleInstallPath(this.deps.autoDetect);

    const state: PrerequisiteState = {
      java: javaOk,
      javaVersion: javaOk ? extractFirstLine(javaResult.stderr || javaResult.stdout) : undefined,
      isabelle: isabelleOk,
      isabellePath: isabelleOk ? isabelleExecutable : undefined,
      isabelleVersion: isabelleOk ? extractFirstLine(isabelleResult.stdout) : undefined,
      detectedIsabelle
    };

    this.deps.logger.log(
      `Prerequisite check: java=${javaOk ? "ok" : "missing"} isabelle=${
        isabelleOk ? "ok" : "missing"
      }${detectedIsabelle ? ` autodetect=${detectedIsabelle.path}` : ""}`
    );

    await Promise.all([
      this.deps.ui.setContext(PREREQ_CONTEXT_JAVA, javaOk),
      this.deps.ui.setContext(PREREQ_CONTEXT_ISABELLE, isabelleOk),
      this.deps.ui.setContext(PREREQ_CONTEXT_ALL, javaOk && isabelleOk)
    ]);

    return state;
  }

  /**
   * Show at most one onboarding toast for the given state. Returns the user
   * action (or undefined if no toast was shown / user dismissed it).
   *
   * `force` overrides the suppression setting so the manual recheck command
   * can always surface a result.
   */
  public async notifyIfMissing(
    state: PrerequisiteState,
    options: { readonly force?: boolean } = {}
  ): Promise<PromptResult> {
    if (this.disposed) {
      return undefined;
    }
    if (state.java && state.isabelle) {
      if (options.force) {
        await this.deps.ui.showInformation("Isabelle PIDE: Java and Isabelle are both reachable.");
      }
      return undefined;
    }
    if (!options.force && this.deps.ui.getConfig<boolean>(SUPPRESS_SETTING, false)) {
      return undefined;
    }

    if (!state.java) {
      return this.promptInstallJava();
    }
    if (state.detectedIsabelle) {
      return this.promptUseDetectedIsabelle(state.detectedIsabelle);
    }
    return this.promptInstallIsabelle();
  }

  public dispose(): void {
    this.disposed = true;
  }

  private async promptInstallJava(): Promise<PromptResult> {
    const openWalkthrough = "Open Setup Walkthrough";
    const dontShow = "Don't show again";
    const choice = await this.deps.ui.showWarning(
      "Isabelle PIDE: Java 21+ is required to run the Scala backend.",
      openWalkthrough,
      dontShow
    );
    return this.handleSetupChoice(choice, openWalkthrough, dontShow);
  }

  private async promptInstallIsabelle(): Promise<PromptResult> {
    const openWalkthrough = "Open Setup Walkthrough";
    const dontShow = "Don't show again";
    const choice = await this.deps.ui.showWarning(
      "Isabelle PIDE: `isabelle` is not on PATH. Most features stay inert until you install Isabelle 2019 or newer.",
      openWalkthrough,
      dontShow
    );
    return this.handleSetupChoice(choice, openWalkthrough, dontShow);
  }

  private async promptUseDetectedIsabelle(detected: DetectedIsabelle): Promise<PromptResult> {
    const useIt = "Use it";
    const openWalkthrough = "Open Setup Walkthrough";
    const dontShow = "Don't show again";
    const label = detected.versionLabel ?? "this installation";
    const choice = await this.deps.ui.showInformation(
      `Isabelle PIDE: detected ${label} at ${detected.installRoot}. Use it?`,
      useIt,
      openWalkthrough,
      dontShow
    );
    if (choice === useIt) {
      await this.applyDetectedIsabelle(detected);
      return "use-detected";
    }
    return this.handleSetupChoice(choice, openWalkthrough, dontShow);
  }

  private async handleSetupChoice(
    choice: string | undefined,
    openWalkthroughLabel: string,
    dontShowLabel: string
  ): Promise<PromptResult> {
    if (choice === openWalkthroughLabel) {
      await this.deps.ui.executeCommand(
        "workbench.action.openWalkthrough",
        this.deps.walkthroughId,
        false
      );
      return "open-walkthrough";
    }
    if (choice === dontShowLabel) {
      await this.deps.ui.updateConfig(SUPPRESS_SETTING, true, this.preferredConfigTarget());
      return "dont-show-again";
    }
    return undefined;
  }

  private async applyDetectedIsabelle(detected: DetectedIsabelle): Promise<void> {
    await this.deps.ui.updateConfig(
      EXECUTABLE_PATH_SETTING,
      detected.path,
      this.preferredConfigTarget()
    );
    this.deps.logger.log(`Isabelle executablePath updated to ${detected.path}`);
  }

  /**
   * Workspace if a folder is open (so per-project Isabelle versions stay
   * isolated), Global otherwise (single-file `.thy` case where Workspace
   * scope has no place to land).
   */
  private preferredConfigTarget(): 1 | 2 {
    return this.deps.ui.hasWorkspaceFolders() ? 2 : 1;
  }

  private async safeSpawn(request: SpawnRequest): Promise<SpawnResult> {
    try {
      return await this.deps.spawn(request);
    } catch (error) {
      this.deps.logger.log(
        `Spawn failed for ${request.command}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return { exitCode: null, stdout: "", stderr: "", spawnFailed: true, timedOut: false };
    }
  }
}

function spawnIsabelleVersion(
  executablePath: string,
  platform: NodeJS.Platform,
  timeoutMs: number
): SpawnRequest {
  const resolved = resolveIsabelleCommand(executablePath, ["version"], { platform });
  return { command: resolved.command, args: resolved.args, timeoutMs };
}

function extractFirstLine(value: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.split(/\r?\n/, 1)[0]?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function emptyState(): PrerequisiteState {
  return { java: false, isabelle: false };
}
