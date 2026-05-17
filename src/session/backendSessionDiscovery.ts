import { DiscoverSessionsParams, DiscoverSessionsResult } from "../protocol/messages";
import { discoverWorkspaceSessions, WorkspaceDiscoveryOptions } from "./workspaceDiscovery";

export type BackendSessionDiscover = (params: DiscoverSessionsParams) => Promise<DiscoverSessionsResult>;
export type LocalSessionDiscover = (options: WorkspaceDiscoveryOptions) => Promise<DiscoverSessionsResult>;

export type SessionDiscoverySource = "backend" | "local";

export interface SessionDiscoveryRun {
  result: DiscoverSessionsResult;
  source: SessionDiscoverySource;
  fallbackError?: unknown;
}

export async function discoverSessionsWithBackendFallback(
  params: DiscoverSessionsParams,
  backendDiscover: BackendSessionDiscover | undefined,
  localDiscover: LocalSessionDiscover = discoverWorkspaceSessions
): Promise<SessionDiscoveryRun> {
  if (backendDiscover) {
    try {
      return {
        result: await backendDiscover(params),
        source: "backend"
      };
    } catch (error) {
      return {
        result: await localDiscover(toWorkspaceDiscoveryOptions(params)),
        source: "local",
        fallbackError: error
      };
    }
  }

  return {
    result: await localDiscover(toWorkspaceDiscoveryOptions(params)),
    source: "local"
  };
}

export function formatDiscoveryError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toWorkspaceDiscoveryOptions(params: DiscoverSessionsParams): WorkspaceDiscoveryOptions {
  return {
    workspaceFolders: params.workspaceFolders,
    extraRoots: params.roots,
    afpPath: params.afpPath
  };
}
