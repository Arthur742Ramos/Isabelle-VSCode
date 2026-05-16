import * as fs from "fs/promises";
import * as path from "path";
import { DiscoverSessionsResult, DiscoveredSession } from "../protocol/messages";
import { parseRootFile, parseRootsFile } from "./rootParser";

export interface WorkspaceDiscoveryOptions {
  workspaceFolders: string[];
  extraRoots?: string[];
}

export async function discoverWorkspaceSessions(
  options: WorkspaceDiscoveryOptions
): Promise<DiscoverSessionsResult> {
  const sessions: DiscoveredSession[] = [];
  const scannedDirectories = new Set<string>();

  for (const workspaceFolder of options.workspaceFolders) {
    const rootDirectories = await findRootDirectories(workspaceFolder, options.extraRoots ?? []);

    for (const rootDirectory of rootDirectories) {
      const normalized = path.resolve(rootDirectory);
      if (scannedDirectories.has(normalized)) {
        continue;
      }

      scannedDirectories.add(normalized);
      const rootPath = path.join(normalized, "ROOT");
      const source = await readOptionalFile(rootPath);
      if (source) {
        sessions.push(...parseRootFile(source, normalized));
      }
    }
  }

  return { sessions };
}

async function findRootDirectories(workspaceFolder: string, extraRoots: string[]): Promise<string[]> {
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

  return [...roots];
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

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
