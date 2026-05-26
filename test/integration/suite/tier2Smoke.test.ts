import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";

const EXTENSION_ID = "arthur742ramos.isabelle-pide-vscode";
const TIER2_SMOKE_COMMAND_ID = "isabelle.internal.runTier2Smoke";
const TIER2_SMOKE_SESSION = "Isabelle_VSCode_Smoke";
const TIER2_SMOKE_ENABLED = process.env.ISABELLE_VSCODE_TIER2_SMOKE === "1";
const TIER2_SMOKE_RUNS_SLEDGEHAMMER =
  process.env.ISABELLE_VSCODE_TIER2_SMOKE_SLEDGEHAMMER === "1";

interface Tier2SmokePhase {
  readonly name: string;
  readonly ok: boolean;
  readonly detail?: string;
}

interface Tier2SmokeResult {
  readonly theoryUri: string;
  readonly sessionName: string;
  readonly phases: readonly Tier2SmokePhase[];
  readonly discoveredSessionCount: number;
  readonly backendHealth: {
    readonly isabelle: { readonly status: string };
  };
  readonly pideBackend: {
    readonly bridge: string;
    readonly classloaderReady: boolean;
  };
  readonly languageServer: {
    readonly state: string;
    readonly lastError?: string;
  };
  readonly pideDocument: {
    readonly bridge: string;
    readonly status: string;
  };
  readonly pideProofState: {
    readonly bridge: string;
    readonly status: string;
  };
  readonly buildExitCode: number;
  readonly preview?: {
    readonly sent: boolean;
    readonly received: boolean;
  };
  readonly sledgehammer?: {
    readonly status: string;
    readonly suggestions: readonly unknown[];
  };
}

suite("Tier-2 Isabelle smoke", function () {
  this.timeout(
    TIER2_SMOKE_ENABLED ? (TIER2_SMOKE_RUNS_SLEDGEHAMMER ? 30 : 15) * 60_000 : 60_000
  );

  test("runs deterministic real-Isabelle smoke checks when explicitly enabled", async function () {
    if (!TIER2_SMOKE_ENABLED) {
      this.skip();
    }

    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `Expected ${EXTENSION_ID} to be installed in the test host`);

    const isabelleExecutablePath = process.env.ISABELLE_VSCODE_ISABELLE?.trim() || "isabelle";
    const runSledgehammer = TIER2_SMOKE_RUNS_SLEDGEHAMMER;
    const backendTimeoutMs = runSledgehammer ? 20 * 60_000 : 5 * 60_000;
    const heapMb = readHeapMb();

    await configureSmokeHost(isabelleExecutablePath, backendTimeoutMs, heapMb);

    const api = await ext.activate();
    assert.ok(api, "Extension activation should return the public API object");

    const registered = new Set(await vscode.commands.getCommands(true));
    assert.ok(
      registered.has(TIER2_SMOKE_COMMAND_ID),
      `${TIER2_SMOKE_COMMAND_ID} should be registered when ISABELLE_VSCODE_TIER2_SMOKE=1`
    );

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? ext.extensionPath;
    const theoryPath = path.join(workspaceRoot, "examples", "Smoke.thy");
    const result = await vscode.commands.executeCommand<Tier2SmokeResult>(
      TIER2_SMOKE_COMMAND_ID,
      {
        theoryPath,
        sessionName: TIER2_SMOKE_SESSION,
        isabelleExecutablePath,
        runSledgehammer
      }
    );

    assert.ok(result, "Tier-2 smoke command should return a structured result");
    assert.strictEqual(result.sessionName, TIER2_SMOKE_SESSION);
    assert.ok(result.theoryUri.endsWith("/Smoke.thy") || result.theoryUri.endsWith("\\Smoke.thy"));
    assert.ok(result.discoveredSessionCount >= 1, "Smoke session discovery should find at least one session");
    assert.deepStrictEqual(
      result.phases.filter((phase) => !phase.ok),
      [],
      `Tier-2 smoke phases failed: ${JSON.stringify(result.phases, null, 2)}`
    );
    assert.strictEqual(result.backendHealth.isabelle.status, "ok");
    assert.strictEqual(result.pideBackend.bridge, "pide-enabled");
    assert.strictEqual(result.pideBackend.classloaderReady, true);
    assert.strictEqual(result.languageServer.state, "running", result.languageServer.lastError);
    assert.strictEqual(result.pideDocument.bridge, "pide-enabled");
    assert.ok(
      result.pideDocument.status === "pide-ok" || result.pideDocument.status === "pide-errors",
      `Unexpected PIDE document status: ${result.pideDocument.status}`
    );
    assert.strictEqual(result.pideProofState.bridge, "pide-enabled");
    assert.strictEqual(result.pideProofState.status, "ready");
    assert.strictEqual(result.buildExitCode, 0);
    assert.strictEqual(result.preview?.sent, true);
    assert.strictEqual(result.preview?.received, true);
    if (runSledgehammer) {
      assert.strictEqual(result.sledgehammer?.status, "completed");
      assert.ok(
        (result.sledgehammer?.suggestions.length ?? 0) > 0,
        "Sledgehammer smoke should return at least one proof suggestion"
      );
    }
  });
});

async function configureSmokeHost(
  isabelleExecutablePath: string,
  backendTimeoutMs: number,
  heapMb: number
): Promise<void> {
  const config = vscode.workspace.getConfiguration("isabelle");
  const target = vscode.ConfigurationTarget.Global;
  await config.update("executablePath", isabelleExecutablePath, target);
  await config.update("session.active", TIER2_SMOKE_SESSION, target);
  await config.update("languageServer.autoStart", false, target);
  await config.update("backend.requestTimeoutMs", backendTimeoutMs, target);
  await config.update("backend.maxHeapMb", heapMb, target);
  await config.update("build.extraArgs", ["-o", "quick_and_dirty"], target);
}

function readHeapMb(): number {
  const raw = process.env.ISABELLE_VSCODE_TIER2_HEAP_MB?.trim();
  if (!raw) {
    return 4096;
  }
  const parsed = Number(raw);
  assert.ok(
    Number.isInteger(parsed) && parsed >= 0,
    `ISABELLE_VSCODE_TIER2_HEAP_MB must be a non-negative integer, got: ${raw}`
  );
  return parsed;
}
