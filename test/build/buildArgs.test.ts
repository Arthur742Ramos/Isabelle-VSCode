import { describe, expect, it } from "vitest";
import { createBuildCommand } from "../../src/build/buildArgs";

describe("createBuildCommand", () => {
  it("creates an Isabelle build command with de-duplicated roots and extra args", () => {
    expect(
      createBuildCommand({
        isabelleExecutablePath: "isabelle",
        sessionName: "My_Session",
        rootDirectories: ["C:\\work", "C:\\work", "C:\\work\\src"],
        extraArgs: ["-v"]
      })
    ).toEqual({
      command: "isabelle",
      args: ["build", "-d", "C:\\work", "-d", "C:\\work\\src", "-v", "My_Session"]
    });
  });
});
