import * as fs from "fs/promises";
import * as path from "path";
import { DiscoverSessionsResult, DiscoveredSession } from "../protocol/messages";
import { parseRootFile, parseRootsFile } from "./rootParser";

export interface WorkspaceDiscoveryOptions {
  workspaceFolders: string[];
  extraRoots?: string[];
  afpPath?: string;
}

export async function discoverWorkspaceSessions(
  options: WorkspaceDiscoveryOptions
): Promise<DiscoverSessionsResult> {
  const sessions: DiscoveredSession[] = [];
  const scannedDirectories = new Set<string>();

  for (const workspaceFolder of options.workspaceFolders) {
    const rootDirectories = await findRootDirectories(workspaceFolder, options.extraRoots ?? [], options.afpPath);

    for (const rootDirectory of rootDirectories) {
      const normalized = path.resolve(rootDirectory);
      if (scannedDirectories.has(normalized)) {
        continue;
      }

      scannedDirectories.add(normalized);
      const rootPath = path.join(normalized, "ROOT");
      const source = await readOptionalFile(rootPath);
      if (source) {
        sessions.push(...await resolveSessionTheoryPaths(parseRootFile(source, normalized)));
      }
    }
  }

  return {
    sessions: sessions.sort((left, right) => left.name.localeCompare(right.name))
  };
}

async function findRootDirectories(
  workspaceFolder: string,
  extraRoots: string[],
  afpPath: string | undefined
): Promise<string[]> {
  const roots = new Set<string>([workspaceFolder]);
  const rootsFile = await readOptionalFile(path.join(workspaceFolder, "ROOTS"));

  if (rootsFile) {
    for (const root of parseRootsFile(rootsFile)) {
      roots.add(path.resolve(workspaceFolder, root));
    }
  }

  for (const root of extraRoots) {
    roots.add(path.isAbsolute(root) ? root : path.resolve(workspaceFolder, root));
  }

  if (afpPath) {
    roots.add(path.resolve(afpPath, "thys"));
  }

  for (const root of await findNestedRootDirectories(workspaceFolder)) {
    roots.add(root);
  }

  return [...roots];
}

async function findNestedRootDirectories(workspaceFolder: string): Promise<string[]> {
  const discovered: string[] = [];
  await walkForRootFiles(workspaceFolder, discovered, 0);
  return discovered;
}

async function walkForRootFiles(directory: string, discovered: string[], depth: number): Promise<void> {
  if (depth > 5 || shouldSkipDirectory(directory)) {
    return;
  }

  const entries = await readDirectory(directory);
  if (!entries) {
    return;
  }

  if (entries.some((entry) => entry.isFile() && entry.name === "ROOT")) {
    discovered.push(directory);
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    await walkForRootFiles(path.join(directory, entry.name), discovered, depth + 1);
  }
}

async function readDirectory(directory: string): Promise<import("fs").Dirent[] | undefined> {
  try {
    return await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (
      isNodeError(error) &&
      (error.code === "ENOENT" || error.code === "EACCES" || error.code === "EPERM")
    ) {
      return undefined;
    }
    throw error;
  }
}

function shouldSkipDirectory(directory: string): boolean {
  const base = path.basename(directory);
  return base === ".git" || base === "node_modules" || base === "out" || base === "target" || base === ".metals";
}

async function resolveSessionTheoryPaths(sessions: DiscoveredSession[]): Promise<DiscoveredSession[]> {
  return Promise.all(
    sessions.map(async (session) => {
      const theoryRoots = [
        session.sessionDirectory,
        ...session.directories.map((directory) => path.resolve(session.sessionDirectory, directory))
      ];

      const theories = await Promise.all(
        session.theories.map(async (theory) => ({
          ...theory,
          path: await findTheoryPath(theory.name, theoryRoots)
        }))
      );

      return {
        ...session,
        theories
      };
    })
  );
}

async function findTheoryPath(theoryName: string, roots: string[]): Promise<string | undefined> {
  const candidates = roots.flatMap((root) => theoryPathCandidates(root, theoryName));
  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function theoryPathCandidates(root: string, theoryName: string): string[] {
  const baseName = theoryName.endsWith(".thy") ? theoryName.slice(0, -4) : theoryName;
  const fileName = `${baseName}.thy`;
  const pathLike = path.join(root, fileName);
  const qualified = `${path.join(root, ...baseName.split("."))}.thy`;
  return [...new Set([pathLike, qualified])];
}

async function readOptionalFile(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
