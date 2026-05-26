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

  it("uses the existing start command for enable and retry guidance", () => {
    expect(
      explainModeActionForNextStep({
        id: "enable-language-server",
        label: "Set `isabelle.languageServer.enabled` to `true`."
      })
    ).toMatchObject({
      label: "Start language server",
      command: "isabelle.startLanguageServer",
      args: []
    });

    expect(
      explainModeActionForNextStep({
        id: "start-language-server",
        label: "Run `Isabelle: Start Language Server`."
      }).command
    ).toBe("isabelle.startLanguageServer");
  });

  it("opens the exact Isabelle executable setting for missing-Isabelle guidance", () => {
    const action = explainModeActionForNextStep({
      id: "set-isabelle-executable",
      label: "Set `isabelle.executablePath` to the detected launcher."
    });

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
