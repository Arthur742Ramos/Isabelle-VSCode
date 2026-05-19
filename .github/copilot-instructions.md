# GitHub Copilot instructions

This file is read by GitHub Copilot (Chat, Coding Agent, code completion). It's intentionally short — see [`AGENTS.md`](../AGENTS.md) at the repo root for the full guide.

## Repo summary

VS Code extension for Isabelle/PIDE. TypeScript front-end (`src/`, `test/`) bundled with esbuild; Scala 3.3.4 backend (`backend/`) packaged as a fat jar via `sbt assembly`. Activation point is `src/extension.ts::activate`. Scala version is pinned to match Isabelle 2025-2's bundled PIDE (AGENTS.md §11).

## Must-run commands

| Goal | Command |
|---|---|
| TS-only change | `npm run check` (compile + vitest, ~3 s) |
| Touch `activate()` or a contributed command | also `npm run test:integration` (hosted activation + drift detector) |
| Bundle for packaging | `npm run bundle` |
| Backend change | `npm run backend:test` (needs Java 21 + sbt) |
| Build a `.vsix` end-to-end | `npm run package` |
| Install into local VS Code | `npm run install:extension` |

CI runs two parallel jobs: `validate` (`npm run check` + `npm audit --audit-level=moderate` + `npm run backend:compile`) and `integration-tests` (`xvfb-run npm run test:integration` on ubuntu-latest).

## Key conventions

- **TS strict mode**. No `any` without justification; no `// @ts-ignore` without comment.
- **Tests are vscode-free**: every test file under `test/**` (excluding `test/integration/**`) avoids importing `vscode`. Put pure logic in modules with injected dependencies and test those. See `src/setup/` for the cleanest current examples (pure module + `runtime.ts` for production wiring + `test/setup/*.test.ts` for vitest cases). A small VS Code-hosted Mocha suite lives under `test/integration/` and is opt-in via `npm run test:integration` — see `AGENTS.md` for when to extend it.
- **Spawned subprocesses use `windowsHide: true`**. Matches `ProcessTransport`, `BuildService`, `IsabelleLanguageClient`, `setup/runtime.ts`.
- **Isabelle CLI invocations on Windows** must go through `src/lsp/languageServerArgs.ts::resolveIsabelleCommand` — Node's `spawn` does not resolve `.ps1` via PATHEXT, so the helper wraps with `powershell.exe -File`.
- **Commit messages**: Conventional Commits with a Copilot trailer when an agent is co-authoring:
  ```
  feat(setup): add prerequisite checker

  Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
  ```
- **PR scope**: keep PRs focused. One logical change per PR. Use the PR template.

## Known gotchas

- **Workflow-scope OAuth**: pushes that touch `.github/workflows/*.yml` need the `workflow` OAuth scope. If your push is rejected, run `gh auth refresh -h github.com -s workflow` (or, in Copilot CLI, clear `GH_TOKEN` so git falls back to the keyring credential). See `AGENTS.md` for the full table.
- **Fat-jar required**: `sbt package` produces a thin jar that won't run via `java -jar`. Always use `sbt assembly` — the `backend:package` script already does.
- **`.vscodeignore` excludes `node_modules`** on purpose: the bundle is the shipping artifact, and `vsce package --no-dependencies` matches. Don't add `node_modules` back.

See `AGENTS.md` for the full agent guide, architecture map, validation matrix, secrets/local-path policy, and contributor checklist. See `skills/` for per-workflow playbooks (release, adding commands, addressing review comments) that any agent can read on demand.
