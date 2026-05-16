import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverWorkspaceSessions } from "../../src/session/workspaceDiscovery";

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "isabelle-vscode-"));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("discoverWorkspaceSessions", () => {
  it("discovers nested ROOT files and resolves theory paths", async () => {
    const entry = path.join(tempDir, "thys", "Entry");
    const sessionDir = path.join(entry, "src");
    await fs.mkdir(sessionDir, { recursive: true });
    await fs.writeFile(
      path.join(entry, "ROOT"),
      `
      session Entry in "src" = HOL +
        theories Main_Theory
      `,
      "utf8"
    );
    await fs.writeFile(path.join(sessionDir, "Main_Theory.thy"), "theory Main_Theory imports Main begin end", "utf8");

    const result = await discoverWorkspaceSessions({ workspaceFolders: [tempDir] });

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toMatchObject({
      name: "Entry",
      parent: "HOL",
      rootDirectory: entry,
      sessionDirectory: sessionDir,
      theories: [
        {
          name: "Main_Theory",
          path: path.join(sessionDir, "Main_Theory.thy")
        }
      ]
    });
  });

  it("resolves qualified theory names to nested theory paths", async () => {
    await fs.mkdir(path.join(tempDir, "Bar"), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, "ROOT"),
      `
      session Qualified = HOL +
        theories Bar.Baz
      `,
      "utf8"
    );
    await fs.writeFile(path.join(tempDir, "Bar", "Baz.thy"), "theory Baz imports Main begin end", "utf8");

    const result = await discoverWorkspaceSessions({ workspaceFolders: [tempDir] });

    expect(result.sessions[0].theories).toEqual([
      {
        name: "Bar.Baz",
        path: path.join(tempDir, "Bar", "Baz.thy")
      }
    ]);
  });

  it("uses ROOTS entries and additional configured roots", async () => {
    const rootsEntry = path.join(tempDir, "FromRoots");
    const configuredEntry = path.join(tempDir, "Configured");
    await fs.mkdir(rootsEntry, { recursive: true });
    await fs.mkdir(configuredEntry, { recursive: true });
    await fs.writeFile(path.join(tempDir, "ROOTS"), "FromRoots\n", "utf8");
    await fs.writeFile(path.join(rootsEntry, "ROOT"), "session From_Roots = HOL + theories A", "utf8");
    await fs.writeFile(path.join(configuredEntry, "ROOT"), "session Configured = HOL + theories B", "utf8");

    const result = await discoverWorkspaceSessions({
      workspaceFolders: [tempDir],
      extraRoots: ["Configured"]
    });

    expect(result.sessions.map((session) => session.name)).toEqual(["Configured", "From_Roots"]);
  });
});
