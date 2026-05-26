import { describe, expect, it } from "vitest";
import { buildExplainModeReport } from "../../src/setup/explainCurrentMode";
import {
  explainModeActionForNextStep,
  explainModeActionsForReport
} from "../../src/setup/explainCurrentModeActions";

describe("explainCurrentModeActions", () => {
  it("maps failed-language-server next steps to executable commands in report order", () => {
    const report = buildExplainModeReport({
      getLanguageServerStatus: () => ({
        state: "failed",
        lastError: "spawn ENOENT"
      }),
      getPrerequisiteState: () => ({
        java: true,
        javaCommand: "java",
        javaVersionMajor: 21,
        isabelle: true,
        isabellePath: "isabelle",
        isabelleVersion: "Isabelle2025-2"
      }),
      getBackendRunning: () => true,
      getActiveSessionName: () => "HOL",
      getLanguageServerEnabledSetting: () => "default",
      getLanguageServerAutoStart: () => true,
      getLanguageServerExtraArgs: () => [],
      getAutoStartFailure: () => ({ remembered: false, key: "isabelle.lsp.autoStartFailed.failed" }),
      getIsabelleExecutablePathSetting: () => "isabelle",
      getBackendCommandSetting: () => undefined,
      getJavaIsBundled: () => false
    });

    expect(explainModeActionsForReport(report).map((action) => action.command)).toEqual([
      "isabelle.showLanguageServerStatus",
      "isabelle.checkPrerequisites",
      "isabelle.restartLanguageServer"
    ]);
  });

  it("opens settings for persistent opt-in while preserving manual start", () => {
    expect(
      explainModeActionForNextStep({
        id: "enable-language-server",
        label: "Set `isabelle.languageServer.enabled` to `true`."
      })
    ).toMatchObject({
      label: "Open language server setting",
      command: "workbench.action.openSettings",
      args: ["isabelle.languageServer.enabled"]
    });

    const startAction = explainModeActionForNextStep({
      id: "start-language-server",
      label: "Run `Isabelle: Start Language Server`."
    });
    if (!startAction) {
      throw new Error("expected a start-language-server action");
    }
    expect(startAction.command).toBe("isabelle.startLanguageServer");
  });

  it("opens the auto-start setting for auto-start opt-in guidance", () => {
    const report = buildExplainModeReport({
      getLanguageServerStatus: () => ({ state: "disabled" }),
      getPrerequisiteState: () => ({
        java: true,
        javaCommand: "java",
        javaVersionMajor: 21,
        isabelle: true,
        isabellePath: "isabelle",
        isabelleVersion: "Isabelle2025-2"
      }),
      getBackendRunning: () => false,
      getActiveSessionName: () => undefined,
      getLanguageServerEnabledSetting: () => "default",
      getLanguageServerAutoStart: () => false,
      getLanguageServerExtraArgs: () => [],
      getAutoStartFailure: () => ({ remembered: false, key: "isabelle.lsp.autoStartFailed.autostart" }),
      getIsabelleExecutablePathSetting: () => "isabelle",
      getBackendCommandSetting: () => undefined,
      getJavaIsBundled: () => false
    });

    expect(explainModeActionsForReport(report).map((action) => action.command)).toEqual([
      "isabelle.startLanguageServer",
      "workbench.action.openSettings"
    ]);
    expect(explainModeActionsForReport(report)[1]?.args).toEqual([
      "isabelle.languageServer.autoStart"
    ]);
  });

  it("omits wait-only steps and de-duplicates identical command actions", () => {
    const report = buildExplainModeReport({
      getLanguageServerStatus: () => ({ state: "starting" }),
      getPrerequisiteState: () => ({
        java: true,
        javaCommand: "java",
        javaVersionMajor: 21,
        isabelle: true,
        isabellePath: "isabelle",
        isabelleVersion: "Isabelle2025-2"
      }),
      getBackendRunning: () => false,
      getActiveSessionName: () => undefined,
      getLanguageServerEnabledSetting: () => "default",
      getLanguageServerAutoStart: () => true,
      getLanguageServerExtraArgs: () => [],
      getAutoStartFailure: () => ({ remembered: false, key: "isabelle.lsp.autoStartFailed.starting" }),
      getIsabelleExecutablePathSetting: () => "isabelle",
      getBackendCommandSetting: () => undefined,
      getJavaIsBundled: () => false
    });

    expect(explainModeActionsForReport(report).map((action) => action.command)).toEqual([
      "isabelle.showLanguageServerStatus"
    ]);
  });

  it("opens the setup walkthrough for Java install guidance when available", () => {
    const report = buildExplainModeReport({
      getLanguageServerStatus: () => ({ state: "disabled" }),
      getPrerequisiteState: () => ({
        java: false,
        javaCommand: undefined,
        javaVersionMajor: undefined,
        isabelle: true,
        isabellePath: "isabelle",
        isabelleVersion: "Isabelle2025-2"
      }),
      getBackendRunning: () => false,
      getActiveSessionName: () => undefined,
      getLanguageServerEnabledSetting: () => "default",
      getLanguageServerAutoStart: () => true,
      getLanguageServerExtraArgs: () => [],
      getAutoStartFailure: () => ({ remembered: false, key: "isabelle.lsp.autoStartFailed.java" }),
      getIsabelleExecutablePathSetting: () => "isabelle",
      getBackendCommandSetting: () => undefined,
      getJavaIsBundled: () => undefined
    });

    expect(
      explainModeActionsForReport(report, {
        setupWalkthroughId: "arthur742ramos.isabelle-pide-vscode#isabelle.getStarted"
      }).map((action) => [action.command, action.args])
    ).toEqual([
      [
        "workbench.action.openWalkthrough",
        ["arthur742ramos.isabelle-pide-vscode#isabelle.getStarted", false]
      ],
      ["isabelle.checkPrerequisites", []]
    ]);
  });

  it("de-duplicates Java guidance when no walkthrough id is available", () => {
    const report = buildExplainModeReport({
      getLanguageServerStatus: () => ({ state: "disabled" }),
      getPrerequisiteState: () => ({
        java: false,
        javaCommand: undefined,
        javaVersionMajor: undefined,
        isabelle: true,
        isabellePath: "isabelle",
        isabelleVersion: "Isabelle2025-2"
      }),
      getBackendRunning: () => false,
      getActiveSessionName: () => undefined,
      getLanguageServerEnabledSetting: () => "default",
      getLanguageServerAutoStart: () => true,
      getLanguageServerExtraArgs: () => [],
      getAutoStartFailure: () => ({ remembered: false, key: "isabelle.lsp.autoStartFailed.java" }),
      getIsabelleExecutablePathSetting: () => "isabelle",
      getBackendCommandSetting: () => undefined,
      getJavaIsBundled: () => undefined
    });

    expect(explainModeActionsForReport(report).map((action) => action.command)).toEqual([
      "isabelle.checkPrerequisites"
    ]);
  });

  it("opens the exact Isabelle executable setting for missing-Isabelle guidance", () => {
    const action = explainModeActionForNextStep({
      id: "set-isabelle-executable",
      label: "Set `isabelle.executablePath` to the detected launcher."
    });

    if (!action) {
      throw new Error("expected a set-isabelle-executable action");
    }
    expect(action.command).toBe("workbench.action.openSettings");
    expect(action.args).toEqual(["isabelle.executablePath"]);
    expect(action.detail).toContain("detected launcher");
  });

  it("has no actions when PIDE features are already available", () => {
    const report = buildExplainModeReport({
      getLanguageServerStatus: () => ({ state: "running" }),
      getPrerequisiteState: () => ({
        java: true,
        javaCommand: "java",
        javaVersionMajor: 21,
        isabelle: true,
        isabellePath: "isabelle",
        isabelleVersion: "Isabelle2025-2"
      }),
      getBackendRunning: () => true,
      getActiveSessionName: () => "HOL",
      getLanguageServerEnabledSetting: () => "default",
      getLanguageServerAutoStart: () => true,
      getLanguageServerExtraArgs: () => [],
      getAutoStartFailure: () => ({ remembered: false, key: "isabelle.lsp.autoStartFailed.ok" }),
      getIsabelleExecutablePathSetting: () => "isabelle",
      getBackendCommandSetting: () => undefined,
      getJavaIsBundled: () => false
    });

    expect(explainModeActionsForReport(report)).toEqual([]);
  });
});
