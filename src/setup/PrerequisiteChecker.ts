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
  /**
   * Java command to probe. Defaults to `"java"`. Per-platform `.vsix`
   * builds bundle an Eclipse Temurin 21 JRE and inject the absolute path
   * to `extension/jre/bin/java[.exe]` (or
   * `extension/jre/Contents/Home/bin/java` on macOS) here. If the probe
   * against this candidate fails (spawn error, non-zero exit, or a major
   * version below {@link MIN_JAVA_MAJOR_VERSION}) AND the candidate
   * differs from `"java"`, {@link PrerequisiteChecker.runCheck} retries
   * with the literal `"java"` so universal-VSIX users still surface the
   * existing "Install Java" toast when a bundled candidate is broken or
   * stale.
   */
  readonly javaCommand?: string;
  /**
   * Optional PATH lookup for the Isabelle launcher. When provided AND the
   * configured `isabelle.executablePath` is a bare name like `"isabelle"`
   * on Windows, the prerequisite probe consults this to find an absolute
   * `.ps1`/`.cmd`/`.exe` launcher on PATH and routes the spawn through
   * the PowerShell wrapper when appropriate. See
   * `resolveIsabelleCommand` for the underlying rationale (Node's
   * `child_process.spawn` does not honor `.PS1` in `PATHEXT`). Production
   * activation wires {@link realIsabellePathLookup}; tests pass a fake
   * or omit it.
   */
  readonly isabellePathLookup?: (name: string) => string | undefined;
}

export interface PrerequisiteState {
  /**
   * `true` only if the `java -version` spawn succeeded AND the detected
   * major version is at least {@link MIN_JAVA_MAJOR_VERSION}. Older
   * runtimes (Java 8/11/17, …) are reported as `java: false` with a
   * non-undefined {@link javaVersionMajor} so the toast can differentiate
   * "Java not installed" from "Java too old".
   */
  readonly java: boolean;
  /**
   * The java command that actually answered `-version`. Will equal
   * {@link PrerequisiteCheckerDependencies.javaCommand} when the bundled
   * candidate worked, or `"java"` when the checker fell back to PATH.
   * `undefined` when no probe succeeded.
   */
  readonly javaCommand?: string;
  /** Raw first line of `java -version` output when the spawn succeeded. */
  readonly javaVersion?: string;
  /** Parsed major version (e.g. `21`) when extractable. */
  readonly javaVersionMajor?: number;
  /** `true` when Java is present but its major version is below the minimum. */
  readonly javaTooOld?: boolean;
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

/**
 * Minimum Java major version the bundled Isabelle/Scala backend requires.
 * Documented in the README install matrix; reflected in the walkthrough
 * card. Older runtimes (8/11/17) start, exit 0 from `-version`, and would
 * otherwise let activation believe Java is "ok" even though the backend
 * will fail with a class-version error at first launch.
 */
export const MIN_JAVA_MAJOR_VERSION = 21;

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
    const primaryJavaCommand = this.deps.javaCommand ?? "java";

    const [primaryJavaResult, isabelleResult] = await Promise.all([
      this.safeSpawn({ command: primaryJavaCommand, args: ["-version"], timeoutMs }),
      this.safeSpawn(
        spawnIsabelleVersion(
          isabelleExecutable,
          this.deps.autoDetect.platform,
          timeoutMs,
          this.deps.isabellePathLookup
        )
      )
    ]);

    // If a bundled JRE was injected but its probe is not a usable Java 21+
    // (spawn error, non-zero exit, OR a major version below the minimum) we
    // retry with PATH `"java"` so the existing onboarding toast still
    // appears for users who installed a corrupt or stale platform VSIX but
    // DO have a working system Java. Universal-VSIX users skip this retry:
    // their injected javaCommand was already `"java"`.
    const primaryEval = evaluateJavaProbe(primaryJavaResult);
    const shouldRetryWithPath = !primaryEval.ok && primaryJavaCommand !== "java";

    let javaCommand = primaryJavaCommand;
    let javaResult = primaryJavaResult;
    if (shouldRetryWithPath) {
      this.deps.logger.log(
        primaryEval.spawnOk
          ? `Bundled Java probe at ${primaryJavaCommand} reported major ${
              primaryEval.major ?? "?"
            } (need ${MIN_JAVA_MAJOR_VERSION}+); falling back to PATH java.`
          : `Bundled Java probe at ${primaryJavaCommand} failed (spawnFailed=${primaryJavaResult.spawnFailed} exit=${primaryJavaResult.exitCode}); falling back to PATH java.`
      );
      const pathProbe = await this.safeSpawn({ command: "java", args: ["-version"], timeoutMs });
      const pathEval = evaluateJavaProbe(pathProbe);
      if (pathEval.ok) {
        // PATH gave us a working Java >= MIN; prefer it over a too-old or
        // failed primary.
        javaCommand = "java";
        javaResult = pathProbe;
      } else if (!primaryEval.spawnOk && pathEval.spawnOk) {
        // Primary spawn-failed but PATH at least responded; even if PATH is
        // too-old or unparseable, its diagnostic is more actionable than a
        // raw spawn failure.
        javaCommand = "java";
        javaResult = pathProbe;
      }
      // Otherwise: primary is spawn-OK but too-old / unparseable, and PATH
      // did not improve on it. Keep the primary diagnostic so the toast
      // reports the bundled version rather than silently downgrading to a
      // generic "missing" outcome.
    }

    const javaPresent = !javaResult.spawnFailed && javaResult.exitCode === 0;
    const javaVersionLine = javaPresent
      ? extractFirstLine(javaResult.stderr || javaResult.stdout)
      : undefined;
    const javaVersionMajor = javaPresent ? parseJavaMajorVersion(javaResult.stderr || javaResult.stdout) : undefined;
    const javaTooOld =
      javaPresent && javaVersionMajor !== undefined && javaVersionMajor < MIN_JAVA_MAJOR_VERSION;
    const javaOk =
      javaPresent &&
      javaVersionMajor !== undefined &&
      javaVersionMajor >= MIN_JAVA_MAJOR_VERSION;

    const isabelleOk = !isabelleResult.spawnFailed && isabelleResult.exitCode === 0;

    const detectedIsabelle = isabelleOk ? undefined : detectIsabelleInstallPath(this.deps.autoDetect);

    const state: PrerequisiteState = {
      java: javaOk,
      javaCommand: javaPresent ? javaCommand : undefined,
      javaVersion: javaVersionLine,
      javaVersionMajor,
      javaTooOld: javaTooOld || undefined,
      isabelle: isabelleOk,
      isabellePath: isabelleOk ? isabelleExecutable : undefined,
      isabelleVersion: isabelleOk ? extractFirstLine(isabelleResult.stdout) : undefined,
      detectedIsabelle
    };

    this.deps.logger.log(
      `Prerequisite check: java=${
        javaOk
          ? `ok (${javaVersionMajor}) via ${javaCommand}`
          : javaTooOld
            ? `too-old (${javaVersionMajor ?? "?"}) via ${javaCommand}`
            : "missing"
      } isabelle=${isabelleOk ? "ok" : "missing"}${
        detectedIsabelle ? ` autodetect=${detectedIsabelle.path}` : ""
      }`
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
      return this.promptInstallJava(state);
    }
    if (state.detectedIsabelle) {
      return this.promptUseDetectedIsabelle(state.detectedIsabelle);
    }
    return this.promptInstallIsabelle();
  }

  public dispose(): void {
    this.disposed = true;
  }

  private async promptInstallJava(state: PrerequisiteState): Promise<PromptResult> {
    const openWalkthrough = "Open Setup Walkthrough";
    const dontShow = "Don't show again";
    const message = state.javaTooOld
      ? `Isabelle PIDE: Java ${state.javaVersionMajor} is too old. The bundled Scala backend requires Java ${MIN_JAVA_MAJOR_VERSION}+. Install a newer JDK or point PATH at one.`
      : `Isabelle PIDE: Java ${MIN_JAVA_MAJOR_VERSION}+ is required to run the Scala backend.`;
    const choice = await this.deps.ui.showWarning(message, openWalkthrough, dontShow);
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
  timeoutMs: number,
  pathLookup?: (name: string) => string | undefined
): SpawnRequest {
  const resolved = resolveIsabelleCommand(executablePath, ["version"], { platform, pathLookup });
  return { command: resolved.command, args: resolved.args, timeoutMs };
}

function extractFirstLine(value: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.split(/\r?\n/, 1)[0]?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Parse the major version from a `java -version` output blob.
 *
 * `java -version` historically writes to **stderr** in formats like:
 *   - `openjdk version "21.0.1" 2023-10-17 LTS`           → 21
 *   - `java version "17.0.10" 2024-01-16 LTS`             → 17
 *   - `java version "1.8.0_392"`                          → 8  (legacy)
 *   - `openjdk version "11.0.21" 2023-10-17`              → 11
 *
 * Returns `undefined` when no recognizable version string is present.
 */
export function parseJavaMajorVersion(output: string): number | undefined {
  if (!output) {
    return undefined;
  }
  const match = /version\s+"([^"]+)"/i.exec(output);
  if (!match) {
    return undefined;
  }
  const literal = match[1];
  const legacy = /^1\.(\d+)(?:[._].*)?$/.exec(literal);
  if (legacy) {
    const parsed = Number.parseInt(legacy[1], 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  const modern = /^(\d+)(?:[._-].*)?$/.exec(literal);
  if (modern) {
    const parsed = Number.parseInt(modern[1], 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/**
 * Evaluate a `java -version` probe result in one pass: did it spawn cleanly,
 * what major version (if any) did it report, and is that version usable
 * (i.e. `>= MIN_JAVA_MAJOR_VERSION`).
 *
 * Used by {@link PrerequisiteChecker.runCheck} to decide whether a bundled
 * JRE candidate is good enough or whether to fall back to PATH `"java"`.
 */
interface JavaProbeEvaluation {
  readonly spawnOk: boolean;
  readonly major: number | undefined;
  readonly ok: boolean;
}

function evaluateJavaProbe(result: SpawnResult): JavaProbeEvaluation {
  const spawnOk = !result.spawnFailed && result.exitCode === 0;
  const major = spawnOk ? parseJavaMajorVersion(result.stderr || result.stdout) : undefined;
  const ok = major !== undefined && major >= MIN_JAVA_MAJOR_VERSION;
  return { spawnOk, major, ok };
}

function emptyState(): PrerequisiteState {
  return { java: false, isabelle: false };
}
