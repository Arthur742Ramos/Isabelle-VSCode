import { describe, expect, it } from "vitest";
import { parseBuildDiagnostics } from "../../src/build/diagnostics";

describe("parseBuildDiagnostics", () => {
  it("parses colon-delimited diagnostics", () => {
    expect(parseBuildDiagnostics("C:\\work\\Foo.thy:12:7: error: Failed proof\n")).toEqual([
      {
        filePath: "C:\\work\\Foo.thy",
        message: "Failed proof",
        severity: "error",
        startLine: 11,
        startCharacter: 6,
        endLine: 11,
        endCharacter: 7
      }
    ]);
  });

  it("parses Isabelle file diagnostics with message lines", () => {
    expect(
      parseBuildDiagnostics(
        [
          '*** File "C:\\work\\Foo.thy", line 5, characters 2-9:',
          "*** Failed to finish proof",
          "*** goal (1 subgoal):",
          "***  1. A"
        ].join("\n")
      )
    ).toEqual([
      {
        filePath: "C:\\work\\Foo.thy",
        message: ["Failed to finish proof", "goal (1 subgoal):", "1. A"].join("\n"),
        severity: "error",
        startLine: 4,
        startCharacter: 2,
        endLine: 4,
        endCharacter: 9
      }
    ]);
  });

  it("infers warning severity from Isabelle message lines", () => {
    expect(
      parseBuildDiagnostics(
        [
          'File "C:\\work\\Foo.thy", line 2:',
          "Warning: Legacy feature"
        ].join("\n")
      )
    ).toMatchObject([
      {
        severity: "warning",
        startLine: 1,
        startCharacter: 0
      }
    ]);
  });
});
