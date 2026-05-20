import { describe, expect, it } from "vitest";
import {
  AutoDetectDependencies
} from "../../src/setup/isabelleAutoDetect";
import {
  MIN_JAVA_MAJOR_VERSION,
  PREREQ_CONTEXT_ALL,
  PREREQ_CONTEXT_ISABELLE,
  PREREQ_CONTEXT_JAVA,
  PrereqUi,
  PrerequisiteChecker,
  PrerequisiteCheckerDependencies,
  SpawnFn,
  SpawnRequest,
  SpawnResult,
  parseJavaMajorVersion
} from "../../src/setup/PrerequisiteChecker";

interface SpawnExpectation {
  readonly matcher: (request: SpawnRequest) => boolean;
  readonly result: SpawnResult | (() => SpawnResult);
}

function makeSpawn(expectations: readonly SpawnExpectation[]): { spawn: SpawnFn; calls: SpawnRequest[] } {
  const calls: SpawnRequest[] = [];
  const spawn: SpawnFn = async (request) => {
    calls.push(request);
    for (const expectation of expectations) {
      if (expectation.matcher(request)) {
        return typeof expectation.result === "function" ? expectation.result() : expectation.result;
      }
    }
    throw new Error(`Unexpected spawn ${request.command} ${request.args.join(" ")}`);
  };
  return { spawn, calls };
}

const ok: SpawnResult = { exitCode: 0, stdout: "openjdk version \"21.0.1\"", stderr: "", spawnFailed: false, timedOut: false };
const fail: SpawnResult = { exitCode: null, stdout: "", stderr: "", spawnFailed: true, timedOut: false };

function javaSpawnResult(versionLiteral: string): SpawnResult {
  return {
    exitCode: 0,
    stdout: "",
    // Real `java -version` writes the version line to stderr.
    stderr: `openjdk version "${versionLiteral}" 2024-04-21 LTS\nOpenJDK Runtime Environment ...`,
    spawnFailed: false,
    timedOut: false
  };
}

interface UiFake extends PrereqUi {
  readonly info: { message: string; actions: readonly string[] }[];
  readonly warning: { message: string; actions: readonly string[] }[];
  readonly commands: { command: string; args: unknown[] }[];
  readonly contexts: Record<string, boolean>;
  readonly updates: { section: string; value: unknown; target: 1 | 2 | 3 }[];
  /** Pre-program responses keyed by message prefix; default undefined. */
  reply(messagePrefix: string, response: string | undefined): void;
  setSuppressed(value: boolean): void;
  setExecutablePath(value: string): void;
  setWorkspaceFolders(present: boolean): void;
}

function makeUi(): UiFake {
  const replies = new Map<string, string | undefined>();
  let suppressed = false;
  let executablePath = "isabelle";
  let hasFolders = true;
  const info: UiFake["info"] = [];
  const warning: UiFake["warning"] = [];
  const commands: UiFake["commands"] = [];
  const contexts: Record<string, boolean> = {};
  const updates: UiFake["updates"] = [];

  const resolveReply = (message: string): string | undefined => {
    for (const [prefix, response] of replies) {
      if (message.startsWith(prefix)) {
        return response;
      }
    }
    return undefined;
  };

  return {
    info,
    warning,
    commands,
    contexts,
    updates,
    reply(prefix, response) {
      replies.set(prefix, response);
    },
    setSuppressed(value) {
      suppressed = value;
    },
    setExecutablePath(value) {
      executablePath = value;
    },
    setWorkspaceFolders(present) {
      hasFolders = present;
    },
    async showInformation(message, ...actions) {
      info.push({ message, actions });
      return resolveReply(message);
    },
    async showWarning(message, ...actions) {
      warning.push({ message, actions });
      return resolveReply(message);
    },
    async executeCommand(command, ...args) {
      commands.push({ command, args: [...args] });
      return undefined;
    },
    async setContext(key, value) {
      contexts[key] = value;
      return undefined;
    },
    hasWorkspaceFolders() {
      return hasFolders;
    },
    getConfig<T>(section: string, defaultValue: T): T {
      if (section === "setup.suppressNotifications") {
        return suppressed as unknown as T;
      }
      if (section === "executablePath") {
        return executablePath as unknown as T;
      }
      return defaultValue;
    },
    async updateConfig(section, value, target) {
      updates.push({ section, value, target });
      if (section === "setup.suppressNotifications") {
        suppressed = Boolean(value);
      }
      if (section === "executablePath") {
        executablePath = String(value);
      }
      return undefined;
    }
  };
}

function buildAutoDetect(detected?: { path: string; installRoot: string; label: string }): AutoDetectDependencies {
  if (!detected) {
    return {
      platform: "linux",
      env: {},
      fs: { isDirectory: () => false, isFile: () => false, readDirectoryNames: () => [] },
      join: (...parts) => parts.join("/")
    };
  }
  const installs = [detected.label];
  return {
    platform: "linux",
    env: { HOME: "/home/u" },
    fs: {
      isDirectory: (p) => p === "/opt",
      isFile: (p) => p === detected.path,
      readDirectoryNames: (p) => (p === "/opt" ? installs : [])
    },
    join: (...parts) => parts.join("/")
  };
}

function buildChecker(opts: {
  spawnExpectations: readonly SpawnExpectation[];
  ui?: UiFake;
  autoDetect?: AutoDetectDependencies;
  javaCommand?: string;
  isabellePathLookup?: (name: string) => string | undefined;
}): { checker: PrerequisiteChecker; ui: UiFake; logs: string[]; calls: SpawnRequest[] } {
  const ui = opts.ui ?? makeUi();
  const logs: string[] = [];
  const { spawn, calls } = makeSpawn(opts.spawnExpectations);
  const deps: PrerequisiteCheckerDependencies = {
    spawn,
    autoDetect: opts.autoDetect ?? buildAutoDetect(),
    ui,
    logger: { log: (m) => logs.push(m) },
    walkthroughId: "pub.ext#isabelle.getStarted",
    checkTimeoutMs: 5000,
    javaCommand: opts.javaCommand,
    isabellePathLookup: opts.isabellePathLookup
  };
  return { checker: new PrerequisiteChecker(deps), ui, logs, calls };
}

describe("PrerequisiteChecker.runCheck", () => {
  it("reports both reachable and sets every context key true", async () => {
    const { checker, ui, calls } = buildChecker({
      spawnExpectations: [
        { matcher: (r) => r.command === "java", result: ok },
        { matcher: (r) => r.command !== "java", result: { ...ok, stdout: "Isabelle2025: October 2025" } }
      ]
    });
    const state = await checker.runCheck();
    expect(state.java).toBe(true);
    expect(state.isabelle).toBe(true);
    expect(state.isabelleVersion).toBe("Isabelle2025: October 2025");
    expect(state.detectedIsabelle).toBeUndefined();
    expect(ui.contexts[PREREQ_CONTEXT_JAVA]).toBe(true);
    expect(ui.contexts[PREREQ_CONTEXT_ISABELLE]).toBe(true);
    expect(ui.contexts[PREREQ_CONTEXT_ALL]).toBe(true);
    expect(calls.map((c) => c.command).sort()).toEqual(["isabelle", "java"]);
  });

  it("classifies both as missing when both spawn calls fail", async () => {
    const { checker, ui } = buildChecker({
      spawnExpectations: [{ matcher: () => true, result: fail }]
    });
    const state = await checker.runCheck();
    expect(state.java).toBe(false);
    expect(state.isabelle).toBe(false);
    expect(ui.contexts[PREREQ_CONTEXT_ALL]).toBe(false);
  });

  it("only runs auto-detection when isabelle check fails", async () => {
    const { checker } = buildChecker({
      spawnExpectations: [
        { matcher: (r) => r.command === "java", result: ok },
        { matcher: (r) => r.command !== "java", result: fail }
      ],
      autoDetect: buildAutoDetect({
        path: "/opt/Isabelle2025/bin/isabelle",
        installRoot: "/opt/Isabelle2025",
        label: "Isabelle2025"
      })
    });
    const state = await checker.runCheck();
    expect(state.isabelle).toBe(false);
    expect(state.detectedIsabelle?.path).toBe("/opt/Isabelle2025/bin/isabelle");
  });

  it("respects the .ps1 launcher path on Windows when invoking isabelle version", async () => {
    const { checker, calls } = buildChecker({
      spawnExpectations: [
        { matcher: (r) => r.command === "java", result: ok },
        { matcher: (r) => r.command !== "java", result: ok }
      ],
      ui: (() => {
        const ui = makeUi();
        ui.setExecutablePath("C:\\Program Files\\Isabelle2025\\bin\\isabelle.ps1");
        return ui;
      })(),
      autoDetect: { platform: "win32", env: {}, fs: { isDirectory: () => false, isFile: () => false, readDirectoryNames: () => [] }, join: (...p) => p.join("\\") }
    });
    await checker.runCheck();
    const isabelleSpawn = calls.find((c) => c.command !== "java")!;
    expect(isabelleSpawn.command).toBe("powershell.exe");
    expect(isabelleSpawn.args).toContain("-File");
    expect(isabelleSpawn.args).toContain("C:\\Program Files\\Isabelle2025\\bin\\isabelle.ps1");
    expect(isabelleSpawn.args).toContain("version");
  });

  it("uses isabellePathLookup to resolve a bare 'isabelle' to an absolute .ps1 on Windows", async () => {
    let lookupCalls = 0;
    const { checker, calls } = buildChecker({
      spawnExpectations: [
        { matcher: (r) => r.command === "java", result: ok },
        {
          matcher: (r) => r.command === "powershell.exe",
          result: { ...ok, stdout: "Isabelle2025: October 2025" }
        }
      ],
      autoDetect: {
        platform: "win32",
        env: {},
        fs: { isDirectory: () => false, isFile: () => false, readDirectoryNames: () => [] },
        join: (...p) => p.join("\\")
      },
      isabellePathLookup: (name) => {
        lookupCalls++;
        return name === "isabelle" ? "C:\\Tools\\bin\\isabelle.ps1" : undefined;
      }
    });
    const state = await checker.runCheck();
    expect(lookupCalls).toBe(1);
    expect(state.isabelle).toBe(true);
    const isabelleSpawn = calls.find((c) => c.command !== "java")!;
    expect(isabelleSpawn.command).toBe("powershell.exe");
    expect(isabelleSpawn.args).toContain("-File");
    expect(isabelleSpawn.args).toContain("C:\\Tools\\bin\\isabelle.ps1");
    expect(isabelleSpawn.args).toContain("version");
  });

  it("falls back to spawning the bare 'isabelle' on Windows when isabellePathLookup returns undefined", async () => {
    const { checker, calls } = buildChecker({
      spawnExpectations: [
        { matcher: (r) => r.command === "java", result: ok },
        // The bare "isabelle" spawn fails with ENOENT on real Windows
        // because spawn does not honor `.PS1` via PATHEXT. Matching the
        // current behavior here.
        { matcher: (r) => r.command === "isabelle", result: fail }
      ],
      autoDetect: {
        platform: "win32",
        env: {},
        fs: { isDirectory: () => false, isFile: () => false, readDirectoryNames: () => [] },
        join: (...p) => p.join("\\")
      },
      isabellePathLookup: () => undefined
    });
    const state = await checker.runCheck();
    expect(state.isabelle).toBe(false);
    const isabelleSpawn = calls.find((c) => c.command !== "java")!;
    expect(isabelleSpawn.command).toBe("isabelle");
  });

  it("does not invoke isabellePathLookup on non-Windows platforms", async () => {
    let lookupCalls = 0;
    const { checker, calls } = buildChecker({
      spawnExpectations: [
        { matcher: (r) => r.command === "java", result: ok },
        { matcher: (r) => r.command === "isabelle", result: { ...ok, stdout: "Isabelle2025" } }
      ],
      autoDetect: {
        platform: "linux",
        env: {},
        fs: { isDirectory: () => false, isFile: () => false, readDirectoryNames: () => [] },
        join: (...p) => p.join("/")
      },
      isabellePathLookup: () => {
        lookupCalls++;
        return "/should/not/be/used";
      }
    });
    const state = await checker.runCheck();
    expect(lookupCalls).toBe(0);
    expect(state.isabelle).toBe(true);
    const isabelleSpawn = calls.find((c) => c.command !== "java")!;
    expect(isabelleSpawn.command).toBe("isabelle");
  });
});

describe("PrerequisiteChecker.notifyIfMissing — priority and suppression", () => {
  it("shows nothing when everything is fine and force=false", async () => {
    const { checker, ui } = buildChecker({
      spawnExpectations: [{ matcher: () => true, result: ok }]
    });
    const state = await checker.runCheck();
    const action = await checker.notifyIfMissing(state);
    expect(action).toBeUndefined();
    expect(ui.info).toHaveLength(0);
    expect(ui.warning).toHaveLength(0);
  });

  it("shows a happy info toast when everything is fine and force=true", async () => {
    const { checker, ui } = buildChecker({
      spawnExpectations: [{ matcher: () => true, result: ok }]
    });
    const state = await checker.runCheck();
    await checker.notifyIfMissing(state, { force: true });
    expect(ui.info).toHaveLength(1);
  });

  it("suppresses missing-prereq toasts when the suppression setting is true", async () => {
    const ui = makeUi();
    ui.setSuppressed(true);
    const { checker } = buildChecker({
      spawnExpectations: [{ matcher: () => true, result: fail }],
      ui
    });
    const state = await checker.runCheck();
    await checker.notifyIfMissing(state);
    expect(ui.info).toHaveLength(0);
    expect(ui.warning).toHaveLength(0);
  });

  it("force=true overrides the suppression setting", async () => {
    const ui = makeUi();
    ui.setSuppressed(true);
    const { checker } = buildChecker({
      spawnExpectations: [{ matcher: () => true, result: fail }],
      ui
    });
    const state = await checker.runCheck();
    await checker.notifyIfMissing(state, { force: true });
    expect(ui.warning).toHaveLength(1);
  });

  it("prefers the java-missing toast over the isabelle toast when both miss", async () => {
    const { checker, ui } = buildChecker({
      spawnExpectations: [{ matcher: () => true, result: fail }]
    });
    const state = await checker.runCheck();
    await checker.notifyIfMissing(state);
    expect(ui.warning).toHaveLength(1);
    expect(ui.warning[0].message).toMatch(/Java/);
  });

  it("offers the detected-isabelle toast when only isabelle is missing and auto-detect found one", async () => {
    const { checker, ui } = buildChecker({
      spawnExpectations: [
        { matcher: (r) => r.command === "java", result: ok },
        { matcher: (r) => r.command !== "java", result: fail }
      ],
      autoDetect: buildAutoDetect({
        path: "/opt/Isabelle2025/bin/isabelle",
        installRoot: "/opt/Isabelle2025",
        label: "Isabelle2025"
      })
    });
    const state = await checker.runCheck();
    await checker.notifyIfMissing(state);
    expect(ui.info).toHaveLength(1);
    expect(ui.info[0].message).toMatch(/detected Isabelle2025 at \/opt\/Isabelle2025/);
    expect(ui.warning).toHaveLength(0);
  });

  it("falls back to a plain install-isabelle warning when auto-detect finds nothing", async () => {
    const { checker, ui } = buildChecker({
      spawnExpectations: [
        { matcher: (r) => r.command === "java", result: ok },
        { matcher: (r) => r.command !== "java", result: fail }
      ]
    });
    const state = await checker.runCheck();
    await checker.notifyIfMissing(state);
    expect(ui.warning).toHaveLength(1);
    expect(ui.warning[0].message).toMatch(/not on PATH/);
  });
});

describe("PrerequisiteChecker.notifyIfMissing — user action handling", () => {
  it("opens the walkthrough when the user picks Open Setup Walkthrough", async () => {
    const ui = makeUi();
    ui.reply("Isabelle PIDE: Java", "Open Setup Walkthrough");
    const { checker } = buildChecker({
      spawnExpectations: [{ matcher: () => true, result: fail }],
      ui
    });
    const state = await checker.runCheck();
    const action = await checker.notifyIfMissing(state);
    expect(action).toBe("open-walkthrough");
    expect(ui.commands).toHaveLength(1);
    expect(ui.commands[0].command).toBe("workbench.action.openWalkthrough");
    expect(ui.commands[0].args[0]).toBe("pub.ext#isabelle.getStarted");
  });

  it("persists suppression on Don't show again, scoped to workspace when a folder is open", async () => {
    const ui = makeUi();
    ui.reply("Isabelle PIDE: Java", "Don't show again");
    const { checker } = buildChecker({
      spawnExpectations: [{ matcher: () => true, result: fail }],
      ui
    });
    const state = await checker.runCheck();
    await checker.notifyIfMissing(state);
    expect(ui.updates).toEqual([
      { section: "setup.suppressNotifications", value: true, target: 2 }
    ]);
  });

  it("falls back to Global scope when no workspace folder is open", async () => {
    const ui = makeUi();
    ui.setWorkspaceFolders(false);
    ui.reply("Isabelle PIDE: Java", "Don't show again");
    const { checker } = buildChecker({
      spawnExpectations: [{ matcher: () => true, result: fail }],
      ui
    });
    const state = await checker.runCheck();
    await checker.notifyIfMissing(state);
    expect(ui.updates).toEqual([
      { section: "setup.suppressNotifications", value: true, target: 1 }
    ]);
  });

  it("applies the detected Isabelle path on Use it", async () => {
    const ui = makeUi();
    ui.reply("Isabelle PIDE: detected", "Use it");
    const { checker } = buildChecker({
      spawnExpectations: [
        { matcher: (r) => r.command === "java", result: ok },
        { matcher: (r) => r.command !== "java", result: fail }
      ],
      autoDetect: buildAutoDetect({
        path: "/opt/Isabelle2025/bin/isabelle",
        installRoot: "/opt/Isabelle2025",
        label: "Isabelle2025"
      }),
      ui
    });
    const state = await checker.runCheck();
    const action = await checker.notifyIfMissing(state);
    expect(action).toBe("use-detected");
    expect(ui.updates).toEqual([
      {
        section: "executablePath",
        value: "/opt/Isabelle2025/bin/isabelle",
        target: 2
      }
    ]);
  });
});

describe("PrerequisiteChecker.dispose", () => {
  it("makes subsequent operations a no-op", async () => {
    const { checker, ui } = buildChecker({
      spawnExpectations: [{ matcher: () => true, result: fail }]
    });
    checker.dispose();
    const state = await checker.runCheck();
    expect(state.java).toBe(false);
    expect(state.isabelle).toBe(false);
    expect(ui.contexts).toEqual({});
    await checker.notifyIfMissing(state, { force: true });
    expect(ui.info).toHaveLength(0);
    expect(ui.warning).toHaveLength(0);
  });
});

describe("parseJavaMajorVersion", () => {
  it("parses modern openjdk output (21)", () => {
    expect(parseJavaMajorVersion('openjdk version "21.0.1" 2023-10-17 LTS')).toBe(21);
  });

  it("parses Oracle-style output", () => {
    expect(parseJavaMajorVersion('java version "17.0.10" 2024-01-16 LTS')).toBe(17);
  });

  it("parses legacy 1.8 output as major 8", () => {
    expect(parseJavaMajorVersion('java version "1.8.0_392"')).toBe(8);
  });

  it("parses 11", () => {
    expect(parseJavaMajorVersion('openjdk version "11.0.21" 2023-10-17')).toBe(11);
  });

  it("returns undefined for unrecognized output", () => {
    expect(parseJavaMajorVersion("no version here")).toBeUndefined();
  });

  it("returns undefined for empty input", () => {
    expect(parseJavaMajorVersion("")).toBeUndefined();
  });
});

describe("PrerequisiteChecker — bundled JRE wiring", () => {
  const bundledPath = "/home/u/ext/jre/bin/java";

  it("probes the injected bundled java path when one is provided", async () => {
    const { checker, calls } = buildChecker({
      spawnExpectations: [
        { matcher: (r) => r.command === bundledPath, result: javaSpawnResult("21.0.5") },
        { matcher: (r) => r.command !== bundledPath, result: { ...ok, stdout: "Isabelle2025" } }
      ],
      javaCommand: bundledPath
    });
    const state = await checker.runCheck();
    expect(state.java).toBe(true);
    expect(state.javaCommand).toBe(bundledPath);
    expect(state.javaVersionMajor).toBe(21);
    const javaCalls = calls.filter((c) => c.command === bundledPath || c.command === "java");
    // Only the bundled probe was needed; no PATH fallback when the bundled
    // candidate succeeds.
    expect(javaCalls.map((c) => c.command)).toEqual([bundledPath]);
  });

  it("falls back to PATH 'java' when the bundled probe fails", async () => {
    const { checker, ui, calls, logs } = buildChecker({
      spawnExpectations: [
        { matcher: (r) => r.command === bundledPath, result: fail },
        { matcher: (r) => r.command === "java", result: javaSpawnResult("21.0.5") },
        { matcher: (r) => r.command !== bundledPath && r.command !== "java", result: { ...ok, stdout: "Isabelle2025" } }
      ],
      javaCommand: bundledPath
    });
    const state = await checker.runCheck();
    expect(state.java).toBe(true);
    expect(state.javaCommand).toBe("java");
    expect(ui.contexts[PREREQ_CONTEXT_JAVA]).toBe(true);
    // Both probes happened: the bundled one (failed) and the PATH retry.
    expect(calls.filter((c) => c.command === bundledPath)).toHaveLength(1);
    expect(calls.filter((c) => c.command === "java")).toHaveLength(1);
    expect(logs.some((m) => m.includes("falling back to PATH java"))).toBe(true);
  });

  it("reports java missing when both the bundled candidate and PATH java fail", async () => {
    const { checker, ui } = buildChecker({
      spawnExpectations: [{ matcher: () => true, result: fail }],
      javaCommand: bundledPath
    });
    const state = await checker.runCheck();
    expect(state.java).toBe(false);
    expect(state.javaCommand).toBeUndefined();
    expect(ui.contexts[PREREQ_CONTEXT_JAVA]).toBe(false);
    await checker.notifyIfMissing(state);
    // Standard "install Java" toast still surfaces even though a bundled
    // candidate was attempted first.
    expect(ui.warning).toHaveLength(1);
    expect(ui.warning[0].message).toMatch(/Java/);
  });

  it("adds a macOS Gatekeeper hint when a bundled macOS JRE cannot be spawned", async () => {
    const macBundledPath = "/Users/u/.vscode/extensions/ext/jre/Contents/Home/bin/java";
    const { checker, ui } = buildChecker({
      spawnExpectations: [{ matcher: () => true, result: fail }],
      javaCommand: macBundledPath,
      autoDetect: {
        platform: "darwin",
        env: {},
        fs: { isDirectory: () => false, isFile: () => false, readDirectoryNames: () => [] },
        join: (...parts) => parts.join("/")
      }
    });
    const state = await checker.runCheck();
    expect(state.java).toBe(false);
    expect(state.javaFailureHint).toContain("macOS Gatekeeper");
    expect(state.javaFailureHint).toContain(
      'xattr -dr com.apple.quarantine "/Users/u/.vscode/extensions/ext/jre"'
    );

    await checker.notifyIfMissing(state);
    expect(ui.warning).toHaveLength(1);
    expect(ui.warning[0].message).toContain("macOS Gatekeeper");
    expect(ui.warning[0].message).toContain(
      'xattr -dr com.apple.quarantine "/Users/u/.vscode/extensions/ext/jre"'
    );
  });

  it("does not retry with PATH 'java' when the injected command already equals 'java'", async () => {
    const { checker, calls } = buildChecker({
      spawnExpectations: [{ matcher: () => true, result: fail }],
      // No javaCommand → defaults to "java" → no retry path.
    });
    await checker.runCheck();
    // Only one java probe happened (the default), no second one.
    expect(calls.filter((c) => c.command === "java")).toHaveLength(1);
  });

  it("falls back to PATH 'java' when the bundled probe reports a too-old Java", async () => {
    const { checker, ui, calls, logs } = buildChecker({
      spawnExpectations: [
        { matcher: (r) => r.command === bundledPath, result: javaSpawnResult("17.0.10") },
        { matcher: (r) => r.command === "java", result: javaSpawnResult("21.0.5") },
        {
          matcher: (r) => r.command !== bundledPath && r.command !== "java",
          result: { ...ok, stdout: "Isabelle2025" }
        }
      ],
      javaCommand: bundledPath
    });
    const state = await checker.runCheck();
    expect(state.java).toBe(true);
    expect(state.javaCommand).toBe("java");
    expect(state.javaVersionMajor).toBe(21);
    expect(state.javaTooOld).toBeUndefined();
    expect(ui.contexts[PREREQ_CONTEXT_JAVA]).toBe(true);
    expect(calls.filter((c) => c.command === bundledPath)).toHaveLength(1);
    expect(calls.filter((c) => c.command === "java")).toHaveLength(1);
    expect(
      logs.some((m) => m.includes("reported major 17") && m.includes("falling back to PATH java"))
    ).toBe(true);
  });

  it("keeps the bundled too-old diagnostic when PATH java is also too-old", async () => {
    const { checker, ui, calls } = buildChecker({
      spawnExpectations: [
        { matcher: (r) => r.command === bundledPath, result: javaSpawnResult("17.0.10") },
        { matcher: (r) => r.command === "java", result: javaSpawnResult("11.0.21") },
        { matcher: (r) => r.command !== bundledPath && r.command !== "java", result: fail }
      ],
      javaCommand: bundledPath
    });
    const state = await checker.runCheck();
    expect(state.java).toBe(false);
    expect(state.javaTooOld).toBe(true);
    // Bundled was the primary candidate; its diagnostic wins so the toast
    // names the bundled major rather than the PATH one.
    expect(state.javaVersionMajor).toBe(17);
    expect(state.javaCommand).toBe(bundledPath);
    expect(calls.filter((c) => c.command === bundledPath)).toHaveLength(1);
    expect(calls.filter((c) => c.command === "java")).toHaveLength(1);

    await checker.notifyIfMissing(state);
    expect(ui.warning).toHaveLength(1);
    expect(ui.warning[0].message).toMatch(/Java 17 is too old/);
    expect(ui.warning[0].message).toMatch(new RegExp(`Java ${MIN_JAVA_MAJOR_VERSION}\\+`));
  });

  it("keeps the bundled too-old diagnostic when PATH java spawn fails entirely", async () => {
    const { checker, ui, calls } = buildChecker({
      spawnExpectations: [
        { matcher: (r) => r.command === bundledPath, result: javaSpawnResult("17.0.10") },
        { matcher: (r) => r.command === "java", result: fail },
        { matcher: (r) => r.command !== bundledPath && r.command !== "java", result: fail }
      ],
      javaCommand: bundledPath
    });
    const state = await checker.runCheck();
    expect(state.java).toBe(false);
    expect(state.javaTooOld).toBe(true);
    // PATH java was unreachable; we must not silently downgrade the
    // bundled too-old result to a generic "missing" outcome.
    expect(state.javaVersionMajor).toBe(17);
    expect(state.javaCommand).toBe(bundledPath);
    expect(calls.filter((c) => c.command === bundledPath)).toHaveLength(1);
    expect(calls.filter((c) => c.command === "java")).toHaveLength(1);

    await checker.notifyIfMissing(state);
    expect(ui.warning).toHaveLength(1);
    expect(ui.warning[0].message).toMatch(/Java 17 is too old/);
  });

  it("does not retry when the bundled probe already reports a usable Java 21+", async () => {
    const { checker, calls } = buildChecker({
      spawnExpectations: [
        { matcher: (r) => r.command === bundledPath, result: javaSpawnResult("21.0.5") },
        { matcher: (r) => r.command === "java", result: javaSpawnResult("17.0.10") },
        {
          matcher: (r) => r.command !== bundledPath && r.command !== "java",
          result: { ...ok, stdout: "Isabelle2025" }
        }
      ],
      javaCommand: bundledPath
    });
    const state = await checker.runCheck();
    expect(state.java).toBe(true);
    expect(state.javaCommand).toBe(bundledPath);
    expect(state.javaVersionMajor).toBe(21);
    // Bundled was already a usable Java 21+; the PATH fallback must not
    // fire (and must not be able to demote the result by reporting a
    // too-old or otherwise inferior runtime).
    expect(calls.filter((c) => c.command === "java")).toHaveLength(0);
  });
});

describe("PrerequisiteChecker — Java minimum-version gating", () => {
  it("classifies Java 21 as ok", async () => {
    const { checker, ui } = buildChecker({
      spawnExpectations: [
        { matcher: (r) => r.command === "java", result: javaSpawnResult("21.0.1") },
        { matcher: (r) => r.command !== "java", result: fail }
      ]
    });
    const state = await checker.runCheck();
    expect(state.java).toBe(true);
    expect(state.javaVersionMajor).toBe(21);
    expect(state.javaTooOld).toBeUndefined();
    expect(ui.contexts[PREREQ_CONTEXT_JAVA]).toBe(true);
  });

  it("classifies Java 17 as too-old and surfaces the differentiated toast", async () => {
    const { checker, ui } = buildChecker({
      spawnExpectations: [
        { matcher: (r) => r.command === "java", result: javaSpawnResult("17.0.10") },
        { matcher: (r) => r.command !== "java", result: fail }
      ]
    });
    const state = await checker.runCheck();
    expect(state.java).toBe(false);
    expect(state.javaTooOld).toBe(true);
    expect(state.javaVersionMajor).toBe(17);
    expect(ui.contexts[PREREQ_CONTEXT_JAVA]).toBe(false);

    await checker.notifyIfMissing(state);
    expect(ui.warning).toHaveLength(1);
    expect(ui.warning[0].message).toMatch(/Java 17 is too old/);
    expect(ui.warning[0].message).toMatch(new RegExp(`Java ${MIN_JAVA_MAJOR_VERSION}\\+`));
  });

  it("classifies legacy Java 8 (1.8.0_x) as too-old", async () => {
    const { checker, ui } = buildChecker({
      spawnExpectations: [
        { matcher: (r) => r.command === "java", result: javaSpawnResult("1.8.0_392") },
        { matcher: (r) => r.command !== "java", result: fail }
      ]
    });
    const state = await checker.runCheck();
    expect(state.java).toBe(false);
    expect(state.javaTooOld).toBe(true);
    expect(state.javaVersionMajor).toBe(8);
    await checker.notifyIfMissing(state);
    expect(ui.warning[0].message).toMatch(/Java 8 is too old/);
  });

  it("shows the generic install-Java toast when java -version output cannot be parsed", async () => {
    const { checker, ui } = buildChecker({
      spawnExpectations: [
        {
          matcher: (r) => r.command === "java",
          result: { ...ok, stderr: "garbled output", stdout: "" }
        },
        { matcher: (r) => r.command !== "java", result: fail }
      ]
    });
    const state = await checker.runCheck();
    expect(state.java).toBe(false);
    expect(state.javaVersionMajor).toBeUndefined();
    expect(state.javaTooOld).toBeUndefined();
    await checker.notifyIfMissing(state);
    expect(ui.warning).toHaveLength(1);
    expect(ui.warning[0].message).toMatch(new RegExp(`Java ${MIN_JAVA_MAJOR_VERSION}\\+ is required`));
    expect(ui.warning[0].message).not.toMatch(/too old/);
  });
});
