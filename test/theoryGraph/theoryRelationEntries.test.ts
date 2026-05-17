import { describe, expect, it } from "vitest";
import {
  computeReverseDependencies,
  findNodeByPath,
  TheoryDependencyGraph,
  theoryRelationEntries
} from "../../src/theoryGraph/dependencyGraph";

const graph: TheoryDependencyGraph = {
  sessions: [
    {
      name: "App",
      parent: "Base",
      importedSessions: [],
      sessionDependencies: ["Base"],
      theoryIds: ["App:Main"]
    },
    {
      name: "Base",
      parent: undefined,
      importedSessions: [],
      sessionDependencies: [],
      theoryIds: ["Base:Common", "Base:Lonely"]
    }
  ],
  nodes: [
    {
      id: "App:Main",
      theoryName: "Main",
      declaredName: undefined,
      sessionName: "App",
      path: "/p/App/Main.thy",
      imports: [
        {
          name: "Common",
          kind: "resolved",
          targetId: "Base:Common",
          targetSessionName: "Base",
          targetTheoryName: "Common"
        },
        {
          name: "Missing",
          kind: "external"
        }
      ],
      importedBy: []
    },
    {
      id: "Base:Common",
      theoryName: "Common",
      declaredName: undefined,
      sessionName: "Base",
      path: "/p/Base/Common.thy",
      imports: [],
      importedBy: ["App:Main"]
    },
    {
      id: "Base:Lonely",
      theoryName: "Lonely",
      declaredName: undefined,
      sessionName: "Base",
      path: "/p/Base/Lonely.thy",
      imports: [],
      importedBy: []
    }
  ],
  edges: [
    { sourceId: "App:Main", targetId: "Base:Common", importName: "Common" }
  ]
};

const reverse = computeReverseDependencies(graph);

describe("theoryRelationEntries", () => {
  it("returns forward imports including externals in dependencies mode", () => {
    expect(theoryRelationEntries(graph, reverse, "App:Main", "dependencies")).toEqual([
      {
        kind: "import",
        relatedTheoryId: "Base:Common",
        theoryName: "Common",
        sessionName: "Base",
        path: "/p/Base/Common.thy",
        importName: "Common",
        external: false
      },
      {
        kind: "import",
        relatedTheoryId: undefined,
        theoryName: "Missing",
        sessionName: undefined,
        path: undefined,
        importName: "Missing",
        external: true
      }
    ]);
  });

  it("returns reverse importers in dependents mode", () => {
    expect(theoryRelationEntries(graph, reverse, "Base:Common", "dependents")).toEqual([
      {
        kind: "dependent",
        relatedTheoryId: "App:Main",
        theoryName: "Main",
        sessionName: "App",
        path: "/p/App/Main.thy",
        importNames: ["Common"],
        external: false
      }
    ]);
  });

  it("returns an empty list in dependents mode for theories with no importers", () => {
    expect(theoryRelationEntries(graph, reverse, "Base:Lonely", "dependents")).toEqual([]);
  });

  it("returns an empty list for unknown theory ids in either mode", () => {
    expect(theoryRelationEntries(graph, reverse, "unknown", "dependencies")).toEqual([]);
    expect(theoryRelationEntries(graph, reverse, "unknown", "dependents")).toEqual([]);
  });
});

describe("findNodeByPath", () => {
  it("locates a node by absolute path", () => {
    const node = findNodeByPath(graph, "/p/Base/Common.thy");
    expect(node?.id).toBe("Base:Common");
  });

  it("returns undefined for paths that do not match any discovered theory", () => {
    expect(findNodeByPath(graph, "/p/App/DoesNotExist.thy")).toBeUndefined();
  });
});
