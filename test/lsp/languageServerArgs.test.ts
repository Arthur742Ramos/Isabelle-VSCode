import { describe, expect, it } from "vitest";
import {
  buildExecutableServerOptions,
  buildLanguageServerCommand,
  IsabellePathLookupDeps,
  makeWindowsIsabellePathLookup,
  resolveIsabelleCommand
} from "../../src/lsp/languageServerArgs";

describe("buildLanguageServerCommand", () => {
  it("returns the Isabelle executable as the command", () => {
    expect(buildLanguageServerCommand("isabelle", [], { platform: "linux" }).command).toBe(
      "isabelle"
    );
  });

  it("trims whitespace around the executable path", () => {
    expect(
      buildLanguageServerCommand("  /opt/Isabelle2024/bin/isabelle  ", [], { platform: "linux" })
        .command
    ).toBe("/opt/Isabelle2024/bin/isabelle");
  });

  it("always passes vscode_server as the first argument when extraArgs is empty", () => {
    expect(buildLanguageServerCommand("isabelle", [], { platform: "linux" }).args).toEqual([
      "vscode_server"
    ]);
  });

  it("appends user-provided extra arguments after vscode_server in order", () => {
    expect(
      buildLanguageServerCommand("isabelle", ["-L", "./isabelle.log", "-v"], {
        platform: "linux"
      }).args
    ).toEqual(["vscode_server", "-L", "./isabelle.log", "-v"]);
  });

  it("does not mutate the supplied extraArgs array", () => {
    const extra = ["-v"];
    buildLanguageServerCommand("isabelle", extra, { platform: "linux" });
    expect(extra).toEqual(["-v"]);
  });

  it("preserves arguments that contain spaces or quotes as a single token", () => {
    expect(
      buildLanguageServerCommand("isabelle", ["--log=/tmp/has space.log", "-v"], {
        platform: "linux"
      }).args
    ).toEqual(["vscode_server", "--log=/tmp/has space.log", "-v"]);
  });

  it("preserves empty-string arguments as explicit tokens", () => {
    expect(
      buildLanguageServerCommand("isabelle", ["", "-v"], { platform: "linux" }).args
    ).toEqual(["vscode_server", "", "-v"]);
  });

  it("wraps .ps1 launchers on Windows via powershell.exe -File", () => {
    const result = buildLanguageServerCommand(
      "C:\\Tools\\bin\\isabelle.ps1",
      ["-L", "./isabelle.log"],
      { platform: "win32" }
    );
    expect(result.command).toBe("powershell.exe");
    expect(result.args).toEqual([
      "-NoLogo",
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      "C:\\Tools\\bin\\isabelle.ps1",
      "vscode_server",
      "-L",
      "./isabelle.log"
    ]);
  });

  it("wraps .psm1 launchers on Windows the same way", () => {
    const result = buildLanguageServerCommand("isabelle.psm1", [], { platform: "win32" });
    expect(result.command).toBe("powershell.exe");
    expect(result.args).toEqual([
      "-NoLogo",
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      "isabelle.psm1",
      "vscode_server"
    ]);
  });

  it("matches .ps1 case-insensitively on Windows", () => {
    const result = buildLanguageServerCommand("ISABELLE.PS1", [], { platform: "win32" });
    expect(result.command).toBe("powershell.exe");
    expect(result.args[5]).toBe("ISABELLE.PS1");
  });

  it("does not wrap .ps1 paths on non-Windows platforms (implausible but harmless)", () => {
    const result = buildLanguageServerCommand("/opt/weird/isabelle.ps1", [], {
      platform: "linux"
    });
    expect(result.command).toBe("/opt/weird/isabelle.ps1");
    expect(result.args).toEqual(["vscode_server"]);
  });

  it("does not wrap .exe / .cmd / .bat launchers on Windows", () => {
    for (const path of [
      "C:\\Tools\\isabelle.exe",
      "C:\\Tools\\isabelle.cmd",
      "C:\\Tools\\isabelle.bat",
      "isabelle"
    ]) {
      const result = buildLanguageServerCommand(path, [], { platform: "win32" });
      expect(result.command).toBe(path);
      expect(result.args).toEqual(["vscode_server"]);
    }
  });

  it("trims the .ps1 path before wrapping it", () => {
    const result = buildLanguageServerCommand(
      "   C:\\Tools\\bin\\isabelle.ps1   ",
      [],
      { platform: "win32" }
    );
    expect(result.command).toBe("powershell.exe");
    expect(result.args).toContain("C:\\Tools\\bin\\isabelle.ps1");
    expect(result.args).not.toContain("   C:\\Tools\\bin\\isabelle.ps1   ");
  });
});

describe("resolveIsabelleCommand", () => {
  it("returns the executable and verbatim args on non-Windows", () => {
    expect(
      resolveIsabelleCommand("/opt/Isabelle2024/bin/isabelle", ["version"], {
        platform: "linux"
      })
    ).toEqual({
      command: "/opt/Isabelle2024/bin/isabelle",
      args: ["version"]
    });
  });

  it("wraps .ps1 launchers on Windows for arbitrary subcommands", () => {
    const result = resolveIsabelleCommand("C:\\Tools\\bin\\isabelle.ps1", ["version"], {
      platform: "win32"
    });
    expect(result.command).toBe("powershell.exe");
    expect(result.args).toEqual([
      "-NoLogo",
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      "C:\\Tools\\bin\\isabelle.ps1",
      "version"
    ]);
  });

  it("coerces non-string subcommand args to strings", () => {
    const result = resolveIsabelleCommand("isabelle", ["build", 42 as unknown as string], {
      platform: "linux"
    });
    expect(result.args).toEqual(["build", "42"]);
  });

  it("consults pathLookup for a bare isabelle name on Windows and wraps the resolved .ps1", () => {
    let lookupCalls = 0;
    const result = resolveIsabelleCommand("isabelle", ["version"], {
      platform: "win32",
      pathLookup: (name) => {
        lookupCalls++;
        expect(name).toBe("isabelle");
        return "C:\\Tools\\bin\\isabelle.ps1";
      }
    });
    expect(lookupCalls).toBe(1);
    expect(result.command).toBe("powershell.exe");
    expect(result.args).toEqual([
      "-NoLogo",
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      "C:\\Tools\\bin\\isabelle.ps1",
      "version"
    ]);
  });

  it("leaves the bare name untouched on Windows when pathLookup returns undefined", () => {
    const result = resolveIsabelleCommand("isabelle", ["version"], {
      platform: "win32",
      pathLookup: () => undefined
    });
    expect(result.command).toBe("isabelle");
    expect(result.args).toEqual(["version"]);
  });

  it("leaves the bare name untouched on Windows when pathLookup returns an empty string", () => {
    const result = resolveIsabelleCommand("isabelle", ["version"], {
      platform: "win32",
      pathLookup: () => ""
    });
    expect(result.command).toBe("isabelle");
    expect(result.args).toEqual(["version"]);
  });

  it("does not invoke pathLookup when the configured path contains a separator", () => {
    let lookupCalls = 0;
    const lookup = (): string | undefined => {
      lookupCalls++;
      return "C:\\should-not-be-used.ps1";
    };
    const explicitPosix = resolveIsabelleCommand("./isabelle", ["version"], {
      platform: "win32",
      pathLookup: lookup
    });
    const explicitWindows = resolveIsabelleCommand("C:\\Tools\\bin\\isabelle.ps1", ["version"], {
      platform: "win32",
      pathLookup: lookup
    });
    expect(lookupCalls).toBe(0);
    expect(explicitPosix.command).toBe("./isabelle");
    expect(explicitWindows.command).toBe("powershell.exe");
    expect(explicitWindows.args).toContain("C:\\Tools\\bin\\isabelle.ps1");
  });

  it("does not invoke pathLookup when the configured name carries a known executable extension", () => {
    let lookupCalls = 0;
    const lookup = (): string | undefined => {
      lookupCalls++;
      return "C:\\should-not-be-used.ps1";
    };
    for (const name of ["isabelle.exe", "isabelle.cmd", "isabelle.bat", "isabelle.com", "ISABELLE.EXE"]) {
      const result = resolveIsabelleCommand(name, ["version"], {
        platform: "win32",
        pathLookup: lookup
      });
      expect(result.command).toBe(name);
      expect(result.args).toEqual(["version"]);
    }
    expect(lookupCalls).toBe(0);
  });

  it("does not invoke pathLookup on non-Windows platforms", () => {
    let lookupCalls = 0;
    const lookup = (): string | undefined => {
      lookupCalls++;
      return "/should/not/be/used";
    };
    for (const platform of ["linux", "darwin", "freebsd"] as const) {
      const result = resolveIsabelleCommand("isabelle", ["version"], {
        platform,
        pathLookup: lookup
      });
      expect(result.command).toBe("isabelle");
      expect(result.args).toEqual(["version"]);
    }
    expect(lookupCalls).toBe(0);
  });

  it("leaves Windows behavior unchanged when no pathLookup is provided (backward compat)", () => {
    const result = resolveIsabelleCommand("isabelle", ["version"], { platform: "win32" });
    expect(result.command).toBe("isabelle");
    expect(result.args).toEqual(["version"]);
  });

  it("buildLanguageServerCommand also honors pathLookup for bare isabelle on Windows", () => {
    const result = buildLanguageServerCommand("isabelle", ["-L", "./isabelle.log"], {
      platform: "win32",
      pathLookup: (name) => (name === "isabelle" ? "C:\\Tools\\bin\\isabelle.ps1" : undefined)
    });
    expect(result.command).toBe("powershell.exe");
    expect(result.args).toEqual([
      "-NoLogo",
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      "C:\\Tools\\bin\\isabelle.ps1",
      "vscode_server",
      "-L",
      "./isabelle.log"
    ]);
  });
});

interface FakePathFs {
  /** Set of absolute file paths that should report as regular files. */
  readonly files: ReadonlySet<string>;
}

function makeWindowsLookupDeps(pathValue: string | undefined, fs: FakePathFs): IsabellePathLookupDeps {
  return {
    readPath: () => pathValue,
    isFile: (p) => fs.files.has(p),
    pathDelimiter: ";",
    join: (...parts) => parts.join("\\")
  };
}

describe("makeWindowsIsabellePathLookup", () => {
  it("returns a function that always yields undefined when PATH is unset", () => {
    const lookup = makeWindowsIsabellePathLookup(
      makeWindowsLookupDeps(undefined, { files: new Set(["C:\\Tools\\bin\\isabelle.ps1"]) })
    );
    expect(lookup("isabelle")).toBeUndefined();
  });

  it("returns a function that always yields undefined when PATH is an empty string", () => {
    const lookup = makeWindowsIsabellePathLookup(
      makeWindowsLookupDeps("", { files: new Set(["C:\\Tools\\bin\\isabelle.ps1"]) })
    );
    expect(lookup("isabelle")).toBeUndefined();
  });

  it("returns the absolute path when the launcher exists in the only PATH directory", () => {
    const lookup = makeWindowsIsabellePathLookup(
      makeWindowsLookupDeps("C:\\Tools\\bin", {
        files: new Set(["C:\\Tools\\bin\\isabelle.ps1"])
      })
    );
    expect(lookup("isabelle")).toBe("C:\\Tools\\bin\\isabelle.ps1");
  });

  it("scans every PATH directory until it finds a match", () => {
    const lookup = makeWindowsIsabellePathLookup(
      makeWindowsLookupDeps("C:\\Windows\\System32;C:\\Tools\\bin", {
        files: new Set(["C:\\Tools\\bin\\isabelle.ps1"])
      })
    );
    expect(lookup("isabelle")).toBe("C:\\Tools\\bin\\isabelle.ps1");
  });

  it("prefers .ps1 over .cmd when both exist in the same directory (upstream Isabelle launcher wins)", () => {
    const lookup = makeWindowsIsabellePathLookup(
      makeWindowsLookupDeps("C:\\Tools\\bin", {
        files: new Set([
          "C:\\Tools\\bin\\isabelle.ps1",
          "C:\\Tools\\bin\\isabelle.cmd"
        ])
      })
    );
    expect(lookup("isabelle")).toBe("C:\\Tools\\bin\\isabelle.ps1");
  });

  it("prefers a .ps1 in an earlier PATH directory over a .cmd in a later directory", () => {
    const lookup = makeWindowsIsabellePathLookup(
      makeWindowsLookupDeps("C:\\Tools\\A;C:\\Tools\\B", {
        files: new Set(["C:\\Tools\\A\\isabelle.ps1", "C:\\Tools\\B\\isabelle.cmd"])
      })
    );
    expect(lookup("isabelle")).toBe("C:\\Tools\\A\\isabelle.ps1");
  });

  it("prefers a .cmd in directory A over a .ps1 in directory B because directory order beats extension order", () => {
    // Search is directory-first: for each PATH directory in order, all
    // extensions are tried before moving on. So a `.cmd` in directory A
    // (listed first) wins over a `.ps1` in directory B (listed second),
    // matching what `where.exe isabelle` would report.
    const lookup = makeWindowsIsabellePathLookup(
      makeWindowsLookupDeps("C:\\Tools\\A;C:\\Tools\\B", {
        files: new Set(["C:\\Tools\\A\\isabelle.cmd", "C:\\Tools\\B\\isabelle.ps1"])
      })
    );
    expect(lookup("isabelle")).toBe("C:\\Tools\\A\\isabelle.cmd");
  });

  it("silently skips empty PATH entries (trailing ;; or leading ;)", () => {
    const lookup = makeWindowsIsabellePathLookup(
      makeWindowsLookupDeps(";C:\\Tools\\bin;;C:\\Other;", {
        files: new Set(["C:\\Tools\\bin\\isabelle.ps1"])
      })
    );
    expect(lookup("isabelle")).toBe("C:\\Tools\\bin\\isabelle.ps1");
  });

  it("returns undefined when no extension matches in any directory", () => {
    const lookup = makeWindowsIsabellePathLookup(
      makeWindowsLookupDeps("C:\\Tools\\bin;C:\\Other", {
        files: new Set(["C:\\Tools\\bin\\other.exe"])
      })
    );
    expect(lookup("isabelle")).toBeUndefined();
  });

  it("returns undefined when asked for a name that is not bare (path separators present)", () => {
    const lookup = makeWindowsIsabellePathLookup(
      makeWindowsLookupDeps("C:\\Tools\\bin", {
        files: new Set(["C:\\Tools\\bin\\isabelle.ps1"])
      })
    );
    expect(lookup("./isabelle")).toBeUndefined();
    expect(lookup("C:\\Tools\\bin\\isabelle.ps1")).toBeUndefined();
  });
});

describe("buildExecutableServerOptions", () => {
  // Regression pin. Isabelle's `vscode_server` only accepts single-dash
  // options and always uses stdio. If `transport: TransportKind.stdio` is
  // ever set on the ServerOptions we hand to vscode-languageclient, the
  // client appends `--stdio` to the args, which Isabelle's bash getopts
  // rejects with `*** Illegal command-line option "--"` and the server
  // exits 1 before any LSP traffic. These assertions intentionally pin the
  // executable-mode shape so a future refactor cannot silently re-introduce
  // the bug.
  it("returns only `command` and `args`, never a transport field", () => {
    const opts = buildExecutableServerOptions({
      command: "isabelle",
      args: ["vscode_server"]
    });
    expect(opts.command).toBe("isabelle");
    expect(opts.args).toEqual(["vscode_server"]);
    expect(Object.keys(opts).sort()).toEqual(["args", "command"]);
    expect("transport" in opts).toBe(false);
    expect("runtime" in opts).toBe(false);
    expect("options" in opts).toBe(false);
  });

  it("does not append any --stdio / --pipe / --socket argument", () => {
    const opts = buildExecutableServerOptions({
      command: "powershell.exe",
      args: ["-NoLogo", "-NoProfile", "-File", "C:\\Tools\\bin\\isabelle.ps1", "vscode_server"]
    });
    expect(opts.args).toEqual([
      "-NoLogo",
      "-NoProfile",
      "-File",
      "C:\\Tools\\bin\\isabelle.ps1",
      "vscode_server"
    ]);
    expect(opts.args.some((a) => a === "--stdio" || a.startsWith("--pipe=") || a.startsWith("--socket="))).toBe(false);
  });

  it("preserves user-supplied extra arguments verbatim", () => {
    const opts = buildExecutableServerOptions({
      command: "isabelle",
      args: ["vscode_server", "-L", "./isabelle.log", "-v"]
    });
    expect(opts.args).toEqual(["vscode_server", "-L", "./isabelle.log", "-v"]);
  });
});
