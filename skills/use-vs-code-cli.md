---
name: use-vs-code-cli
description: Find and use the VS Code or Code Insiders CLI for hosted tests and VSIX install smokes.
when-to-use: When a task needs `npm run test:integration`, `npm run install:extension`, or a local VSIX install smoke and the `code` command is missing or unreliable.
---

# Use the VS Code CLI

This repo has two different VS Code-related validation paths:

1. `npm run test:integration` uses `@vscode/test-electron` and downloads the pinned VS Code test build (`1.90.0`) into `.vscode-test/`. It does **not** require the stable `code` command to be on `PATH`, but it does need a graphical desktop on Windows/macOS or `xvfb-run` on headless Linux.
2. Local install smokes need a user-installed VS Code CLI: either stable `code` or Insiders `code-insiders`.

Use this skill before installing VS Code manually. Many developer machines already have Code Insiders installed even when `code` is not on `PATH`.

## 1. Find an existing CLI

On Windows:

```powershell
$codeCli = @(
  "$env:LOCALAPPDATA\Programs\Microsoft VS Code\bin\code.cmd",
  "$env:ProgramFiles\Microsoft VS Code\bin\code.cmd",
  "${env:ProgramFiles(x86)}\Microsoft VS Code\bin\code.cmd",
  "$env:LOCALAPPDATA\Programs\Microsoft VS Code Insiders\bin\code-insiders.cmd",
  "$env:ProgramFiles\Microsoft VS Code Insiders\bin\code-insiders.cmd"
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

if (-not $codeCli) {
  throw "No VS Code CLI found. Install VS Code stable or Insiders, then retry."
}

& $codeCli --version
```

On macOS / Linux, prefer `command -v code`, then `command -v code-insiders`.

## 2. Run the hosted integration suite

```powershell
npm run test:integration
```

Expected result: the test harness downloads / reuses the pinned VS Code build, activates the extension in an isolated extension host, and reports the hosted Mocha tests passing.

Windows cleanup warning: if the suite exits `0` but prints an `EPERM` cleanup warning for a temp `isabelle-vscode-integration-*` directory, treat the test as passed. The cleanup is best-effort and intentionally does not mask the real test status.

## 3. Install-smoke a generated VSIX

Use this when `npm run install:extension` would fail because it hard-codes `code`, but Code Insiders is available.

```powershell
$vsix = "isabelle-pide-vscode.install-smoke.vsix"
npx vsce package --no-dependencies --out $vsix
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& $codeCli --install-extension $vsix --force
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& $codeCli --list-extensions | Select-String -SimpleMatch "arthur742ramos.isabelle-pide-vscode"
$listed = $?

Remove-Item -Path $vsix -Force -ErrorAction SilentlyContinue
if (-not $listed) { exit 1 }
```

Expected result: the generated VSIX installs successfully and `arthur742ramos.isabelle-pide-vscode` appears in the extension list.

## 4. What this does not prove

The Code CLI install smoke and hosted integration suite do **not** replace `docs/SMOKE_THEORY_CHECKLIST.md`. They prove packaging, activation, and command registration; the Smoke checklist still owns live Isabelle UI behavior such as LSP diagnostics, proof state rendering, Sledgehammer output / insertion, theory preview, and Headless `PideBridge` commands.

## 5. When no CLI exists

If neither stable nor Insiders is installed and the task explicitly requires an install smoke, install VS Code stable using the platform's normal installer. On Windows with `winget` available:

```powershell
winget install --id Microsoft.VisualStudioCode --source winget --scope user
```

After install, reopen the shell or call the full `code.cmd` path directly. Do not edit package scripts just to point at a local editor path.
