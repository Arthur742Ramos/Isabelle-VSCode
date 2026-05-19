import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";

// Seed integration test #2: drift detector. After activation, every command
// declared in package.json `contributes.commands` whose id starts with
// `isabelle.` MUST be registered by src/extension.ts. This catches the
// "declared but never registered" regression that no structural test can
// see — and the "registered but no longer declared" regression too if we
// ever surface it from the other direction.
//
// The expected set is computed dynamically from the installed extension's
// package.json so this test never bit-rots like the "52 commands" trap in
// media/walkthrough/open-theory.md (see AGENTS.md gotcha #7). Internal-only
// commands such as `isabelle.revealCommandSpan` are intentionally not in
// `contributes.commands`; they remain registered as plumbing and the test
// is one-directional so extra registered commands are fine.

const EXTENSION_ID = "arthur742ramos.isabelle-pide-vscode";

interface PackageJsonContributes {
  contributes?: {
    commands?: Array<{ command: string }>;
  };
}

suite("Command registration", () => {
  test("every contributed Isabelle command is registered after activation", async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `Expected ${EXTENSION_ID} to be installed in the test host`);

    await ext.activate();

    // Use the runtime extensionPath rather than __dirname so the test reads
    // the package.json that VS Code actually loaded the extension from.
    const pkg = require(path.join(ext.extensionPath, "package.json")) as PackageJsonContributes;
    const declared = (pkg.contributes?.commands ?? [])
      .map((entry) => entry.command)
      .filter((id) => typeof id === "string" && id.startsWith("isabelle."));

    assert.ok(
      declared.length > 0,
      "package.json must contribute at least one isabelle.* command"
    );

    const registered = new Set(await vscode.commands.getCommands(true));
    const missing = declared.filter((cmd) => !registered.has(cmd));

    assert.deepStrictEqual(
      missing,
      [],
      `These commands are declared in package.json contributes.commands but are not registered after activation: ${missing.join(", ")}`
    );
  });
});
