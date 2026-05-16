import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DiscoveredSession } from "../../src/protocol/messages";
import { buildTheoryDependencyGraph } from "../../src/theoryGraph/dependencyGraph";

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "isabelle-graph-"));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("buildTheoryDependencyGraph", () => {
  it("uses session dependencies and theory headers to resolve import edges", async () => {
    const baseDir = path.join(tempDir, "Base");
    const libraryDir = path.join(tempDir, "HOL-Library");
    const appDir = path.join(tempDir, "App");
    const sharedDir = path.join(tempDir, "Shared");
    await fs.mkdir(baseDir, { recursive: true });
    await fs.mkdir(libraryDir, { recursive: true });
    await fs.mkdir(appDir, { recursive: true });
    await fs.mkdir(sharedDir, { recursive: true });

    const commonPath = path.join(baseDir, "Common.thy");
    const multisetPath = path.join(libraryDir, "Multiset.thy");
    const appMainPath = path.join(appDir, "Main.thy");
    const pathImportPath = path.join(sharedDir, "Path_Import.thy");
    await fs.writeFile(commonPath, "theory Common imports Main begin end", "utf8");
    await fs.writeFile(multisetPath, "theory Multiset imports Main begin end", "utf8");
    await fs.writeFile(pathImportPath, "theory Path_Import imports Main begin end", "utf8");
    await fs.writeFile(
      appMainPath,
      'theory Main imports Common HOL-Library.Multiset "../Shared/Path_Import" Missing begin end',
      "utf8"
    );

    const graph = await buildTheoryDependencyGraph([
      session("App", appDir, [
        { name: "Main", path: appMainPath },
        { name: "Path_Import", path: pathImportPath }
      ], {
        parent: "Base",
        importedSessions: ["HOL-Library"]
      }),
      session("Base", baseDir, [{ name: "Common", path: commonPath }]),
      session("HOL-Library", libraryDir, [{ name: "Multiset", path: multisetPath }])
    ]);

    const appSession = graph.sessions.find((item) => item.name === "App");
    const appMain = graph.nodes.find((node) => node.id === "App:Main");

    expect(appSession?.sessionDependencies).toEqual(["Base", "HOL-Library"]);
    expect(appMain?.imports).toEqual([
      {
        name: "../Shared/Path_Import",
        kind: "resolved",
        targetId: "App:Path_Import",
        targetSessionName: "App",
        targetTheoryName: "Path_Import"
      },
      {
        name: "Common",
        kind: "resolved",
        targetId: "Base:Common",
        targetSessionName: "Base",
        targetTheoryName: "Common"
      },
      {
        name: "HOL-Library.Multiset",
        kind: "resolved",
        targetId: "HOL-Library:Multiset",
        targetSessionName: "HOL-Library",
        targetTheoryName: "Multiset"
      },
      {
        name: "Missing",
        kind: "external"
      }
    ]);
    expect(graph.edges.map((edge) => `${edge.sourceId}->${edge.targetId}:${edge.importName}`)).toContain(
      "App:Main->Base:Common:Common"
    );
    expect(graph.edges.some((edge) => edge.sourceId === "Base:Common" && edge.targetId === "App:Main")).toBe(false);
  });

  it("keeps discovered theories even when no theory file was resolved", async () => {
    const graph = await buildTheoryDependencyGraph([session("Broken", tempDir, [{ name: "Ghost" }])]);

    expect(graph.nodes).toEqual([
      {
        id: "Broken:Ghost",
        theoryName: "Ghost",
        declaredName: undefined,
        sessionName: "Broken",
        path: undefined,
        imports: [],
        importedBy: []
      }
    ]);
  });

  it("does not resolve a theory import to the importing theory itself", async () => {
    const mainPath = path.join(tempDir, "Main.thy");
    await fs.writeFile(mainPath, "theory Main imports Main begin end", "utf8");

    const graph = await buildTheoryDependencyGraph([session("Local", tempDir, [{ name: "Main", path: mainPath }])]);

    expect(graph.nodes[0].imports).toEqual([
      {
        name: "Main",
        kind: "external"
      }
    ]);
    expect(graph.edges).toEqual([]);
  });
});

function session(
  name: string,
  sessionDirectory: string,
  theories: Array<{ name: string; path?: string }>,
  options: { parent?: string; importedSessions?: string[] } = {}
): DiscoveredSession {
  return {
    name,
    parent: options.parent,
    rootDirectory: sessionDirectory,
    sessionDirectory,
    theories,
    importedSessions: options.importedSessions ?? [],
    directories: [],
    documentFiles: []
  };
}
