import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DiscoveredSession } from "../../src/protocol/messages";
import { buildTheoryDependencyGraph, computeReverseDependencies } from "../../src/theoryGraph/dependencyGraph";

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

describe("computeReverseDependencies", () => {
  it("groups importers per target, dedupes by importer, and pre-seeds empty entries for theories with no dependents", async () => {
    const baseDir = path.join(tempDir, "Base");
    const appDir = path.join(tempDir, "App");
    await fs.mkdir(baseDir, { recursive: true });
    await fs.mkdir(appDir, { recursive: true });

    const commonPath = path.join(baseDir, "Common.thy");
    const aliasPath = path.join(baseDir, "Alias.thy");
    const userOnePath = path.join(appDir, "UserOne.thy");
    const userTwoPath = path.join(appDir, "UserTwo.thy");
    await fs.writeFile(commonPath, "theory Common imports Main begin end", "utf8");
    await fs.writeFile(aliasPath, "theory Alias imports Main begin end", "utf8");
    await fs.writeFile(userOnePath, "theory UserOne imports Common Alias begin end", "utf8");
    await fs.writeFile(userTwoPath, "theory UserTwo imports Common begin end", "utf8");

    const graph = await buildTheoryDependencyGraph([
      session(
        "App",
        appDir,
        [
          { name: "UserOne", path: userOnePath },
          { name: "UserTwo", path: userTwoPath }
        ],
        { parent: "Base" }
      ),
      session("Base", baseDir, [
        { name: "Alias", path: aliasPath },
        { name: "Common", path: commonPath }
      ])
    ]);

    const reverse = computeReverseDependencies(graph);
    const ids = [...reverse.keys()].sort();
    expect(ids).toEqual(["App:UserOne", "App:UserTwo", "Base:Alias", "Base:Common"]);

    expect(reverse.get("Base:Common")).toEqual([
      {
        importerId: "App:UserOne",
        importerTheoryName: "UserOne",
        importerSessionName: "App",
        importerPath: userOnePath,
        importNames: ["Common"]
      },
      {
        importerId: "App:UserTwo",
        importerTheoryName: "UserTwo",
        importerSessionName: "App",
        importerPath: userTwoPath,
        importNames: ["Common"]
      }
    ]);

    expect(reverse.get("Base:Alias")).toEqual([
      {
        importerId: "App:UserOne",
        importerTheoryName: "UserOne",
        importerSessionName: "App",
        importerPath: userOnePath,
        importNames: ["Alias"]
      }
    ]);

    expect(reverse.get("App:UserOne")).toEqual([]);
    expect(reverse.get("App:UserTwo")).toEqual([]);
  });

  it("captures transitive importers without flattening the chain", async () => {
    const chainPath = path.join(tempDir, "Chain");
    await fs.mkdir(chainPath, { recursive: true });

    const lowPath = path.join(chainPath, "Low.thy");
    const midPath = path.join(chainPath, "Mid.thy");
    const highPath = path.join(chainPath, "High.thy");
    await fs.writeFile(lowPath, "theory Low imports Main begin end", "utf8");
    await fs.writeFile(midPath, "theory Mid imports Low begin end", "utf8");
    await fs.writeFile(highPath, "theory High imports Mid begin end", "utf8");

    const graph = await buildTheoryDependencyGraph([
      session("Chain", chainPath, [
        { name: "High", path: highPath },
        { name: "Low", path: lowPath },
        { name: "Mid", path: midPath }
      ])
    ]);

    const reverse = computeReverseDependencies(graph);
    expect(reverse.get("Chain:Low")?.map((entry) => entry.importerId)).toEqual(["Chain:Mid"]);
    expect(reverse.get("Chain:Mid")?.map((entry) => entry.importerId)).toEqual(["Chain:High"]);
    expect(reverse.get("Chain:High")).toEqual([]);
  });

  it("collects multiple import names from the same importer into a sorted importNames list", () => {
    const graph = {
      sessions: [],
      nodes: [
        {
          id: "S:Target",
          theoryName: "Target",
          declaredName: undefined,
          sessionName: "S",
          path: "/p/Target.thy",
          imports: [],
          importedBy: ["S:Importer"]
        },
        {
          id: "S:Importer",
          theoryName: "Importer",
          declaredName: undefined,
          sessionName: "S",
          path: "/p/Importer.thy",
          imports: [],
          importedBy: []
        }
      ],
      edges: [
        { sourceId: "S:Importer", targetId: "S:Target", importName: "Z_alias" },
        { sourceId: "S:Importer", targetId: "S:Target", importName: "A_alias" },
        { sourceId: "S:Importer", targetId: "S:Target", importName: "A_alias" }
      ]
    };

    const reverse = computeReverseDependencies(graph);
    expect(reverse.get("S:Target")).toEqual([
      {
        importerId: "S:Importer",
        importerTheoryName: "Importer",
        importerSessionName: "S",
        importerPath: "/p/Importer.thy",
        importNames: ["A_alias", "Z_alias"]
      }
    ]);
  });

  it("sorts reverse entries by session, then theory name", () => {
    const graph = {
      sessions: [],
      nodes: [
        {
          id: "S:Target",
          theoryName: "Target",
          declaredName: undefined,
          sessionName: "S",
          path: undefined,
          imports: [],
          importedBy: []
        },
        {
          id: "BetaSession:Beta",
          theoryName: "Beta",
          declaredName: undefined,
          sessionName: "BetaSession",
          path: undefined,
          imports: [],
          importedBy: []
        },
        {
          id: "AlphaSession:Zulu",
          theoryName: "Zulu",
          declaredName: undefined,
          sessionName: "AlphaSession",
          path: undefined,
          imports: [],
          importedBy: []
        },
        {
          id: "AlphaSession:Alpha",
          theoryName: "Alpha",
          declaredName: undefined,
          sessionName: "AlphaSession",
          path: undefined,
          imports: [],
          importedBy: []
        }
      ],
      edges: [
        { sourceId: "BetaSession:Beta", targetId: "S:Target", importName: "Target" },
        { sourceId: "AlphaSession:Zulu", targetId: "S:Target", importName: "Target" },
        { sourceId: "AlphaSession:Alpha", targetId: "S:Target", importName: "Target" }
      ]
    };

    const reverse = computeReverseDependencies(graph);
    expect(reverse.get("S:Target")?.map((entry) => entry.importerId)).toEqual([
      "AlphaSession:Alpha",
      "AlphaSession:Zulu",
      "BetaSession:Beta"
    ]);
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
