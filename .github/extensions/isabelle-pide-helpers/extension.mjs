// Repo-local Copilot CLI extension for the Isabelle PIDE VS Code extension.
//
// Discovered automatically by Copilot CLI from `.github/extensions/<name>/extension.mjs`.
// Registers two custom tools:
//
//   isabelle_lint_walkthrough — validates `media/walkthrough/*.md` cards
//     against `package.json` so dangling `command:` links and hard-coded
//     drift-prone counts get caught before they land in a PR.
//
//   isabelle_check_setup     — probes the local toolchain (Node, Java,
//     sbt, Isabelle, `code`/`code-insiders`) and reports which Tier of
//     changes are buildable on this machine.
//
// Both tools are pure ESM, vscode-free, side-effect-free, and never throw
// out of the handler — failures surface as a `"failure"` resultType so the
// agent can react instead of crashing the extension.
//
// See AGENTS.md "Test conventions" for the project's structural-test
// pattern; the helpers below intentionally don't have a sister test file
// because they live outside the main TS/vitest test surface — they are
// short, focused, and exercised by hand by the agent that uses them.

import { joinSession } from "@github/copilot-sdk/extension";
import { spawn } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(new URL("../../..", import.meta.url).pathname);
const WALKTHROUGH_DIR = join(REPO_ROOT, "media", "walkthrough");

async function lintWalkthrough() {
  const findings = [];

  // Load contributes.commands from package.json so we can verify
  // command: links resolve to real commands.
  let registeredCommands = new Set();
  try {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
    const commands = pkg?.contributes?.commands ?? [];
    registeredCommands = new Set(commands.map((c) => c.command));
  } catch (error) {
    findings.push({ file: "package.json", severity: "error", message: `Could not parse package.json: ${error.message}` });
  }

  let mdFiles = [];
  try {
    mdFiles = readdirSync(WALKTHROUGH_DIR).filter((f) => f.endsWith(".md"));
  } catch {
    return {
      ok: false,
      summary: `No walkthrough directory at ${WALKTHROUGH_DIR}`,
      findings
    };
  }

  for (const file of mdFiles) {
    const path = join(WALKTHROUGH_DIR, file);
    const text = readFileSync(path, "utf8");

    // command:foo.bar inside a markdown link target
    const commandLinkRe = /\]\(command:([\w.-]+)\)/g;
    for (const m of text.matchAll(commandLinkRe)) {
      const cmd = m[1];
      if (!registeredCommands.has(cmd)) {
        findings.push({
          file,
          severity: "error",
          message: `Walkthrough card references command \`${cmd}\` but package.json does not register it.`
        });
      }
    }

    // Hard-coded counts of commands / tests / steps that will drift.
    // Match common phrasings: "52 commands", "639 tests", "5 steps", etc.
    const driftRe = /(\d{2,})\s+(commands?|tests?|steps?|panels?|views?|extensions?)\b/gi;
    for (const m of text.matchAll(driftRe)) {
      const count = m[1];
      const noun = m[2];
      findings.push({
        file,
        severity: "warning",
        message: `Hard-coded "${count} ${noun}" will go stale on the next add/remove. Prefer "the full set", "a few", or compute dynamically.`
      });
    }

    // Dangling "Click X below" wording where no such control exists.
    if (/Click\s+\*\*Re-check\s+setup\*\*\s+below/i.test(text)) {
      findings.push({
        file,
        severity: "error",
        message: `Card references "Re-check setup" without a \`command:isabelle.checkPrerequisites\` link. Replace prose with a real command link.`
      });
    }
  }

  const errorCount = findings.filter((f) => f.severity === "error").length;
  const warningCount = findings.filter((f) => f.severity === "warning").length;

  return {
    ok: errorCount === 0,
    summary:
      findings.length === 0
        ? `Lint clean across ${mdFiles.length} walkthrough card${mdFiles.length === 1 ? "" : "s"}.`
        : `${mdFiles.length} card(s) scanned; ${errorCount} error(s), ${warningCount} warning(s).`,
    findings
  };
}

function runOnce(command, args, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let child;
    try {
      child = spawn(command, args, {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      });
    } catch (err) {
      resolve({ ok: false, reason: "spawn-failed", error: err.message });
      return;
    }
    let settled = false;
    const finalize = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* ignore */ }
      finalize({ ok: false, reason: "timeout" });
    }, timeoutMs);
    child.stdout?.on("data", (b) => { stdout += b.toString(); });
    child.stderr?.on("data", (b) => { stderr += b.toString(); });
    child.on("error", (err) => finalize({ ok: false, reason: "error", error: err.message }));
    child.on("close", (code) => {
      if (code === 0) {
        finalize({ ok: true, output: (stdout || stderr).trim().split(/\r?\n/, 1)[0] });
      } else {
        finalize({ ok: false, reason: "non-zero", exitCode: code, output: (stderr || stdout).trim().slice(0, 200) });
      }
    });
  });
}

async function checkSetup() {
  const probes = [
    { name: "node",          command: "node",           args: ["--version"] },
    { name: "npm",           command: "npm",            args: ["--version"] },
    { name: "java",          command: "java",           args: ["-version"] },
    { name: "sbt",           command: "sbt",            args: ["-version"], timeout: 10000 },
    { name: "isabelle",      command: "isabelle",       args: ["version"], timeout: 8000 },
    { name: "code",          command: "code",           args: ["--version"] },
    { name: "code-insiders", command: "code-insiders",  args: ["--version"] }
  ];

  const results = await Promise.all(
    probes.map(async (p) => ({
      name: p.name,
      ...(await runOnce(p.command, p.args, p.timeout ?? 5000))
    }))
  );

  const node = results.find((r) => r.name === "node");
  const npm = results.find((r) => r.name === "npm");
  const java = results.find((r) => r.name === "java");
  const sbt = results.find((r) => r.name === "sbt");
  const isabelle = results.find((r) => r.name === "isabelle");
  const code = results.find((r) => r.name === "code");
  const codeInsiders = results.find((r) => r.name === "code-insiders");

  const tier1 = node?.ok && npm?.ok;
  const tier2 = tier1 && java?.ok && sbt?.ok;
  const canInstallExtension = tier2 && (code?.ok || codeInsiders?.ok);
  const canExerciseIsabelle = isabelle?.ok;

  const lines = [];
  lines.push(`Node:          ${node?.ok ? "✓ " + node.output : "✗ missing"}`);
  lines.push(`npm:           ${npm?.ok ? "✓ " + npm.output : "✗ missing"}`);
  lines.push(`Java:          ${java?.ok ? "✓ " + java.output : "✗ missing"}`);
  lines.push(`sbt:           ${sbt?.ok ? "✓ " + sbt.output : "✗ missing"}`);
  lines.push(`Isabelle:      ${isabelle?.ok ? "✓ " + isabelle.output : "✗ missing"}`);
  lines.push(`code (CLI):    ${code?.ok ? "✓ " + code.output.split("\n")[0] : "✗ missing"}`);
  lines.push(`code-insiders: ${codeInsiders?.ok ? "✓ " + codeInsiders.output.split("\n")[0] : "✗ missing"}`);
  lines.push("");
  lines.push(`Tier 1 (TypeScript-only changes):       ${tier1 ? "ready" : "BLOCKED — install Node + npm"}`);
  lines.push(`Tier 2 (backend / packaging changes):   ${tier2 ? "ready" : "BLOCKED — install Java 21+ and sbt"}`);
  lines.push(`Can run npm run install:extension:      ${canInstallExtension ? "ready" : "BLOCKED — install code/code-insiders CLI"}`);
  lines.push(`Can exercise Isabelle features:         ${canExerciseIsabelle ? "ready" : "BLOCKED — install Isabelle 2019+"}`);

  return {
    ok: tier1, // Tier 1 is the bare minimum to do useful work
    summary: lines.join("\n"),
    detail: { tier1, tier2, canInstallExtension, canExerciseIsabelle, results }
  };
}

function formatResult(payload) {
  // Stringify into a stable, agent-friendly textual form.
  return JSON.stringify(payload, null, 2);
}

await joinSession({
  tools: [
    {
      name: "isabelle_lint_walkthrough",
      description:
        "Lint media/walkthrough/*.md against package.json. Catches dangling command: links (referenced commands not registered in contributes.commands) and hard-coded counts that drift on every add/remove (the '52 commands' trap from PR #60). Use before opening a PR that touches walkthrough markdown or contributed commands. No arguments.",
      parameters: { type: "object", properties: {} },
      handler: async () => {
        try {
          const result = await lintWalkthrough();
          return {
            textResultForLlm: formatResult(result),
            resultType: result.ok ? "success" : "failure"
          };
        } catch (err) {
          return {
            textResultForLlm: `lint failed: ${err?.message ?? String(err)}`,
            resultType: "failure"
          };
        }
      }
    },
    {
      name: "isabelle_check_setup",
      description:
        "Probe the local toolchain (Node, npm, Java 21+, sbt, Isabelle 2019+, code / code-insiders CLI) and report which Tier of changes are buildable on this machine. Use at session start when you're not sure whether the backend or extension install scripts will work locally. No arguments.",
      parameters: { type: "object", properties: {} },
      handler: async () => {
        try {
          const result = await checkSetup();
          return {
            textResultForLlm: formatResult(result),
            resultType: result.ok ? "success" : "failure"
          };
        } catch (err) {
          return {
            textResultForLlm: `setup probe failed: ${err?.message ?? String(err)}`,
            resultType: "failure"
          };
        }
      }
    }
  ]
});
