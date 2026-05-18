import { describe, expect, it } from "vitest";
import {
  buildExplainModeReport,
  derivePideFeaturesReport,
  ExplainModeAccessors,
  LanguageServerEnabledSetting
} from "../../src/setup/explainCurrentMode";
import { IsabelleLanguageServerStatus } from "../../src/lsp/lspTypes";
import { PrerequisiteState } from "../../src/setup/PrerequisiteChecker";

function makeAccessors(overrides: Partial<ExplainModeAccessors> = {}): ExplainModeAccessors {
  const defaults: ExplainModeAccessors = {
    getLanguageServerStatus: () => undefined,
    getPrerequisiteState: () => undefined,
    getBackendRunning: () => false,
    getActiveSessionName: () => undefined,
    getLanguageServerEnabledSetting: () => "default",
    getLanguageServerAutoStart: () => true,
    getIsabelleExecutablePathSetting: () => "isabelle",
    getBackendCommandSetting: () => undefined,
    getJavaIsBundled: () => undefined
  };
  return { ...defaults, ...overrides };
}

function lspStatus(
  state: IsabelleLanguageServerStatus["state"],
  extras: Partial<IsabelleLanguageServerStatus> = {}
): IsabelleLanguageServerStatus {
  return { state, ...extras };
}

function prereq(overrides: Partial<PrerequisiteState> = {}): PrerequisiteState {
  return {
    java: true,
    javaCommand: "java",
    javaVersion: "openjdk version \"21.0.1\"",
    javaVersionMajor: 21,
    isabelle: true,
    isabellePath: "isabelle",
    isabelleVersion: "Isabelle2025-2",
    ...overrides
  };
}

describe("derivePideFeaturesReport", () => {
  it("reports available when the LSP is running", () => {
    const r = derivePideFeaturesReport("running", "default", true, prereq());
    expect(r.available).toBe(true);
    expect(r.reason).toContain("running");
  });

  it("reports starting transiently", () => {
    const r = derivePideFeaturesReport("starting", "default", true, prereq());
    expect(r.available).toBe(false);
    expect(r.reason).toMatch(/still starting/i);
  });

  it("reports failed with troubleshooting hint", () => {
    const r = derivePideFeaturesReport("failed", "default", true, prereq());
    expect(r.available).toBe(false);
    expect(r.reason).toMatch(/failed to start/i);
    expect(r.reason).toContain("Isabelle: Show Language Server Status");
  });

  it("reports stopping", () => {
    const r = derivePideFeaturesReport("stopping", "default", true, prereq());
    expect(r.available).toBe(false);
    expect(r.reason).toMatch(/stopping/i);
  });

  it("reports user opt-out when enabled = false", () => {
    const r = derivePideFeaturesReport("disabled", "false", true, prereq());
    expect(r.available).toBe(false);
    expect(r.reason).toContain("isabelle.languageServer.enabled");
  });

  it("reports Java missing when prereq has java=false", () => {
    const r = derivePideFeaturesReport("disabled", "default", true, prereq({ java: false }));
    expect(r.available).toBe(false);
    expect(r.reason).toMatch(/Java 21\+/i);
    expect(r.reason).not.toMatch(/too old/i);
  });

  it("reports Java too old with the major version", () => {
    const r = derivePideFeaturesReport(
      "disabled",
      "default",
      true,
      prereq({ java: false, javaTooOld: true, javaVersionMajor: 17 })
    );
    expect(r.available).toBe(false);
    expect(r.reason).toContain("17");
    expect(r.reason).toMatch(/too old/i);
  });

  it("reports Isabelle missing when prereq has isabelle=false but java=true", () => {
    const r = derivePideFeaturesReport(
      "disabled",
      "default",
      true,
      prereq({ isabelle: false, isabellePath: undefined, isabelleVersion: undefined })
    );
    expect(r.available).toBe(false);
    expect(r.reason).toMatch(/Isabelle CLI is not reachable/i);
    expect(r.reason).toContain("isabelle.executablePath");
  });

  it("reports auto-start opt-out when autoStart is false with prereqs ok", () => {
    const r = derivePideFeaturesReport("disabled", "default", false, prereq());
    expect(r.available).toBe(false);
    expect(r.reason).toContain("isabelle.languageServer.autoStart");
    expect(r.reason).toContain("Isabelle: Start Language Server");
  });

  it("falls back to generic message when nothing else applies", () => {
    const r = derivePideFeaturesReport("disabled", "default", true, undefined);
    expect(r.available).toBe(false);
    expect(r.reason).toMatch(/has not been initialised/i);
  });

  it("prefers the LSP-state diagnostic over a missing prereq", () => {
    // Even if Java is missing, if the LSP somehow reached `running` (e.g.
    // the user is mid-config change with a stale prereq snapshot), the
    // running state should win — we report what the system is actually
    // doing.
    const r = derivePideFeaturesReport("running", "default", true, prereq({ java: false }));
    expect(r.available).toBe(true);
  });
});

describe("buildExplainModeReport", () => {
  it("captures the running happy path", () => {
    const report = buildExplainModeReport(
      makeAccessors({
        getLanguageServerStatus: () =>
          lspStatus("running", {
            commandLine: "isabelle vscode_server",
            isabelleVersion: "Isabelle2025-2",
            lastStartedAt: "2026-05-18T22:00:00Z"
          }),
        getPrerequisiteState: () => prereq(),
        getBackendRunning: () => true,
        getActiveSessionName: () => "HOL",
        getLanguageServerEnabledSetting: () => "default",
        getLanguageServerAutoStart: () => true,
        getJavaIsBundled: () => true
      })
    );

    expect(report.pideFeatures.available).toBe(true);
    expect(report.backend.state).toBe("running");
    expect(report.languageServer.state).toBe("running");
    expect(report.languageServer.isabelleVersion).toBe("Isabelle2025-2");
    expect(report.activeSession).toBe("HOL");
    expect(report.java.available).toBe(true);
    expect(report.java.bundled).toBe(true);
    expect(report.isabelle.available).toBe(true);
    expect(report.isabelle.version).toBe("Isabelle2025-2");
  });

  it("captures the cold-start state (nothing initialised yet)", () => {
    const report = buildExplainModeReport(makeAccessors());

    expect(report.backend.state).toBe("not-initialized");
    expect(report.languageServer.state).toBe("not-initialized");
    expect(report.pideFeatures.available).toBe(false);
    expect(report.java.available).toBe(false);
    expect(report.isabelle.available).toBe(false);
    expect(report.activeSession).toBeUndefined();
  });

  it("surfaces a detected fallback Isabelle when the configured launcher is broken", () => {
    const report = buildExplainModeReport(
      makeAccessors({
        getPrerequisiteState: () =>
          prereq({
            isabelle: false,
            isabellePath: undefined,
            isabelleVersion: undefined,
            detectedIsabelle: {
              path: "/Applications/Isabelle2025-2.app/Isabelle/bin/isabelle",
              installRoot: "/Applications/Isabelle2025-2.app",
              versionLabel: "Isabelle2025-2"
            }
          })
      })
    );

    expect(report.isabelle.available).toBe(false);
    expect(report.isabelle.detectedFallbackPath).toBe(
      "/Applications/Isabelle2025-2.app/Isabelle/bin/isabelle"
    );
  });

  it("captures the LSP-disabled-via-setting case", () => {
    const enabled: LanguageServerEnabledSetting = "false";
    const report = buildExplainModeReport(
      makeAccessors({
        getLanguageServerStatus: () => lspStatus("disabled"),
        getPrerequisiteState: () => prereq(),
        getLanguageServerEnabledSetting: () => enabled
      })
    );
    expect(report.pideFeatures.available).toBe(false);
    expect(report.languageServer.enabledSetting).toBe("false");
    expect(report.pideFeatures.reason).toContain("isabelle.languageServer.enabled");
  });

  it("captures the LSP-failed case with the last error", () => {
    const report = buildExplainModeReport(
      makeAccessors({
        getLanguageServerStatus: () =>
          lspStatus("failed", { lastError: "reach-check failed: ENOENT" }),
        getPrerequisiteState: () => prereq()
      })
    );
    expect(report.pideFeatures.available).toBe(false);
    expect(report.languageServer.state).toBe("failed");
    expect(report.languageServer.lastError).toContain("ENOENT");
  });

  it("captures the auto-start-disabled-but-prereqs-ok case", () => {
    const report = buildExplainModeReport(
      makeAccessors({
        getLanguageServerStatus: () => lspStatus("disabled"),
        getPrerequisiteState: () => prereq(),
        getLanguageServerAutoStart: () => false
      })
    );
    expect(report.pideFeatures.available).toBe(false);
    expect(report.pideFeatures.reason).toContain("isabelle.languageServer.autoStart");
  });

  it("reports system Java when prereq accepted PATH java instead of the bundled candidate", () => {
    const report = buildExplainModeReport(
      makeAccessors({
        getPrerequisiteState: () => prereq({ javaCommand: "java" }),
        getJavaIsBundled: () => false
      })
    );
    expect(report.java.bundled).toBe(false);
    expect(report.java.command).toBe("java");
  });

  it("includes the configured executablePath setting even when probing failed", () => {
    const report = buildExplainModeReport(
      makeAccessors({
        getPrerequisiteState: () =>
          prereq({ isabelle: false, isabellePath: undefined, isabelleVersion: undefined }),
        getIsabelleExecutablePathSetting: () => "/opt/isabelle/bin/isabelle"
      })
    );
    expect(report.isabelle.available).toBe(false);
    expect(report.isabelle.executablePathSetting).toBe("/opt/isabelle/bin/isabelle");
  });
});
