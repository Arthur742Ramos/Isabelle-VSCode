/**
 * Pure logic for the `Isabelle: Explain Current Mode` command.
 *
 * The command answers the single most-asked question users have when the
 * extension misbehaves:
 *
 *   "Is this running in LSP mode or backend-only mode, and why?"
 *
 * It compiles a structured snapshot from accessors that the extension
 * activation wires up at command-registration time. Keeping the module
 * `vscode`-free lets vitest exercise every branch without an extension host.
 *
 * Production wiring lives in `src/extension.ts`; tests live in
 * `test/setup/explainCurrentMode.test.ts`.
 */

import { IsabelleLanguageServerStatus } from "../lsp/lspTypes";
import { PrerequisiteState } from "./PrerequisiteChecker";

export type LanguageServerEnabledSetting = "true" | "false" | "default";

export type BackendState = "running" | "not-initialized";

export interface ExplainModeAccessors {
  /**
   * Current state of the LSP language client. `undefined` if the language
   * client object has not been constructed yet (e.g. activation aborted).
   */
  readonly getLanguageServerStatus: () => IsabelleLanguageServerStatus | undefined;
  /**
   * Most recent {@link PrerequisiteState} produced by
   * `PrerequisiteChecker.runCheck()`. `undefined` if the activation-time
   * check has not finished yet (race: command invoked very early).
   */
  readonly getPrerequisiteState: () => PrerequisiteState | undefined;
  /**
   * `true` once `BackendManager.getClient()` has been called at least
   * once (i.e. the backend child process exists). Backed by a closure
   * over `BackendManager` rather than asking it directly so the pure
   * module stays free of `BackendManager` imports.
   */
  readonly getBackendRunning: () => boolean;
  /**
   * Currently selected active session, if any. Backed by
   * `SessionService.getActiveSessionName()`.
   */
  readonly getActiveSessionName: () => string | undefined;
  /**
   * Snapshot of the `isabelle.languageServer.enabled` setting across user,
   * workspace, and workspace-folder scopes. `"default"` means the user has
   * not explicitly set it anywhere (so auto-start governs).
   *
   * Backed by `inspectLanguageServerEnabledAcrossScopes()` in extension.ts.
   */
  readonly getLanguageServerEnabledSetting: () => LanguageServerEnabledSetting;
  /**
   * Current value of `isabelle.languageServer.autoStart`. Backed by
   * `vscode.workspace.getConfiguration("isabelle").get<boolean>(...)` in
   * extension.ts.
   */
  readonly getLanguageServerAutoStart: () => boolean;
  /**
   * Effective `isabelle.executablePath` setting (possibly the default
   * `"isabelle"` literal). Backed by
   * `vscode.workspace.getConfiguration("isabelle").get<string>(...)` in
   * extension.ts.
   */
  readonly getIsabelleExecutablePathSetting: () => string;
  /**
   * Effective `isabelle.backend.command` setting, if explicitly set
   * (otherwise the backend uses its default bundled-jar launch path).
   * Backed by `vscode.workspace.getConfiguration(...)` in extension.ts.
   */
  readonly getBackendCommandSetting: () => string | undefined;
  /**
   * `true` when the Java command the prerequisite probe accepted is the
   * bundled `extension/jre/...` path injected by the per-platform `.vsix`.
   * `false` when the probe fell back to PATH `"java"` or could not find
   * Java at all. `undefined` when no probe has run.
   */
  readonly getJavaIsBundled: () => boolean | undefined;
}

export interface ExplainModeBackendReport {
  readonly state: BackendState;
  readonly commandSetting: string | undefined;
}

export interface ExplainModeLanguageServerReport {
  readonly state: IsabelleLanguageServerStatus["state"] | "not-initialized";
  readonly enabledSetting: LanguageServerEnabledSetting;
  readonly autoStart: boolean;
  readonly isabelleVersion: string | undefined;
  readonly commandLine: string | undefined;
  readonly lastError: string | undefined;
  readonly lastStartedAt: string | undefined;
  readonly lastStoppedAt: string | undefined;
}

export interface ExplainModePideFeaturesReport {
  readonly available: boolean;
  /** Single-line, user-facing reason. Always populated. */
  readonly reason: string;
}

export interface ExplainModeJavaReport {
  readonly available: boolean;
  readonly tooOld: boolean;
  readonly command: string | undefined;
  readonly version: string | undefined;
  readonly versionMajor: number | undefined;
  /**
   * `true` when the accepted Java came from the per-platform bundled JRE;
   * `false` when it came from PATH; `undefined` when no probe ran or no
   * Java was found.
   */
  readonly bundled: boolean | undefined;
}

export interface ExplainModeIsabelleReport {
  readonly available: boolean;
  readonly path: string | undefined;
  readonly executablePathSetting: string;
  readonly version: string | undefined;
  /**
   * Auto-detected install when the configured path failed but a likely
   * install was discovered on disk (e.g. `/Applications/Isabelle2025-2.app`
   * on macOS). Populated only when the configured launcher itself did NOT
   * answer; otherwise `undefined` because the configured path is in use.
   */
  readonly detectedFallbackPath: string | undefined;
}

export interface ExplainModeReport {
  readonly backend: ExplainModeBackendReport;
  readonly languageServer: ExplainModeLanguageServerReport;
  readonly pideFeatures: ExplainModePideFeaturesReport;
  readonly activeSession: string | undefined;
  readonly java: ExplainModeJavaReport;
  readonly isabelle: ExplainModeIsabelleReport;
}

/**
 * Compose a full {@link ExplainModeReport} from the wired accessors. Pure
 * function — no I/O, no `vscode` imports, no async.
 */
export function buildExplainModeReport(accessors: ExplainModeAccessors): ExplainModeReport {
  const prereq = accessors.getPrerequisiteState();
  const lspStatus = accessors.getLanguageServerStatus();
  const lspState = lspStatus?.state ?? "not-initialized";
  const enabledSetting = accessors.getLanguageServerEnabledSetting();
  const autoStart = accessors.getLanguageServerAutoStart();

  const languageServer: ExplainModeLanguageServerReport = {
    state: lspState,
    enabledSetting,
    autoStart,
    isabelleVersion: lspStatus?.isabelleVersion,
    commandLine: lspStatus?.commandLine,
    lastError: lspStatus?.lastError,
    lastStartedAt: lspStatus?.lastStartedAt,
    lastStoppedAt: lspStatus?.lastStoppedAt
  };

  return {
    backend: {
      state: accessors.getBackendRunning() ? "running" : "not-initialized",
      commandSetting: accessors.getBackendCommandSetting()
    },
    languageServer,
    pideFeatures: derivePideFeaturesReport(lspState, enabledSetting, autoStart, prereq),
    activeSession: accessors.getActiveSessionName(),
    java: {
      available: prereq?.java ?? false,
      tooOld: prereq?.javaTooOld ?? false,
      command: prereq?.javaCommand,
      version: prereq?.javaVersion,
      versionMajor: prereq?.javaVersionMajor,
      bundled: accessors.getJavaIsBundled()
    },
    isabelle: {
      available: prereq?.isabelle ?? false,
      path: prereq?.isabellePath,
      executablePathSetting: accessors.getIsabelleExecutablePathSetting(),
      version: prereq?.isabelleVersion,
      detectedFallbackPath:
        prereq && !prereq.isabelle ? prereq.detectedIsabelle?.path : undefined
    }
  };
}

/**
 * Single source of truth for "are PIDE-flavoured features available right
 * now". Used by the command and exposed for tests.
 *
 * The decision tree mirrors the one users would walk through reading the
 * docs:
 *
 *   1. LSP currently `running` → available.
 *   2. LSP currently `starting` → "available shortly".
 *   3. LSP `failed` → unavailable, error reason.
 *   4. LSP `stopping` → unavailable, transient.
 *   5. User explicitly set `enabled = false` → unavailable, opt-out.
 *   6. Prerequisites missing (Java or Isabelle) → unavailable, blocked
 *      on install.
 *   7. Auto-start disabled by user → unavailable, opt-out.
 *   8. Anything else → unavailable, generic "not initialised".
 */
export function derivePideFeaturesReport(
  lspState: IsabelleLanguageServerStatus["state"] | "not-initialized",
  enabledSetting: LanguageServerEnabledSetting,
  autoStart: boolean,
  prereq: PrerequisiteState | undefined
): ExplainModePideFeaturesReport {
  if (lspState === "running") {
    return { available: true, reason: "Isabelle language server is running." };
  }
  if (lspState === "starting") {
    return {
      available: false,
      reason: "Isabelle language server is still starting — features will appear once it reaches `running`."
    };
  }
  if (lspState === "failed") {
    return {
      available: false,
      reason: "Isabelle language server failed to start. See `Isabelle: Show Language Server Status` for the error."
    };
  }
  if (lspState === "stopping") {
    return {
      available: false,
      reason: "Isabelle language server is stopping."
    };
  }
  if (enabledSetting === "false") {
    return {
      available: false,
      reason: "Isabelle language server is disabled via the `isabelle.languageServer.enabled` setting."
    };
  }
  if (prereq && !prereq.java) {
    return {
      available: false,
      reason: prereq.javaTooOld
        ? `Java ${prereq.javaVersionMajor ?? "?"} is too old — PIDE features need Java 21+.`
        : "Java 21+ is not available — PIDE features need a runtime."
    };
  }
  if (prereq && !prereq.isabelle) {
    return {
      available: false,
      reason: "Isabelle CLI is not reachable — PIDE features need it on PATH or in `isabelle.executablePath`."
    };
  }
  if (!autoStart) {
    return {
      available: false,
      reason: "Auto-start is disabled via `isabelle.languageServer.autoStart`; run `Isabelle: Start Language Server` to start it manually."
    };
  }
  return {
    available: false,
    reason: "Isabelle language server has not been initialised yet."
  };
}
