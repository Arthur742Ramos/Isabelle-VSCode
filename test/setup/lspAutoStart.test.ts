import { describe, expect, it } from "vitest";
import {
  LanguageServerStartupDecision,
  LanguageServerStartupInputs,
  autoStartOutcomeIsFailure,
  computeAutoStartFailureKey,
  decideLanguageServerStartup
} from "../../src/setup/lspAutoStart";

function baseInputs(overrides: Partial<LanguageServerStartupInputs> = {}): LanguageServerStartupInputs {
  return {
    userExplicitlySet: false,
    effectiveEnabled: false,
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
    expect(decision({ userExplicitlySet: true, effectiveEnabled: true })).toBe("explicit-start");
  });

  it("explicit-enable wins even when autoStart is off and prereqs are missing", () => {
    expect(
      decision({
        userExplicitlySet: true,
        effectiveEnabled: true,
        autoStartSetting: false,
        javaOk: false,
        isabelleOk: false
      })
    ).toBe("explicit-start");
  });

  it("returns 'do-not-start' when the user explicitly disabled the LSP", () => {
    expect(decision({ userExplicitlySet: true, effectiveEnabled: false })).toBe("do-not-start");
  });

  it("honors VS Code scope precedence: workspace true beats user false (effective=true)", () => {
    // VS Code resolves folder > workspace > user > default. When the
    // user opted out globally but explicitly opted in for this
    // workspace, the effective value is `true` and we start. This
    // matches the `onDidChangeConfiguration` toggle handler in
    // `extension.ts`, which reads the same setting via plain `.get()`.
    expect(decision({ userExplicitlySet: true, effectiveEnabled: true })).toBe("explicit-start");
  });

  it("honors VS Code scope precedence: workspace false beats user true (effective=false)", () => {
    // The symmetric case: opted in globally but disabled per-workspace.
    // The effective value is `false`, so we do not start.
    expect(decision({ userExplicitlySet: true, effectiveEnabled: false })).toBe("do-not-start");
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
    expect(
      decision({
        userExplicitlySet: true,
        effectiveEnabled: true,
        autoStartFailedForResolved: true
      })
    ).toBe("explicit-start");
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

describe("autoStartOutcomeIsFailure", () => {
  it("treats a thrown start() as a failure even when state is still 'starting'", () => {
    // The throw could happen before doStart() runs its first transition,
    // leaving state at "starting". Without this branch the warning toast
    // would never fire and the failure flag would not be persisted.
    expect(autoStartOutcomeIsFailure(true, "starting")).toBe(true);
  });

  it("treats a thrown start() as a failure when state is 'disabled'", () => {
    // Symmetric edge case: throw before any transition runs at all.
    expect(autoStartOutcomeIsFailure(true, "disabled")).toBe(true);
  });

  it("treats a thrown start() as a failure when state is also 'failed'", () => {
    expect(autoStartOutcomeIsFailure(true, "failed")).toBe(true);
  });

  it("treats state 'failed' as a failure even when start() returned cleanly", () => {
    // This is the normal path for reach-check / spawn errors that
    // doStart() swallows internally and transitions to "failed".
    expect(autoStartOutcomeIsFailure(false, "failed")).toBe(true);
  });

  it("treats state 'running' as success", () => {
    expect(autoStartOutcomeIsFailure(false, "running")).toBe(false);
  });

  it("treats state 'starting' as success when start() did not throw", () => {
    // The auto-start call returned cleanly. The client may still be
    // racing to running, but from the activation surface this is not a
    // failure — we must not record a failure flag for an in-progress
    // start.
    expect(autoStartOutcomeIsFailure(false, "starting")).toBe(false);
  });

  it("treats state 'stopping' as success when start() did not throw", () => {
    expect(autoStartOutcomeIsFailure(false, "stopping")).toBe(false);
  });

  it("treats state 'disabled' as success when start() did not throw", () => {
    // e.g. the client was disposed mid-call; nothing to flag.
    expect(autoStartOutcomeIsFailure(false, "disabled")).toBe(false);
  });
});
