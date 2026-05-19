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
  try {
    // From compiled out/test/integration/runTest.js, the project root is three
    // levels up (out/, test/, integration/).
    const extensionDevelopmentPath = path.resolve(__dirname, "..", "..", "..");
    const extensionTestsPath = path.resolve(__dirname, "./suite/index");

    // Keep user-data and extensions outside .vscode-test/ (which CI caches) so
    // persisted profile state never leaks between runs and tests stay isolated.
    const isolatedRoot = path.join(os.tmpdir(), "isabelle-vscode-integration");
    const userDataDir = path.join(isolatedRoot, "user-data");
    const extensionsDir = path.join(isolatedRoot, "extensions");
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.mkdirSync(extensionsDir, { recursive: true });

    await runTests({
      version: VSCODE_VERSION,
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        "--user-data-dir",
        userDataDir,
        "--extensions-dir",
        extensionsDir,
        "--disable-workspace-trust"
      ]
    });
  } catch (err) {
    console.error("Failed to run integration tests");
    console.error(err);
    process.exit(1);
  }
}

void main();

