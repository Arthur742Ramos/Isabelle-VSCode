#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const examplesDir = path.resolve(__dirname, "..", "examples");
const baseArgs = ["build", "-o", "quick_and_dirty", "-D", examplesDir];
const { command, args } = resolveIsabelleCommand(baseArgs);

const result = spawnSync(command, args, {
  stdio: "inherit",
  windowsHide: true
});

if (result.error) {
  console.error(`Unable to run Isabelle CLI smoke check: ${result.error.message}`);
  process.exit(1);
}

process.exit(typeof result.status === "number" ? result.status : 1);

function resolveIsabelleCommand(args) {
  if (process.platform !== "win32") {
    return { command: "isabelle", args };
  }

  const launcher = findWindowsIsabelleLauncher();
  if (!launcher) {
    return { command: "isabelle", args };
  }

  if (/\.(ps1|psm1)$/i.test(launcher)) {
    return {
      command: "powershell.exe",
      args: [
        "-NoLogo",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        launcher,
        ...args
      ]
    };
  }

  return { command: launcher, args };
}

function findWindowsIsabelleLauncher() {
  const rawPath = process.env.PATH;
  if (!rawPath) return undefined;

  for (const directory of rawPath.split(path.delimiter)) {
    const trimmed = directory.trim();
    if (!trimmed) continue;
    for (const extension of [".ps1", ".psm1", ".cmd", ".exe", ".bat"]) {
      const candidate = path.join(trimmed, `isabelle${extension}`);
      if (isFile(candidate)) return candidate;
    }
  }
  return undefined;
}

function isFile(candidate) {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

