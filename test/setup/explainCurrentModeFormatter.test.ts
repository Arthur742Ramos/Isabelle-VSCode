import { describe, expect, it } from "vitest";
import { buildExplainModeReport } from "../../src/setup/explainCurrentMode";
import { formatExplainModeReport } from "../../src/setup/explainCurrentModeFormatter";

describe("formatExplainModeReport", () => {
  it("renders the happy path with every section present", () => {
    const report = buildExplainModeReport({
      getLanguageServerStatus: () => ({
        state: "running",
        commandLine: "isabelle vscode_server",
        isabelleVersion: "Isabelle2025-2",
        lastStartedAt: "2026-05-18T22:00:00Z"
      }),
      getPrerequisiteState: () => ({
        java: true,
        javaCommand: "/opt/isabelle/jre/bin/java",
        javaVersion: 'openjdk version "21.0.1"',
        javaVersionMajor: 21,
        isabelle: true,
        isabellePath: "/opt/isabelle/bin/isabelle",
        isabelleVersion: "Isabelle2025-2"
      }),
      getBackendRunning: () => true,
      getActiveSessionName: () => "HOL",
      getLanguageServerEnabledSetting: () => "default",
      getLanguageServerAutoStart: () => true,
      getLanguageServerExtraArgs: () => ["-L", "./isabelle.log", "-A", "with space"],
      getAutoStartFailure: () => ({ remembered: false, key: "isabelle.lsp.autoStartFailed.ok" }),
      getIsabelleExecutablePathSetting: () => "isabelle",
      getBackendCommandSetting: () => undefined,
      getJavaIsBundled: () => true
    });

    const text = formatExplainModeReport(report);

    expect(text).toContain("PIDE features: AVAILABLE");
    expect(text).toContain("Backend:");
    expect(text).toContain("State: running");
    expect(text).toContain("Language server:");
    expect(text).toContain('Extra args: -L ./isabelle.log -A "with space"');
    expect(text).toContain("Auto-start failure remembered: no");
    expect(text).toContain("Isabelle version (per LSP): Isabelle2025-2");
    expect(text).toContain("Active session: HOL");
    expect(text).toContain("Java:");
    expect(text).toContain("Source: bundled (.vsix)");
    expect(text).toContain("Isabelle:");
    expect(text).toContain("Resolved path: /opt/isabelle/bin/isabelle");
  });

  it("renders the cold-start path without crashing on missing fields", () => {
    const report = buildExplainModeReport({
      getLanguageServerStatus: () => undefined,
      getPrerequisiteState: () => undefined,
      getBackendRunning: () => false,
      getActiveSessionName: () => undefined,
      getLanguageServerEnabledSetting: () => "default",
      getLanguageServerAutoStart: () => true,
      getLanguageServerExtraArgs: () => [],
      getAutoStartFailure: () => ({ remembered: false, key: "isabelle.lsp.autoStartFailed.cold" }),
      getIsabelleExecutablePathSetting: () => "isabelle",
      getBackendCommandSetting: () => undefined,
      getJavaIsBundled: () => undefined
    });

    const text = formatExplainModeReport(report);

    expect(text).toContain("PIDE features: UNAVAILABLE");
    expect(text).toContain("State: not-initialized");
    expect(text).toContain("Active session: (none)");
    expect(text).toContain("Status: not found");
    // No bundled / system line when bundled === undefined.
    expect(text).not.toContain("Source: bundled");
    expect(text).not.toContain("Source: system");
  });

  it("renders the too-old-Java diagnostic", () => {
    const report = buildExplainModeReport({
      getLanguageServerStatus: () => ({ state: "disabled" }),
      getPrerequisiteState: () => ({
        java: false,
        javaTooOld: true,
        javaCommand: "java",
        javaVersion: 'openjdk version "17.0.10"',
        javaVersionMajor: 17,
        isabelle: false
      }),
      getBackendRunning: () => false,
      getActiveSessionName: () => undefined,
      getLanguageServerEnabledSetting: () => "default",
      getLanguageServerAutoStart: () => true,
      getLanguageServerExtraArgs: () => [],
      getAutoStartFailure: () => ({ remembered: false, key: "isabelle.lsp.autoStartFailed.java" }),
      getIsabelleExecutablePathSetting: () => "isabelle",
      getBackendCommandSetting: () => undefined,
      getJavaIsBundled: () => false
    });

    const text = formatExplainModeReport(report);

    expect(text).toContain("Status: too old (Java 17, need 21+)");
    expect(text).toContain("Source: system PATH");
    expect(text).toContain("Java 17 is too old");
  });

  it("renders the LSP-failed path with the error line", () => {
    const report = buildExplainModeReport({
      getLanguageServerStatus: () => ({
        state: "failed",
        lastError: "reach-check failed: spawn ENOENT",
        lastStoppedAt: "2026-05-18T21:55:00Z"
      }),
      getPrerequisiteState: () => ({
        java: true,
        javaCommand: "java",
        javaVersionMajor: 21,
        javaVersion: 'openjdk version "21.0.1"',
        isabelle: true,
        isabellePath: "isabelle",
        isabelleVersion: "Isabelle2025-2"
      }),
      getBackendRunning: () => true,
      getActiveSessionName: () => undefined,
      getLanguageServerEnabledSetting: () => "default",
      getLanguageServerAutoStart: () => true,
      getLanguageServerExtraArgs: () => [],
      getAutoStartFailure: () => ({ remembered: false, key: "isabelle.lsp.autoStartFailed.failed" }),
      getIsabelleExecutablePathSetting: () => "isabelle",
      getBackendCommandSetting: () => undefined,
      getJavaIsBundled: () => false
    });

    const text = formatExplainModeReport(report);
    expect(text).toContain("State: failed");
    expect(text).toContain("Last error: reach-check failed: spawn ENOENT");
    expect(text).toContain("Last stopped: 2026-05-18T21:55:00Z");
    expect(text).toContain("failed to start");
    expect(text).toContain("Next steps:");
    expect(text).toContain("Isabelle: Show Language Server Status");
  });

  it("renders remembered auto-start failure diagnostics and retry advice", () => {
    const report = buildExplainModeReport({
      getLanguageServerStatus: () => ({ state: "disabled" }),
      getPrerequisiteState: () => ({
        java: true,
        javaCommand: "java",
        javaVersionMajor: 21,
        javaVersion: 'openjdk version "21.0.1"',
        isabelle: true,
        isabellePath: "isabelle",
        isabelleVersion: "Isabelle2025-2"
      }),
      getBackendRunning: () => true,
      getActiveSessionName: () => undefined,
      getLanguageServerEnabledSetting: () => "default",
      getLanguageServerAutoStart: () => true,
      getLanguageServerExtraArgs: () => [],
      getAutoStartFailure: () => ({
        remembered: true,
        key: "isabelle.lsp.autoStartFailed.deadbeef"
      }),
      getIsabelleExecutablePathSetting: () => "isabelle",
      getBackendCommandSetting: () => undefined,
      getJavaIsBundled: () => false
    });

    const text = formatExplainModeReport(report);
    expect(text).toContain("Auto-start failure remembered: yes");
    expect(text).toContain("Auto-start failure key: isabelle.lsp.autoStartFailed.deadbeef");
    expect(text).toContain("auto-start is paused");
    expect(text).toContain("Isabelle: Start Language Server");
    expect(text).toContain("successful manual start clears the remembered failure");
  });

  it("renders the configured-backend-command override", () => {
    const report = buildExplainModeReport({
      getLanguageServerStatus: () => undefined,
      getPrerequisiteState: () => undefined,
      getBackendRunning: () => true,
      getActiveSessionName: () => undefined,
      getLanguageServerEnabledSetting: () => "default",
      getLanguageServerAutoStart: () => true,
      getLanguageServerExtraArgs: () => [],
      getAutoStartFailure: () => ({ remembered: false, key: "isabelle.lsp.autoStartFailed.backend" }),
      getIsabelleExecutablePathSetting: () => "isabelle",
      getBackendCommandSetting: () => "sbt",
      getJavaIsBundled: () => undefined
    });

    const text = formatExplainModeReport(report);
    expect(text).toContain("Configured command: sbt");
  });

  it("renders the detected-fallback Isabelle hint when the configured launcher is broken", () => {
    const report = buildExplainModeReport({
      getLanguageServerStatus: () => undefined,
      getPrerequisiteState: () => ({
        java: true,
        javaCommand: "java",
        javaVersionMajor: 21,
        isabelle: false,
        detectedIsabelle: {
          path: "/Applications/Isabelle2025-2.app/Isabelle/bin/isabelle",
          installRoot: "/Applications/Isabelle2025-2.app",
          versionLabel: "Isabelle2025-2"
        }
      }),
      getBackendRunning: () => false,
      getActiveSessionName: () => undefined,
      getLanguageServerEnabledSetting: () => "default",
      getLanguageServerAutoStart: () => true,
      getLanguageServerExtraArgs: () => [],
      getAutoStartFailure: () => ({ remembered: false, key: "isabelle.lsp.autoStartFailed.isabelle" }),
      getIsabelleExecutablePathSetting: () => "isabelle",
      getBackendCommandSetting: () => undefined,
      getJavaIsBundled: () => false
    });

    const text = formatExplainModeReport(report);
    expect(text).toContain("Detected fallback: /Applications/Isabelle2025-2.app/Isabelle/bin/isabelle");
    expect(text).toContain(
      "Set `isabelle.executablePath` to the detected launcher: /Applications/Isabelle2025-2.app/Isabelle/bin/isabelle"
    );
  });
});
