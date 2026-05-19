#!/usr/bin/env node
/**
 * Phase 1 license guard: asserts the backend fat jar does NOT bundle
 * any Isabelle-distributed classes (anything under the `isabelle/`
 * top-level package). The runtime PIDE classpath bridge loads those
 * classes reflectively from the user's local Isabelle install — they
 * MUST NOT ship inside our .vsix or backend fat jar.
 *
 * Uses `jar tf` (always available alongside the Java JDK that the
 * backend already requires) so this script stays cross-platform and
 * dependency-free.
 *
 * Exit codes:
 *   0 — fat jar is license-clean.
 *   1 — `jar` command failed (usually missing JDK on PATH).
 *   2 — fat jar contains forbidden `isabelle/` entries.
 */

const { spawnSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const path = require("node:path");

const jarPath =
  process.argv[2] ||
  path.join("backend", "dist", "isabelle-vscode-server.jar");

if (!existsSync(jarPath)) {
  console.error(`License guard: fat jar not found at ${jarPath}`);
  process.exit(1);
}

const result = spawnSync("jar", ["tf", jarPath], { encoding: "utf8" });
if (result.status !== 0) {
  console.error(
    "License guard: `jar tf` failed. Ensure a JDK is on PATH so the contents of the fat jar can be inspected."
  );
  if (result.stderr) {
    console.error(result.stderr.slice(0, 500));
  }
  process.exit(1);
}

const lines = result.stdout.split(/\r?\n/);
const offending = lines.filter((line) => /^isabelle\//.test(line));
if (offending.length > 0) {
  console.error(
    `License guard: fat jar contains ${offending.length} forbidden \`isabelle/\` entries:`
  );
  offending.slice(0, 10).forEach((line) => console.error(`  ${line}`));
  if (offending.length > 10) {
    console.error(`  ... and ${offending.length - 10} more.`);
  }
  console.error(
    "Phase 1 of the PIDE bridge requires Isabelle PIDE classes to be loaded from the user's local install at runtime; they must NEVER be bundled here."
  );
  process.exit(2);
}

const ourCount = lines.filter((line) => /^dev\/isabelle\//.test(line)).length;
console.log(
  `License guard: ${jarPath} contains 0 \`isabelle/\` entries (${ourCount} \`dev/isabelle/\` entries — our own code).`
);
