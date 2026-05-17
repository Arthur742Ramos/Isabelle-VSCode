import { describe, expect, it } from "vitest";
import { buildLanguageServerCommand } from "../../src/lsp/languageServerArgs";

describe("buildLanguageServerCommand", () => {
  it("returns the Isabelle executable as the command", () => {
    expect(buildLanguageServerCommand("isabelle", []).command).toBe("isabelle");
  });

  it("trims whitespace around the executable path", () => {
    expect(buildLanguageServerCommand("  /opt/Isabelle2024/bin/isabelle  ", []).command).toBe(
      "/opt/Isabelle2024/bin/isabelle"
    );
  });

  it("always passes vscode_server as the first argument when extraArgs is empty", () => {
    expect(buildLanguageServerCommand("isabelle", []).args).toEqual(["vscode_server"]);
  });

  it("appends user-provided extra arguments after vscode_server in order", () => {
    expect(
      buildLanguageServerCommand("isabelle", ["-L", "./isabelle.log", "-v"]).args
    ).toEqual(["vscode_server", "-L", "./isabelle.log", "-v"]);
  });

  it("does not mutate the supplied extraArgs array", () => {
    const extra = ["-v"];
    buildLanguageServerCommand("isabelle", extra);
    expect(extra).toEqual(["-v"]);
  });

  it("preserves arguments that contain spaces or quotes as a single token", () => {
    expect(
      buildLanguageServerCommand("isabelle", ["--log=/tmp/has space.log", "-v"]).args
    ).toEqual(["vscode_server", "--log=/tmp/has space.log", "-v"]);
  });

  it("preserves empty-string arguments as explicit tokens", () => {
    expect(buildLanguageServerCommand("isabelle", ["", "-v"]).args).toEqual([
      "vscode_server",
      "",
      "-v"
    ]);
  });
});
