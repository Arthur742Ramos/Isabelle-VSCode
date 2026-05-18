import { describe, expect, it } from "vitest";
import {
  LanguageServerStartupDecision,
  LanguageServerStartupInputs,
  computeAutoStartFailureKey,
  decideLanguageServerStartup
} from "../../src/setup/lspAutoStart";

function baseInputs(overrides: Partial<LanguageServerStartupInputs> = {}): LanguageServerStartupInputs {
  return {
    explicitEnabled: false,
    explicitDisabled: false,
    autoStartSetting: true,
    javaOk: true,
    isabelleOk: true,
    autoStartFailedForResolved: false,
    ...overrides
  };
}

function decision(overrides: Partial<LanguageServerStartupInputs> = {}): LanguageServerStartupDecision {
  return decideLanguageServerStartup(baseInputs(overrides));
}

describe("decideLanguageServerStartup", () => {
  it("returns 'auto-start' when defaults are met and everything works", () => {
    expect(decision()).toBe("auto-start");
  });

  it("returns 'explicit-start' when the user explicitly enabled the LSP", () => {
    expect(decision({ explicitEnabled: true })).toBe("explicit-start");
  });

  it("explicit-enable wins even when autoStart is off and prereqs are missing", () => {
    expect(
      decision({ explicitEnabled: true, autoStartSetting: false, javaOk: false, isabelleOk: false })
    ).toBe("explicit-start");
  });

  it("returns 'do-not-start' when the user explicitly disabled the LSP", () => {
    expect(decision({ explicitDisabled: true })).toBe("do-not-start");
  });

  it("explicit-disable wins over an explicit enable on a different scope", () => {
    // If both explicit signals are present, disable wins — VS Code's own
    // setting resolution will pick one, but defensively we still refuse
    // to start so a workspace-level "off" is honored.
    expect(decision({ explicitEnabled: true, explicitDisabled: true })).toBe("do-not-start");
  });

  it("does not auto-start when autoStartSetting is false", () => {
    expect(decision({ autoStartSetting: false })).toBe("do-not-start");
  });

  it("does not auto-start when Java is missing", () => {
    expect(decision({ javaOk: false })).toBe("do-not-start");
  });

  it("does not auto-start when Isabelle is missing", () => {
    expect(decision({ isabelleOk: false })).toBe("do-not-start");
  });

  it("does not auto-start when a prior auto-start failed for the same runtime", () => {
    expect(decision({ autoStartFailedForResolved: true })).toBe("do-not-start");
  });

  it("explicit-enable overrides a prior auto-start failure", () => {
    expect(decision({ explicitEnabled: true, autoStartFailedForResolved: true })).toBe(
      "explicit-start"
    );
  });
});

describe("computeAutoStartFailureKey", () => {
  it("is stable for identical inputs", () => {
    const a = computeAutoStartFailureKey("/opt/Isabelle2025/bin/isabelle", []);
    const b = computeAutoStartFailureKey("/opt/Isabelle2025/bin/isabelle", []);
    expect(a).toBe(b);
  });

  it("treats undefined and empty array as equivalent", () => {
    const a = computeAutoStartFailureKey("/opt/Isabelle2025/bin/isabelle", undefined);
    const b = computeAutoStartFailureKey("/opt/Isabelle2025/bin/isabelle", []);
    expect(a).toBe(b);
  });

  it("differs when the executable path changes", () => {
    const a = computeAutoStartFailureKey("/opt/Isabelle2024/bin/isabelle", []);
    const b = computeAutoStartFailureKey("/opt/Isabelle2025/bin/isabelle", []);
    expect(a).not.toBe(b);
  });

  it("differs when extraArgs change", () => {
    const a = computeAutoStartFailureKey("/opt/Isabelle2025/bin/isabelle", ["-L", "./a.log"]);
    const b = computeAutoStartFailureKey("/opt/Isabelle2025/bin/isabelle", ["-L", "./b.log"]);
    expect(a).not.toBe(b);
  });

  it("differs when arg order changes (different args, different key)", () => {
    const a = computeAutoStartFailureKey("/opt/Isabelle2025/bin/isabelle", ["-A", "-B"]);
    const b = computeAutoStartFailureKey("/opt/Isabelle2025/bin/isabelle", ["-B", "-A"]);
    expect(a).not.toBe(b);
  });

  it("uses the documented prefix so it's discoverable in workspaceState", () => {
    const key = computeAutoStartFailureKey("/opt/Isabelle2025/bin/isabelle", []);
    expect(key.startsWith("isabelle.lsp.autoStartFailed.")).toBe(true);
  });
});
