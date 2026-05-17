import * as path from "path";
import { describe, expect, it } from "vitest";
import { DiscoveredSession } from "../../src/protocol/messages";
import { extractImportLinks, extractImportTokens, resolveImportTargetPath } from "../../src/semantic/documentLinks";

describe("extractImportTokens", () => {
  it("extracts import names and ranges from a theory header", () => {
    const imports = extractImportTokens(
      [
        "(* ignored imports Noise *)",
        "theory Example",
        "  imports Main \"../Common/Helper\"",
        "  keywords \"demo\" :: thy_decl",
        "begin",
        "imports Body"
      ].join("\n")
    );

    expect(imports).toEqual([
      {
        name: "Main",
        range: {
          start: { line: 2, character: 10 },
          end: { line: 2, character: 14 }
        }
      },
      {
        name: "../Common/Helper",
        range: {
          start: { line: 2, character: 16 },
          end: { line: 2, character: 32 }
        }
      }
    ]);
  });
});

describe("resolveImportTargetPath", () => {
  it("resolves same-session, related-session, and session-qualified imports", () => {
    const root = process.platform === "win32" ? "C:\\work" : "/work";
    const sessions: DiscoveredSession[] = [
      session("HOL", root, [
        theory("Main", path.join(root, "HOL", "Main.thy")),
        theory("List", path.join(root, "HOL", "List.thy"))
      ]),
      {
        ...session("App", root, [
          theory("Example", path.join(root, "App", "Example.thy")),
          theory("Local", path.join(root, "App", "Local.thy"))
        ]),
        parent: "HOL"
      }
    ];

    const source = path.join(root, "App", "Example.thy");

    expect(resolveImportTargetPath("Local", source, sessions)).toBe(path.join(root, "App", "Local.thy"));
    expect(resolveImportTargetPath("Main", source, sessions)).toBe(path.join(root, "HOL", "Main.thy"));
    expect(resolveImportTargetPath("HOL.List", source, sessions)).toBe(path.join(root, "HOL", "List.thy"));
  });
});

describe("extractImportLinks", () => {
  it("returns only imports with local targets", () => {
    const root = process.platform === "win32" ? "C:\\work" : "/work";
    const source = path.join(root, "App", "Example.thy");
    const target = path.join(root, "App", "Local.thy");

    expect(
      extractImportLinks(
        "theory Example imports Local Missing begin end",
        source,
        [session("App", root, [theory("Example", source), theory("Local", target)])]
      ).map((link) => [link.name, link.targetPath])
    ).toEqual([["Local", target]]);
  });
});

function session(name: string, rootDirectory: string, theories: DiscoveredSession["theories"]): DiscoveredSession {
  return {
    name,
    rootDirectory,
    sessionDirectory: rootDirectory,
    theories,
    importedSessions: [],
    directories: [],
    documentFiles: []
  };
}

function theory(name: string, theoryPath: string): DiscoveredSession["theories"][number] {
  return {
    name,
    path: theoryPath
  };
}
