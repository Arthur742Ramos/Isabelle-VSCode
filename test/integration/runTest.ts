import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { runTests } from "@vscode/test-electron";

// Entry point invoked by `npm run test:integration`. Boots an isolated VS Code,
// loads this repository as the extension under test, and runs the Mocha suite
// at ./suite/index. See https://code.visualstudio.com/api/working-with-extensions/testing-extension
// for the standard pattern.
//
// We pin a specific VS Code version so the harness is deterministic and so the
// declared `engines.vscode` minimum (^1.90.0 — see package.json) is what we
// actually test against. Bump in lockstep with engines.vscode.
const VSCODE_VERSION = "1.90.0";

async function main(): Promise<void> {
  // Per-run unique root under os.tmpdir() so concurrent runs cannot collide
  // and so leftover state from a prior run never bleeds into a new one.
  // Created upfront so the cleanup branch always has a real directory to
  // remove, even if runTests throws before mkdir would normally happen.
  const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "isabelle-vscode-integration-"));
  const userDataDir = path.join(isolatedRoot, "user-data");
  const extensionsDir = path.join(isolatedRoot, "extensions");
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(extensionsDir, { recursive: true });

  try {
    // From compiled out/test/integration/runTest.js, the project root is three
    // levels up (out/, test/, integration/).
    const defaultExtensionDevelopmentPath = path.resolve(__dirname, "..", "..", "..");
    const extensionDevelopmentPath =
      process.env.ISABELLE_VSCODE_EXTENSION_UNDER_TEST?.trim() ||
      defaultExtensionDevelopmentPath;
    const extensionTestsPath = path.resolve(__dirname, "./suite/index");
    const tier2SmokeEnabled = process.env.ISABELLE_VSCODE_TIER2_SMOKE === "1";
    const requestedWorkspace = process.env.ISABELLE_VSCODE_TEST_WORKSPACE?.trim();
    const workspacePath = requestedWorkspace || (tier2SmokeEnabled ? extensionDevelopmentPath : undefined);
    const launchArgs = [
      ...(workspacePath ? [workspacePath] : []),
      "--user-data-dir",
      userDataDir,
      "--extensions-dir",
      extensionsDir,
      "--disable-workspace-trust"
    ];

    await runTests({
      version: VSCODE_VERSION,
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs
    });
  } catch (err) {
    console.error("Failed to run integration tests");
    console.error(err);
    process.exit(1);
  } finally {
    // Best-effort cleanup of the per-run temp tree; never let a removal
    // failure mask the actual test exit status.
    try {
      fs.rmSync(isolatedRoot, { recursive: true, force: true });
    } catch (cleanupErr) {
      console.warn(`Failed to clean up ${isolatedRoot}: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`);
    }
  }
}

void main();

