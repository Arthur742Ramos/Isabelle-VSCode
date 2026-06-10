import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BUILD_DIAGNOSTIC_COLLECTION_NAME,
  BUILD_DIAGNOSTIC_SOURCE,
  parseBuildDiagnostics
} from "../../src/build/diagnostics";

const buildServiceSourcePath = resolve(__dirname, "..", "..", "src", "build", "BuildService.ts");
const buildServiceSource = readFileSync(buildServiceSourcePath, "utf8");

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

  it("parses the `At command \"...\" (line N of \"FILE\")` error format", () => {
    expect(
      parseBuildDiagnostics(
        [
          "*** Type unification failed: Clash of types",
          "*** Failed to meet type constraint",
          '*** At command "lemma" (line 12 of "/home/u/Foo.thy")'
        ].join("\n")
      )
    ).toEqual([
      {
        filePath: "/home/u/Foo.thy",
        message: ["Type unification failed: Clash of types", "Failed to meet type constraint"].join("\n"),
        severity: "error",
        startLine: 11,
        startCharacter: 0,
        endLine: 11,
        endCharacter: 1
      }
    ]);
  });

  it("keeps the leading text of an inline `(line N of \"FILE\")` location", () => {
    expect(
      parseBuildDiagnostics('*** Failed to finish proof (line 5 of "Bar.thy")')
    ).toEqual([
      {
        filePath: "Bar.thy",
        message: "Failed to finish proof",
        severity: "error",
        startLine: 4,
        startCharacter: 0,
        endLine: 4,
        endCharacter: 1
      }
    ]);
  });

  it("does not emit an `(line N of \"FILE\")` diagnostic from a non-`***` line", () => {
    // A `(line N of "FILE")` mention in ordinary prose (no `***` prefix) is not
    // an error location.
    expect(parseBuildDiagnostics('see the note (line 5 of "Bar.thy") for details')).toEqual([]);
  });

  it("captures only the contiguous `***` run as the At-command message", () => {
    const diagnostics = parseBuildDiagnostics(
      [
        "Building session...",
        "ordinary output line",
        "*** Failed to finish proof:",
        '*** At command "by" (line 7 of "Bar.thy")'
      ].join("\n")
    );
    expect(diagnostics).toEqual([
      {
        filePath: "Bar.thy",
        message: "Failed to finish proof:",
        severity: "error",
        startLine: 6,
        startCharacter: 0,
        endLine: 6,
        endCharacter: 1
      }
    ]);
  });
});

describe("build diagnostic identity constants", () => {
  it("pins BUILD_DIAGNOSTIC_SOURCE to 'isabelle build'", () => {
    // Surfaces as the Problems-panel "Source" column for CLI-build diagnostics
    // and lets users distinguish them from Isabelle-LSP-published diagnostics.
    expect(BUILD_DIAGNOSTIC_SOURCE).toBe("isabelle build");
  });

  it("pins BUILD_DIAGNOSTIC_COLLECTION_NAME to 'isabelle-build'", () => {
    // Owner name of the BuildService DiagnosticCollection. Must stay distinct
    // from any LSP-side collection name so the two sources coexist instead of
    // overwriting one another.
    expect(BUILD_DIAGNOSTIC_COLLECTION_NAME).toBe("isabelle-build");
  });

  it("BuildService constructs its DiagnosticCollection from BUILD_DIAGNOSTIC_COLLECTION_NAME", () => {
    expect(buildServiceSource).toMatch(
      /createDiagnosticCollection\(\s*BUILD_DIAGNOSTIC_COLLECTION_NAME\s*\)/
    );
  });

  it("BuildService tags each diagnostic with BUILD_DIAGNOSTIC_SOURCE", () => {
    expect(buildServiceSource).toMatch(/\.source\s*=\s*BUILD_DIAGNOSTIC_SOURCE/);
  });
});
