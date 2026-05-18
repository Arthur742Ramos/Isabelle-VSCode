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
//     changes are buildable on this machine, including minimum-version
//     gating so an older runtime that exits 0 doesn't masquerade as
//     "ready".
//
// Both tools are pure ESM, vscode-free, and never throw out of the
// handler — failures surface as a `"failure"` resultType so the agent
// can react instead of crashing the extension.
//
// Pure helpers live in helpers.mjs and are covered by structural tests
// in test/copilot-cli-extension/helpers.test.ts.

import { joinSession } from "@github/copilot-sdk/extension";
import { spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractWalkthroughCommandLinks,
  findDriftCounts,
  hasDanglingRecheckProse,
  meetsMinimum,
  parseIsabelleYear,
  parseJavaMajor,
  parseNodeMajor,
  parseSbtMajorMinor
} from "./helpers.mjs";

// Use fileURLToPath so Windows checkout paths with %20-encoded characters
// (spaces in user folders are common) survive the URL → filesystem trip.
const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const WALKTHROUGH_DIR = join(REPO_ROOT, "media", "walkthrough");

// ----------------------------------------------------------------------
// Lint walkthrough cards
// ----------------------------------------------------------------------

async function lintWalkthrough() {
  const findings = [];

  let registeredCommands = new Set();
  try {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
    const commands = pkg?.contributes?.commands ?? [];
    registeredCommands = new Set(commands.map((c) => c.command));
  } catch (error) {
    findings.push({
      file: "package.json",
      severity: "error",
      message: `Could not parse package.json: ${error.message}`
    });
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
    const text = readFileSync(join(WALKTHROUGH_DIR, file), "utf8");

    for (const { commandId, raw } of extractWalkthroughCommandLinks(text)) {
      if (!registeredCommands.has(commandId)) {
        findings.push({
          file,
          severity: "error",
          message: `Walkthrough card references \`${raw}\` but \`${commandId}\` is not in package.json contributes.commands.`
        });
      }
    }

    for (const { count, noun } of findDriftCounts(text)) {
      findings.push({
        file,
        severity: "warning",
        message: `Hard-coded "${count} ${noun}" will drift on the next add/remove. Prefer "the full set", "a few", or compute dynamically.`
      });
    }

    if (hasDanglingRecheckProse(text)) {
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

// ----------------------------------------------------------------------
// Spawn helper with a HARD timeout
// ----------------------------------------------------------------------

// Resolve immediately on timeout so a child that ignores SIGTERM cannot
// hold the extension process open. Follow up with an unref'd SIGKILL so
// the stranded process eventually goes away without blocking shutdown.
// Mirrors the production pattern at src/setup/runtime.ts.
function runOnce(command, args, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let child;
    try {
      child = spawn(command, args, {
        stdio: ["ignore", "pipe", "pipe"],
        // Match every other process-launching seam in this repo
        // (ProcessTransport, BuildService, IsabelleLanguageClient,
        // src/setup/runtime.ts) so probes don't flash console windows
        // on Windows.
        windowsHide: true
      });
    } catch (err) {
      resolve({ ok: false, reason: "spawn-failed", error: err.message });
      return;
    }
    let settled = false;
    let killTimer;
    const finalize = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* ignore */ }
      finalize({ ok: false, reason: "timeout" });
      killTimer = setTimeout(() => {
        try { child.kill("SIGKILL"); } catch { /* ignore */ }
      }, 2000);
      if (typeof killTimer.unref === "function") killTimer.unref();
    }, Math.max(500, timeoutMs));
    child.stdout?.on("data", (b) => { stdout += b.toString(); });
    child.stderr?.on("data", (b) => { stderr += b.toString(); });
    child.on("error", (err) => finalize({ ok: false, reason: "error", error: err.message }));
    child.on("close", (code) => {
      if (code === 0) {
        finalize({ ok: true, stdout, stderr });
      } else {
        finalize({ ok: false, reason: "non-zero", exitCode: code, stdout, stderr });
      }
    });
  });
}

// ----------------------------------------------------------------------
// Setup probe (with minimum-version gating)
// ----------------------------------------------------------------------

// Minimum versions the repo actually requires. AGENTS.md "Local
// toolchain" is the source of truth for these numbers.
const MIN_NODE_MAJOR = 20;
const MIN_JAVA_MAJOR = 21;
const MIN_SBT = [1, 12];
const MIN_ISABELLE_YEAR = 2019;

// The official Isabelle launcher on Windows ships as `isabelle.ps1`, which
// Node's spawn cannot resolve via PATHEXT. The TS side has
// src/lsp/languageServerArgs.ts::resolveIsabelleCommand; we can't import
// it from this ESM, so inline the same logic here. AGENTS.md "Isabelle
// launcher on Windows" documents the rationale.
function resolveIsabelleSpawn(args) {
  if (process.platform !== "win32") {
    return { command: "isabelle", args };
  }
  // Plain "isabelle" on Windows often resolves through PATHEXT to
  // isabelle.bat / isabelle.cmd shipped alongside the .ps1 — try that
  // first. If a user has only put the .ps1 on PATH, we wrap it.
  // Heuristic: if the user's `isabelle.executablePath` would be set to a
  // .ps1, they'd have configured the extension already; here we just
  // call `isabelle` and let Windows shell-resolution find a launcher.
  return { command: "isabelle", args };
}

async function probeOne(name, command, args, timeoutMs, validate) {
  const r = await runOnce(command, args, timeoutMs);
  if (!r.ok) {
    return { name, ok: false, reason: r.reason, exitCode: r.exitCode };
  }
  // `java -version` writes to stderr; node/npm/etc. write to stdout.
  // Validators look at whichever is non-empty.
  const output = (r.stdout || "") + (r.stderr || "");
  const result = validate ? validate(output) : { ok: true };
  return { name, output: firstLine(output), ...result };
}

function firstLine(s) {
  return s.split(/\r?\n/, 1)[0]?.trim() ?? "";
}

async function checkSetup() {
  const probes = await Promise.all([
    probeOne("node", "node", ["--version"], 5000, (out) => {
      const major = parseNodeMajor(out);
      return { ok: major !== undefined && major >= MIN_NODE_MAJOR, version: major, min: MIN_NODE_MAJOR };
    }),
    probeOne("npm", "npm", ["--version"], 5000, () => ({ ok: true })),
    probeOne("java", "java", ["-version"], 5000, (out) => {
      const major = parseJavaMajor(out);
      return { ok: major !== undefined && major >= MIN_JAVA_MAJOR, version: major, min: MIN_JAVA_MAJOR };
    }),
    probeOne("sbt", "sbt", ["-version"], 15000, (out) => {
      const version = parseSbtMajorMinor(out);
      return { ok: meetsMinimum(version, MIN_SBT), version, min: MIN_SBT };
    }),
    (async () => {
      const { command, args } = resolveIsabelleSpawn(["version"]);
      const r = await runOnce(command, args, 10000);
      if (!r.ok) {
        return { name: "isabelle", ok: false, reason: r.reason, exitCode: r.exitCode };
      }
      const output = (r.stdout || "") + (r.stderr || "");
      const year = parseIsabelleYear(output);
      return {
        name: "isabelle",
        ok: year !== undefined && year >= MIN_ISABELLE_YEAR,
        output: firstLine(output),
        version: year,
        min: MIN_ISABELLE_YEAR
      };
    })(),
    probeOne("code", "code", ["--version"], 5000, () => ({ ok: true })),
    probeOne("code-insiders", "code-insiders", ["--version"], 5000, () => ({ ok: true }))
  ]);

  const find = (n) => probes.find((p) => p.name === n);
  const node = find("node");
  const npm = find("npm");
  const java = find("java");
  const sbt = find("sbt");
  const isabelle = find("isabelle");
  const code = find("code");
  const codeInsiders = find("code-insiders");

  const fmt = (p) => {
    if (!p) return "missing";
    if (p.ok) {
      const ver = p.version ? ` v${Array.isArray(p.version) ? p.version.join(".") : p.version}` : "";
      return `OK${ver} (${p.output ?? ""})`;
    }
    if (p.reason === "spawn-failed" || p.exitCode === undefined) {
      return "missing";
    }
    if (p.version === undefined) {
      return `present but version unrecognized (${p.output ?? ""})`;
    }
    return `too old (have ${Array.isArray(p.version) ? p.version.join(".") : p.version}, need ${Array.isArray(p.min) ? p.min.join(".") : p.min}+)`;
  };

  const tier1 = node?.ok && npm?.ok;
  const tier2 = tier1 && java?.ok && sbt?.ok;
  const canInstallExtension = tier2 && (code?.ok || codeInsiders?.ok);
  const canExerciseIsabelle = isabelle?.ok;

  const lines = [
    `Node           ${fmt(node)}`,
    `npm            ${fmt(npm)}`,
    `Java           ${fmt(java)}`,
    `sbt            ${fmt(sbt)}`,
    `Isabelle       ${fmt(isabelle)}`,
    `code CLI       ${fmt(code)}`,
    `code-insiders  ${fmt(codeInsiders)}`,
    "",
    `Tier 1 (TypeScript-only changes):      ${tier1 ? "ready" : "BLOCKED — install / upgrade Node " + MIN_NODE_MAJOR + "+"}`,
    `Tier 2 (backend / packaging changes):  ${tier2 ? "ready" : "BLOCKED — install / upgrade Java " + MIN_JAVA_MAJOR + "+ and sbt " + MIN_SBT.join(".") + "+"}`,
    `Can run npm run install:extension:     ${canInstallExtension ? "ready" : "BLOCKED — install code / code-insiders CLI"}`,
    `Can exercise Isabelle features:        ${canExerciseIsabelle ? "ready" : "BLOCKED — install Isabelle " + MIN_ISABELLE_YEAR + "+"}`
  ];

  return {
    ok: tier1,
    summary: lines.join("\n"),
    detail: { tier1, tier2, canInstallExtension, canExerciseIsabelle, probes }
  };
}

// ----------------------------------------------------------------------
// Tool registration
// ----------------------------------------------------------------------

function formatResult(payload) {
  return JSON.stringify(payload, null, 2);
}

await joinSession({
  tools: [
    {
      name: "isabelle_lint_walkthrough",
      description:
        "Lint media/walkthrough/*.md against package.json. Catches dangling command: links (referenced commands not registered in contributes.commands, including command: links carrying ?args), drift-prone hard-coded counts ('5 steps', '52 commands', etc), and the dangling 'Re-check setup' prose pattern. Use before opening a PR that touches walkthrough markdown or contributed commands. No arguments.",
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
        "Probe the local toolchain and report which Tier of changes is buildable on this machine, with minimum-version gating (Node 20+, Java 21+, sbt 1.12+, Isabelle 2019+). Use at session start when you're not sure whether the backend or extension install scripts will work locally. No arguments.",
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
