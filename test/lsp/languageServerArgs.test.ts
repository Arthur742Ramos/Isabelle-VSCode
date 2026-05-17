import { describe, expect, it } from "vitest";
import {
  buildLanguageServerCommand,
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
});
