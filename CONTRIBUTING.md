# Contributing to Isabelle PIDE for VS Code

Thank you for thinking about contributing! This file is the **human onboarding** guide. AI coding agents should also read [`AGENTS.md`](AGENTS.md), which goes much deeper into conventions, architecture, and gotchas.

## Quick start

```powershell
git clone https://github.com/Arthur742Ramos/Isabelle-VSCode.git
cd Isabelle-VSCode
npm install
npm run check     # compile + 749 vitest cases (~3 s on a warm cache)
```

If `npm run check` is green, you're set up for **any TypeScript-only change**. For backend (Scala) or full-build work, see "Tier 2 toolchain" below.

## How to contribute

1. **Find or open an issue.** For non-trivial changes, please discuss the approach in an issue first.
2. **Branch** off `main` with a kebab-case name: `<handle>/<short-description>`, e.g. `arthur742ramos/fix-build-cancel`.
3. **Make the change.** Keep the diff focused — one logical change per PR.
4. **Test it.**
   - TypeScript changes: `npm run check`.
   - Backend changes: `npm run backend:test` (needs Java + sbt).
   - Packaging changes: `npm run package`.
5. **Commit** using Conventional Commits — `feat(scope):`, `fix(scope):`, `ci:`, `docs(scope):`. Look at recent `git log` for the established scopes (`setup`, `build`, `roadmap-status`, etc).
6. **Open a PR.** Use the PR template — it asks for a one-line What/Why, your test evidence, and explicit Out-of-scope notes.

## Toolchain

### Tier 1 — TypeScript-only changes (always required)

| Tool | Version |
|---|---|
| Node.js | 20 or 24 |

That's it. Most contributions only need this.

### Tier 2 — Backend / packaging / install (optional)

| Tool | Version | Used for |
|---|---|---|
| Java JDK | 21+ | `sbt assembly` + runtime |
| sbt | 1.12+ | `npm run backend:*` |
| `code` / `code-insiders` CLI on PATH | any recent | `npm run install:extension` |
| Isabelle | 2019+ | Only to **exercise** features — not to build them |

OS-by-OS install commands for Java and Isabelle are in the [README install matrix](README.md#installation).

## Useful npm scripts

```powershell
npm run check               # compile + vitest (the CI gate)
npm run watch               # tsc -watch for fast iteration
npm run bundle              # esbuild -> out/extension.js
npm run package             # produce isabelle-pide-vscode.vsix
npm run install:extension   # package + code --install-extension --force
npm run backend:compile     # sbt compile (Tier 2)
npm run backend:test        # sbt test    (Tier 2)
```

## Test conventions

All 66 test files under `test/**` are **structural** — they avoid importing `vscode` and exercise pure modules with injected fakes (for `fs`, `child_process.spawn`, VS Code UI surfaces, …). The cleanest current examples are under `src/setup/` + `test/setup/`. New tests should follow this pattern.

Add VS Code-hosted integration tests only when behavior cannot be tested structurally.

## What reviewers look for

- **Focused diff.** One logical change.
- **Tests for the new behavior.** If you fixed a bug, add a test that fails before your fix.
- **No regressions.** `npm run check` must be green.
- **Conventional commit + Copilot trailer** when an AI co-authored the work:
  ```
  Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
  ```
- **Out-of-scope notes.** If you found something else broken, call it out in the PR body so it's not silently inherited.

## Reporting bugs

Use the **Bug report** issue template. It asks for OS, VS Code version, extension version, Isabelle version + path, Java version, repro steps, and logs.

## Suggesting features

Use the **Feature request** issue template. Keep it focused — describe the user-visible behavior and why it matters before sketching an implementation.

## Code of conduct

Be kind. Assume good faith. If you disagree with someone's PR, explain why on the merits.

## More

- [`AGENTS.md`](AGENTS.md) — full agent / contributor deep dive (architecture, conventions, validation matrix, gotchas).
- [`skills/`](skills/) — cross-agent workflow playbooks (release, adding commands, addressing review comments).
- [`docs/ROADMAP_STATUS.md`](docs/ROADMAP_STATUS.md) — what's shipped, what's roadmapped, what's upstream-blocked.
- [`docs/PIDE_INTEGRATION.md`](docs/PIDE_INTEGRATION.md) — how the LSP relay and Scala backend fit together.
- [`docs/AI_REPAIR.md`](docs/AI_REPAIR.md) — checked-repair safety contract for AI provider integrations.
