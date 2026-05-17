import * as fs from "fs/promises";
import * as path from "path";
import { DiscoveredSession } from "../protocol/messages";
import { parseTheoryHeader } from "./theoryParser";

export interface TheoryDependencyGraph {
  sessions: TheoryGraphSession[];
  nodes: TheoryGraphNode[];
  edges: TheoryGraphEdge[];
}

export interface TheoryGraphSession {
  name: string;
  parent?: string;
  importedSessions: string[];
  sessionDependencies: string[];
  theoryIds: string[];
}

export interface TheoryGraphNode {
  id: string;
  theoryName: string;
  declaredName?: string;
  sessionName: string;
  path?: string;
  imports: TheoryGraphImport[];
  importedBy: string[];
}

export interface TheoryGraphImport {
  name: string;
  kind: "resolved" | "external";
  targetId?: string;
  targetSessionName?: string;
  targetTheoryName?: string;
}

export interface TheoryGraphEdge {
  sourceId: string;
  targetId: string;
  importName: string;
}

export type TheoryGraphViewMode = "dependencies" | "dependents";

export interface ReverseDependencyEntry {
  importerId: string;
  importerTheoryName: string;
  importerSessionName: string;
  importerPath?: string;
  importNames: string[];
}

export type TheoryRelationEntry =
  | {
      kind: "import";
      relatedTheoryId?: string;
      theoryName: string;
      sessionName?: string;
      path?: string;
      importName: string;
      external: boolean;
    }
  | {
      kind: "dependent";
      relatedTheoryId: string;
      theoryName: string;
      sessionName: string;
      path?: string;
      importNames: string[];
      external: false;
    };

interface MutableTheoryGraphNode extends TheoryGraphNode {
  imports: TheoryGraphImport[];
  importedBy: string[];
}

export async function buildTheoryDependencyGraph(sessions: DiscoveredSession[]): Promise<TheoryDependencyGraph> {
  const sortedSessions = [...sessions].sort((left, right) => left.name.localeCompare(right.name));
  const nodes = await createNodes(sortedSessions);
  const sessionsByName = new Map(sortedSessions.map((session) => [session.name, session]));
  const parsedHeaders = await readTheoryHeaders(nodes);
  const graphSessions = sortedSessions.map((session) => ({
    name: session.name,
    parent: session.parent,
    importedSessions: [...session.importedSessions].sort(),
    sessionDependencies: sessionDependencies(session).sort(),
    theoryIds: nodes
      .filter((node) => node.sessionName === session.name)
      .map((node) => node.id)
      .sort()
  }));
  const edges: TheoryGraphEdge[] = [];
  const resolver = createImportResolver(nodes, sessionsByName);

  for (const node of nodes) {
    const imports = parsedHeaders.get(node.id)?.imports ?? [];
    for (const importName of imports) {
      const resolved = resolver(importName, node);
      if (resolved) {
        node.imports.push({
          name: importName,
          kind: "resolved",
          targetId: resolved.id,
          targetSessionName: resolved.sessionName,
          targetTheoryName: resolved.theoryName
        });
        resolved.importedBy.push(node.id);
        edges.push({
          sourceId: node.id,
          targetId: resolved.id,
          importName
        });
      } else {
        node.imports.push({
          name: importName,
          kind: "external"
        });
      }
    }

    node.imports.sort(compareImports);
  }

  for (const node of nodes) {
    node.importedBy.sort();
  }

  edges.sort(compareEdges);

  return {
    sessions: graphSessions,
    nodes: nodes.map((node) => ({
      id: node.id,
      theoryName: node.theoryName,
      declaredName: node.declaredName,
      sessionName: node.sessionName,
      path: node.path,
      imports: node.imports,
      importedBy: node.importedBy
    })),
    edges
  };
}

function sessionDependencies(session: DiscoveredSession): string[] {
  return [...new Set([session.parent, ...session.importedSessions].filter(isString))];
}

async function createNodes(sessions: DiscoveredSession[]): Promise<MutableTheoryGraphNode[]> {
  const nodes: MutableTheoryGraphNode[] = [];
  for (const session of sessions) {
    for (const theory of [...session.theories].sort((left, right) => left.name.localeCompare(right.name))) {
      nodes.push({
        id: `${session.name}:${theory.name}`,
        theoryName: theory.name,
        sessionName: session.name,
        path: theory.path,
        imports: [],
        importedBy: []
      });
    }
  }
  return nodes;
}

async function readTheoryHeaders(
  nodes: MutableTheoryGraphNode[]
): Promise<Map<string, { name?: string; imports: string[] }>> {
  const parsedHeaders = new Map<string, { name?: string; imports: string[] }>();
  await Promise.all(
    nodes.map(async (node) => {
      const parsed = node.path ? await readTheoryHeader(node.path) : undefined;
      if (parsed) {
        node.declaredName = parsed.name;
        parsedHeaders.set(node.id, parsed);
      }
    })
  );
  return parsedHeaders;
}

async function readTheoryHeader(theoryPath: string): Promise<{ name?: string; imports: string[] } | undefined> {
  try {
    const source = await fs.readFile(theoryPath, "utf8");
    return parseTheoryHeader(source);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function createImportResolver(
  nodes: MutableTheoryGraphNode[],
  sessionsByName: Map<string, DiscoveredSession>
): (importName: string, source: MutableTheoryGraphNode) => MutableTheoryGraphNode | undefined {
  const byNormalizedPath = new Map<string, MutableTheoryGraphNode>();
  const bySession = new Map<string, MutableTheoryGraphNode[]>();

  for (const node of nodes) {
    if (node.path) {
      byNormalizedPath.set(normalizePath(node.path), node);
    }
    const sessionNodes = bySession.get(node.sessionName) ?? [];
    sessionNodes.push(node);
    bySession.set(node.sessionName, sessionNodes);
  }

  for (const sessionNodes of bySession.values()) {
    sessionNodes.sort(compareNodes);
  }

  return (importName, source) => {
    const pathMatch = resolvePathLikeImport(importName, source, byNormalizedPath);
    if (pathMatch) {
      return pathMatch;
    }

    const sessionQualified = splitKnownSessionPrefix(importName, sessionsByName);
    if (sessionQualified) {
      return findInSession(bySession, sessionQualified.sessionName, sessionQualified.theoryName, source.id);
    }

    return (
      findInSession(bySession, source.sessionName, importName, source.id) ??
      findInRelatedSessions(bySession, sessionsByName, source.sessionName, importName)
    );
  };
}

function resolvePathLikeImport(
  importName: string,
  source: MutableTheoryGraphNode,
  byNormalizedPath: Map<string, MutableTheoryGraphNode>
): MutableTheoryGraphNode | undefined {
  if (!source.path || !/[\\/]/.test(importName)) {
    return undefined;
  }

  const withExtension = path.extname(importName) === ".thy" ? importName : `${importName}.thy`;
  return byNormalizedPath.get(normalizePath(path.resolve(path.dirname(source.path), withExtension)));
}

function splitKnownSessionPrefix(
  importName: string,
  sessionsByName: Map<string, DiscoveredSession>
): { sessionName: string; theoryName: string } | undefined {
  for (const sessionName of [...sessionsByName.keys()].sort((left, right) => right.length - left.length)) {
    const prefix = `${sessionName}.`;
    if (importName.startsWith(prefix)) {
      return {
        sessionName,
        theoryName: importName.slice(prefix.length)
      };
    }
  }
  return undefined;
}

function findInRelatedSessions(
  bySession: Map<string, MutableTheoryGraphNode[]>,
  sessionsByName: Map<string, DiscoveredSession>,
  sourceSessionName: string,
  importName: string
): MutableTheoryGraphNode | undefined {
  const sourceSession = sessionsByName.get(sourceSessionName);
  if (!sourceSession) {
    return undefined;
  }

  for (const dependency of sessionDependencies(sourceSession).sort()) {
    const match = findInSession(bySession, dependency, importName);
    if (match) {
      return match;
    }
  }

  return undefined;
}

function findInSession(
  bySession: Map<string, MutableTheoryGraphNode[]>,
  sessionName: string,
  importName: string,
  excludeId?: string
): MutableTheoryGraphNode | undefined {
  const nodes = (bySession.get(sessionName) ?? []).filter((node) => node.id !== excludeId);
  return findExact(nodes, importName) ?? findUniqueBaseName(nodes, importName);
}

function findExact(nodes: MutableTheoryGraphNode[], importName: string): MutableTheoryGraphNode | undefined {
  return nodes.find((node) => node.theoryName === importName || node.declaredName === importName);
}

function findUniqueBaseName(nodes: MutableTheoryGraphNode[], importName: string): MutableTheoryGraphNode | undefined {
  const importBase = baseTheoryName(importName);
  const matches = nodes.filter((node) => {
    const names = [node.theoryName, node.declaredName].filter(isString);
    return names.some((name) => baseTheoryName(name) === importBase);
  });
  return matches.length === 1 ? matches[0] : undefined;
}

function baseTheoryName(theoryName: string): string {
  const normalized = theoryName.replace(/\\/g, "/").replace(/\.thy$/, "");
  const pathBase = normalized.includes("/") ? normalized.slice(normalized.lastIndexOf("/") + 1) : normalized;
  return pathBase.includes(".") ? pathBase.slice(pathBase.lastIndexOf(".") + 1) : pathBase;
}

function compareImports(left: TheoryGraphImport, right: TheoryGraphImport): number {
  return left.name.localeCompare(right.name);
}

function compareEdges(left: TheoryGraphEdge, right: TheoryGraphEdge): number {
  return (
    left.sourceId.localeCompare(right.sourceId) ||
    left.targetId.localeCompare(right.targetId) ||
    left.importName.localeCompare(right.importName)
  );
}

function compareNodes(left: MutableTheoryGraphNode, right: MutableTheoryGraphNode): number {
  return left.sessionName.localeCompare(right.sessionName) || left.theoryName.localeCompare(right.theoryName);
}

function normalizePath(value: string): string {
  const normalized = path.resolve(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isString(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export function computeReverseDependencies(graph: TheoryDependencyGraph): Map<string, ReverseDependencyEntry[]> {
  const reverse = new Map<string, ReverseDependencyEntry[]>();
  for (const node of graph.nodes) {
    reverse.set(node.id, []);
  }

  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  type Bucket = Map<string, ReverseDependencyEntry>;
  const bucketsByTarget = new Map<string, Bucket>();

  for (const edge of graph.edges) {
    const source = nodeById.get(edge.sourceId);
    if (!source) {
      continue;
    }
    if (!reverse.has(edge.targetId)) {
      continue;
    }

    const bucket = bucketsByTarget.get(edge.targetId) ?? new Map();
    bucketsByTarget.set(edge.targetId, bucket);

    const existing = bucket.get(source.id);
    if (existing) {
      if (!existing.importNames.includes(edge.importName)) {
        existing.importNames.push(edge.importName);
      }
    } else {
      bucket.set(source.id, {
        importerId: source.id,
        importerTheoryName: source.theoryName,
        importerSessionName: source.sessionName,
        importerPath: source.path,
        importNames: [edge.importName]
      });
    }
  }

  for (const [targetId, bucket] of bucketsByTarget) {
    const entries = [...bucket.values()];
    for (const entry of entries) {
      entry.importNames.sort();
    }
    entries.sort(compareReverseEntries);
    reverse.set(targetId, entries);
  }

  return reverse;
}

export function theoryRelationEntries(
  graph: TheoryDependencyGraph,
  reverseAdjacency: Map<string, ReverseDependencyEntry[]>,
  theoryId: string,
  mode: TheoryGraphViewMode
): TheoryRelationEntry[] {
  const node = graph.nodes.find((candidate) => candidate.id === theoryId);
  if (!node) {
    return [];
  }

  if (mode === "dependencies") {
    return node.imports.map((graphImport): TheoryRelationEntry => {
      if (graphImport.kind === "resolved" && graphImport.targetId) {
        const target = graph.nodes.find((candidate) => candidate.id === graphImport.targetId);
        return {
          kind: "import",
          relatedTheoryId: graphImport.targetId,
          theoryName: graphImport.targetTheoryName ?? target?.theoryName ?? graphImport.name,
          sessionName: graphImport.targetSessionName ?? target?.sessionName,
          path: target?.path,
          importName: graphImport.name,
          external: false
        };
      }
      return {
        kind: "import",
        relatedTheoryId: undefined,
        theoryName: graphImport.name,
        sessionName: undefined,
        path: undefined,
        importName: graphImport.name,
        external: true
      };
    });
  }

  const reverse = reverseAdjacency.get(theoryId) ?? [];
  return reverse.map((entry): TheoryRelationEntry => ({
    kind: "dependent",
    relatedTheoryId: entry.importerId,
    theoryName: entry.importerTheoryName,
    sessionName: entry.importerSessionName,
    path: entry.importerPath,
    importNames: [...entry.importNames],
    external: false
  }));
}

export function findNodeByPath(
  graph: TheoryDependencyGraph,
  theoryPath: string
): TheoryGraphNode | undefined {
  const normalized = normalizePath(theoryPath);
  return graph.nodes.find((node) => node.path !== undefined && normalizePath(node.path) === normalized);
}

function compareReverseEntries(left: ReverseDependencyEntry, right: ReverseDependencyEntry): number {
  return (
    left.importerSessionName.localeCompare(right.importerSessionName) ||
    left.importerTheoryName.localeCompare(right.importerTheoryName) ||
    left.importerId.localeCompare(right.importerId)
  );
}
