import { describe, expect, it } from "vitest";
import { formatBuildSpawnError } from "../../src/build/spawnErrors";

describe("formatBuildSpawnError", () => {
  it("explains how to fix a missing Isabelle command", () => {
    const error = Object.assign(new Error("spawn isabelle ENOENT"), { code: "ENOENT" });

    expect(formatBuildSpawnError(error, "isabelle").message).toContain("Set isabelle.executablePath");
  });

  it("preserves the original message for other spawn failures", () => {
    const error = Object.assign(new Error("permission denied"), { code: "EACCES" });

    expect(formatBuildSpawnError(error, "isabelle").message).toBe(
      'Unable to start Isabelle build command "isabelle": permission denied'
    );
  });
});
