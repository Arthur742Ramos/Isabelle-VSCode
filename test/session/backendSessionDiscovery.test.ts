import { describe, expect, it } from "vitest";
import { DiscoverSessionsParams } from "../../src/protocol/messages";
import { discoverSessionsWithBackendFallback } from "../../src/session/backendSessionDiscovery";

const params: DiscoverSessionsParams = {
  workspaceFolders: ["C:\\work"],
  roots: ["More"],
  afpPath: "C:\\afp"
};

describe("discoverSessionsWithBackendFallback", () => {
  it("uses successful backend results, including empty results, without falling back", async () => {
    let localCalls = 0;
    const discovery = await discoverSessionsWithBackendFallback(
      params,
      async () => ({ sessions: [] }),
      async () => {
        localCalls++;
        return {
          sessions: [
            {
              name: "Local",
              rootDirectory: "C:\\work",
              sessionDirectory: "C:\\work",
              theories: [],
              importedSessions: [],
              directories: [],
              documentFiles: []
            }
          ]
        };
      }
    );

    expect(discovery).toEqual({
      result: { sessions: [] },
      source: "backend"
    });
    expect(localCalls).toBe(0);
  });

  it("falls back to local discovery only when the backend request fails", async () => {
    const discovery = await discoverSessionsWithBackendFallback(
      params,
      async () => {
        throw new Error("backend unavailable");
      },
      async (options) => ({
        sessions: [
          {
            name: `${options.workspaceFolders[0]}:${options.extraRoots?.[0]}:${options.afpPath}`,
            rootDirectory: "C:\\work",
            sessionDirectory: "C:\\work",
            theories: [],
            importedSessions: [],
            directories: [],
            documentFiles: []
          }
        ]
      })
    );

    expect(discovery.source).toBe("local");
    expect(discovery.fallbackError).toBeInstanceOf(Error);
    expect(discovery.result.sessions[0].name).toBe("C:\\work:More:C:\\afp");
  });
});
