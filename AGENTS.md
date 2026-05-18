# AGENTS.md

This file is the **canonical guide for AI coding agents** (Copilot CLI, GitHub Copilot Coding Agent, Claude Code, Cursor, Aider, codex, etc) and humans onboarding to this repository. It documents what the project is, how it's built, the conventions you must follow, and the gotchas that have bitten previous contributors.

If you change something in this repo, read this file first. Updating it when you discover a new convention or trap is part of the deal.

## TL;DR for an agent

```text
1. Run `npm install` once (Tier-1 toolchain).
2. Run `npm run check` to compile + run the 639-test vitest suite.
3. Branch from origin/main with a kebab-case name.
4. Commit messages use Conventional Commits + a Copilot Co-authored-by trailer.
5. Open a focused PR. Use the PR template.
6. If you touch .github/workflows/*, see "Workflow-scope OAuth gotcha" below.
```

---

## What this repo is

A Visual Studio Code extension for [Isabelle/PIDE](https://isabelle.in.tum.de/). Two halves:

| Half | Language | What it does |
|---|---|---|
| **VS Code extension** (`src/`, `test/`) | TypeScript (strict, ES2020, CommonJS) | Activation, command palette, panels, decorations, semantic tokens, LSP relay client. Bundled with esbuild into a single `out/extension.js`. |
| **Scala backend** (`backend/`) | Scala 2.13 | JSON-RPC server that fronts Isabelle CLI invocations, parses ROOT/ROOTS, exposes a `PideBridge` seam for future real PIDE integration. Built as a fat jar via `sbt assembly` and bundled in the `.vsix`. |

The VS Code extension launches the backend with `java -jar backend/dist/isabelle-vscode-server.jar`. The backend in turn shells out to whatever `isabelle` executable the user has on `PATH` (or in the `isabelle.executablePath` setting).

A second, **optional**, runtime mode (`isabelle.languageServer.enabled: true`) spawns Isabelle's bundled `isabelle vscode_server` as an LSP child so the extension can relay PIDE-flavoured features (decorations, real proof state, sledgehammer, theory preview, …) without writing them in the Scala backend yet.

See `docs/ROADMAP_STATUS.md` for the milestone roll-up and `docs/PIDE_INTEGRATION.md` for the LSP-relay architecture.

---

## Local toolchain

Split by tier so contributors don't install more than they need:

### Tier 1 — Always required (TypeScript-only changes)

| Tool | Version | Used for |
|---|---|---|
| **Node.js** | 20 or 24 | All npm scripts (compile, test, bundle, package). |
| **npm** | bundled with Node | Dependency install. |

After `git clone`, run `npm install` once. You're ready to edit anything in `src/` or `test/` and run `npm run check`.

### Tier 2 — Backend changes / packaging / install

| Tool | Version | Why |
|---|---|---|
| **Java JDK** | 21+ | `sbt assembly` needs it; the bundled backend jar needs it at runtime. Microsoft OpenJDK, Adoptium Temurin, Oracle — any vendor. |
| **sbt** | 1.12+ | `npm run backend:*` scripts. |
| **VS Code CLI** | `code` or `code-insiders` on PATH | `npm run install:extension` installs the freshly-built `.vsix` into your local VS Code. Set up via *Shell Command: Install 'code' command in PATH* from the Command Palette. |
| **Isabelle** | 2019+ | Only needed to **exercise** features that talk to Isabelle (build, language server, sledgehammer). The extension itself activates and most local features work without it. |

If you don't have Tier 2 installed, you can still do meaningful work — see the validation matrix below.

---

## Command cheatsheet

```powershell
# Tier 1 (Node-only)
npm install               # Once, after clone
npm run compile           # tsc -> out/*.js (development emit, not the bundle)
npm run watch             # tsc -watch
npm run test              # vitest run (639 cases, ~2 s)
npm run check             # compile + test (CI uses this)
npm run bundle            # esbuild -> single out/extension.js for packaging

# Tier 2 (needs Java + sbt)
npm run backend:compile   # sbt compile
npm run backend:test      # sbt test
npm run backend:package   # sbt assembly -> backend/dist/isabelle-vscode-server.jar (fat jar)
npm run backend:run       # sbt run (for dev with isabelle.backend.command = sbt)

# Packaging + install (needs Tier 2 + code CLI)
npm run package           # check + backend:package + vsce package -> isabelle-pide-vscode.vsix
npm run install:extension # package + code --install-extension --force
npm run package:validate  # CI integrity check — builds the .vsix and verifies contents, deletes after
```

---

## Validation matrix — what to run for what change

| If you change… | You must run… | And probably… |
|---|---|---|
| `src/**` (TypeScript) | `npm run check` | `npm run bundle` to confirm the bundle is clean |
| `test/**` | `npm run check` | — |
| `package.json` (scripts, contributes, deps) | `npm run check` + `npm run bundle` | `npm run package` if `vsce` packaging surface affected |
| `backend/**` (Scala) | `npm run backend:test` + `npm run backend:compile` | Re-bundle so the new fat jar is included |
| `.github/workflows/release.yml` | nothing locally — push and observe via Actions | Also validate YAML with `node -e "require('yaml').parse(...)"` |
| `.github/workflows/copilot-setup-steps.yml` | same as above | Workflow only takes effect once merged to default branch |
| `README.md`, `docs/**`, `media/walkthrough/**` | nothing — they're not linted | Skim-check rendered markdown |
| `.vscodeignore` | `npm run package:validate` | Verifies the `.vsix` still contains the right files |

CI (`.github/workflows/ci.yml`) runs `npm run check`, `npm audit --audit-level=moderate`, and `npm run backend:compile` on every PR. You should reproduce these locally for anything non-trivial.

---

## Repository conventions

### TypeScript

- Strict mode is on (`tsconfig.json`). No `any` slip-ins, no `// @ts-ignore` without a comment explaining why.
- `vscode` API is **only** imported from `src/extension.ts` and a small set of UI-thin modules. Everything testable should live in a `vscode`-free module (see "Test conventions" below).
- esbuild bundles `src/extension.ts` to a single `out/extension.js` with `external: vscode`. Don't add `node_modules/**` paths to `.vscodeignore` — they're meant to be excluded; the bundle is the shipping artifact.

### Test conventions — **structural / vscode-free**

**Verified universal:** all 62 test files (`test/**/*.test.ts`) avoid importing `vscode` directly. They exercise pure modules with injected fakes for `fs`, `child_process.spawn`, `vscode` UI surfaces, etc.

When you add a new module:

1. Put pure logic in a module that does not import `vscode` / `child_process` / `fs`.
2. Inject dependencies via interfaces (see `src/setup/PrerequisiteChecker.ts` and `src/setup/isabelleAutoDetect.ts` for the cleanest current examples).
3. Wire the production implementation in a sibling file (see `src/setup/runtime.ts`).
4. Test the pure module with vitest + node-only fakes.

Why: there is no VS Code test harness in this repo. A test that imports `vscode` cannot run under vitest at all. The `vscode-languageclient` package transitively imports `vscode` and is the reason `src/lsp/IsabelleLanguageClient.ts` and a few other files are not directly unit-tested — they're covered structurally via injectable seams in `lspNotificationRegistry.ts` and friends.

Prefer vscode-free unit/structural tests with injected fakes. Add VS Code-hosted integration tests only when the behavior cannot be tested structurally.

### Process spawning

**Use `windowsHide: true` for every `child_process.spawn` that launches an extension subprocess.** Established by `ProcessTransport.ts`, `BuildService.ts`, `IsabelleLanguageClient.ts`, and (since PR #61) `setup/runtime.ts`. Without it, activation-time probes briefly flash console windows on Windows.

### Isabelle launcher on Windows

The official Isabelle Windows distribution ships its launcher as `isabelle.ps1`. Node's `child_process.spawn(path)` does **not** resolve `.ps1` extensions via PATHEXT. **Always route Isabelle CLI invocations through `src/lsp/languageServerArgs.ts::resolveIsabelleCommand`**, which wraps `.ps1` paths with `powershell.exe -File`. Don't reinvent that handling.

### Commit messages

Conventional Commits + a Copilot trailer when an agent is co-authoring:

```
feat(setup): add prerequisite checker
fix(build): close the spawned process on cancel
ci: add Release workflow that publishes .vsix on v* tags
docs(roadmap-status): consolidate PRs 55-57

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

The scope (`setup`, `build`, `ci`, `roadmap-status`, etc) usually maps to the top-level directory or a domain area. Look at recent `git log` for examples.

### Branch naming

`<your-handle>/<short-kebab-case-description>` — e.g. `arthur742ramos/prereq-walkthrough`. Worktree-backed agents (Copilot CLI) auto-pick these; humans can use whatever they like as long as it's kebab-case and identifies the change.

### Artifact policy — never commit

| Path | Why excluded |
|---|---|
| `node_modules/` | npm install output |
| `out/` | tsc / esbuild output |
| `backend/target/`, `backend/project/target/` | sbt output |
| `backend/dist/` | bundled fat jar (only exists locally and inside the .vsix) |
| `*.vsix` | packaging output |
| `.bsp/`, `.metals/` | sbt / metals IDE state |
| `.vscode-test/` | extension test harness state |

`.gitignore` already covers these. If a build script outputs somewhere new, add it.

### Secrets and local paths

- Never commit secrets, tokens, API keys, AI provider credentials, or copy-pasted PATs.
- Never commit machine-specific paths (your Isabelle install path, your Java path, your home directory). Use settings (`isabelle.executablePath`, `isabelle.backend.command`) so end users override at runtime.
- The AI repair surface (`src/repair/`) uses VS Code's `SecretStorage` — see `docs/AI_REPAIR.md` for the safety contract. Don't bypass it.

---

## Architecture map

```
┌─────────────────────────────────────────────────────────────────┐
│  VS Code Extension Host  (TypeScript, runs in extension process) │
│                                                                  │
│  src/extension.ts       activate / deactivate, command + view    │
│                         registration, service wiring             │
│                                                                  │
│  src/document/          PIDE decorations, document sync,         │
│                         command-span tracking                    │
│  src/semantic/          syntax tokens, hovers, abbrevs           │
│  src/proof/             proof outline + state panel              │
│  src/sledgehammer/      sledgehammer panel + quiescence          │
│  src/theoryGraph/       theory graph view                        │
│  src/repair/            checked AI repair workflow               │
│  src/build/             isabelle build CLI runner                │
│  src/session/           ROOT/ROOTS discovery, session tree       │
│  src/setup/             prerequisite checker + auto-detect       │
│  src/api/               public extension API (PideDocumentation, │
│                         PreviewSubscriber, spell-checker)        │
│                                                                  │
│  src/backend/           BackendManager + ProcessTransport        │
│  src/lsp/               IsabelleLanguageClient (vscode-          │
│                         languageclient relay to vscode_server)   │
│  src/protocol/          JSON-RPC message types & framing         │
└────────────┬──────────────────────────┬──────────────────────────┘
             │ JSON-RPC                 │ LSP (optional)
             ▼                          ▼
┌──────────────────────────┐  ┌───────────────────────────────────┐
│  Scala Backend           │  │  isabelle vscode_server           │
│  (backend/, Scala 2.13)  │  │  (bundled with Isabelle)          │
│                          │  │                                   │
│  PideBridge seam         │  │  PIDE-flavoured LSP features:     │
│  (LocalSyntaxPideBridge  │  │  decorations, hover, completion,  │
│   today; real PIDE in    │  │  state_output, sledgehammer       │
│   the future)            │  │                                   │
└──────────────────────────┘  └───────────────────────────────────┘
             │ spawns
             ▼
┌──────────────────────────────────────────────────────────────────┐
│  isabelle CLI  (user-installed, on PATH or isabelle.executablePath)│
└──────────────────────────────────────────────────────────────────┘
```

When designing a new feature, decide which side owns it:

- **Pure VS Code presentation / no Isabelle data needed** → TS only.
- **Needs Isabelle data via stable interfaces (ROOT discovery, build invocation, document spans)** → Scala backend, exposed via JSON-RPC, consumed from TS.
- **Needs live PIDE state (real proof state, sledgehammer output, decorations)** → LSP relay (`src/lsp/`), wired via `IsabelleLanguageClient.onNotification` and friends. The Scala backend's `PideBridge` will eventually grow native PIDE access too — keep TS-side wiring optional so it gracefully degrades when the LSP isn't running.

See `docs/PIDE_INTEGRATION.md` for the chosen LSP-relay roll-out and which capabilities have landed.

---

## Known gotchas (please add to this list when you hit a new one)

### 1. Workflow-scope OAuth on `.github/workflows/*` pushes

If your push to a `.github/workflows/*.yml` file is rejected with:

```
! [remote rejected] <branch> -> <branch>
  (refusing to allow an OAuth App to create or update workflow
   `.github/workflows/<file>` without `workflow` scope)
```

your token lacks the `workflow` OAuth scope. The fix depends on your setup:

| Setup | Fix |
|---|---|
| **Local dev** with `gh` CLI | `gh auth refresh -h github.com -s workflow` and retry. |
| **Copilot CLI** session where `GH_TOKEN` env var lacks `workflow` but your keyring credential has it | `Remove-Item Env:\GH_TOKEN` (Windows) or `unset GH_TOKEN` (POSIX) for the single push, then restore. Git falls back to the keyring credential, which usually has `workflow`. |
| **CI / Actions** | Use the built-in `GITHUB_TOKEN` with explicit `permissions: contents: write` (and `workflows: write` if mutating workflows from a workflow — rare). |

This bit three consecutive PRs (#59, #60, #61) before the cause was diagnosed. Document any new variants you find.

### 2. Fat jar vs thin jar

`sbt package` produces a **thin jar** (no Scala stdlib / ujson on the classpath). `BackendManager` launches with plain `java -jar`, so a thin jar crashes with `NoClassDefFoundError` on first start. **Always use `sbt assembly`** (the `backend:package` script already does). The fat-jar config and a META-INF merge strategy live in `backend/build.sbt`.

### 3. `.vscodeignore` excludes `node_modules/**`

`vsce package --no-dependencies` is intentional. The shipping artifact is the esbuild bundle (`out/extension.js`), which inlines runtime deps like `vscode-languageclient`. **Don't** add `node_modules` to the `.vsix` to "fix" a missing-runtime-dep error — instead, check that the import is reachable from `src/extension.ts` so esbuild picks it up.

### 4. `"private": true` in `package.json`

Only blocks `npm publish` (irrelevant — we publish to the VS Code Marketplace, not npm). Don't remove it without a separate discussion.

### 5. Tag-version consistency

The release workflow verifies that `v$(jq .version package.json)` equals `github.ref_name` and fails the run otherwise. Bump `package.json` **before** tagging.

### 6. Walkthrough markdown — command links not buttons

Walkthrough cards do support `[Re-check setup](command:isabelle.checkPrerequisites)` markdown command links, but VS Code doesn't render them as buttons. They appear as styled links. If you want a real button, add a step button via `package.json`'s `contributes.walkthroughs.steps[].button` field — but that's a heavier API and most cards do fine with markdown command links.

### 7. The "52 commands" trap (never hard-code counts)

`media/walkthrough/open-theory.md` used to say "52 commands in the Command Palette". Actual count was 48 and would have drifted. Hard-coded counts in docs go stale the moment someone adds or removes a command. Use "the full set" or compute the number dynamically. (Same lesson applies to test counts — write "639 tests pass" only in commit messages and PR descriptions, not in docs.)

---

## When opening a PR

1. Use the PR template (`.github/PULL_REQUEST_TEMPLATE.md`).
2. Fill in **Test evidence** with the actual command(s) you ran and the result. Reviewers should not have to guess what you validated.
3. Keep PRs focused — one logical change per PR. A "feat + ci + docs" mega-PR is hard to review and hard to revert.
4. If you addressed review comments on a previous PR, post a summary in the body and **resolve** the threads as you go. (For Copilot CLI: `gh api graphql` with the `resolveReviewThread` mutation, see `agent-merge` skill.)
5. Don't comment on the PR to ask for review or ping CODEOWNERS — assume the user owns sharing.

---

## What this repo is NOT

- Not a PIDE implementation. The Scala backend currently exposes safe placeholders; real PIDE integration is roadmapped (`docs/ROADMAP_STATUS.md`).
- Not a sledgehammer / proof-search engine of its own. The Sledgehammer panel routes through the LSP when enabled and reports "unavailable" otherwise.
- Not an AI repair tool. The repair surface intentionally never calls third-party APIs without explicit per-provider opt-in and never auto-applies edits. See `docs/AI_REPAIR.md`.

If you find yourself wanting to add live theorem proving or AI repair-application, stop and ping the user — those decisions are intentionally constrained.

---

## Further reading (project docs in `docs/`)

- **`ROADMAP_STATUS.md`** — consolidated milestone roll-up, what's shipped vs. roadmapped vs. upstream-blocked.
- **`PIDE_INTEGRATION.md`** — LSP-relay architecture, capability checklist for milestones 4/5/7.
- **`AI_REPAIR.md`** — checked-repair safety contract, AI-provider registration shape.
- **`sledgehammer_lsp_research.md`** — PIDE/sledgehammer wire format research.
- **`proof_state_and_minimization_lsp_research.md`** — proof-state LSP surface research.

---

## Future agent enablement (not yet built)

The following ideas were considered for this PR and rejected for scope:

- **Project-local Copilot CLI extension** (`.github/extensions/isabelle-pide-helpers/extension.mjs`) — custom tools like `validate_extension_vsix(path)`, `check_isabelle_path()`, `lint_walkthrough_md(path)`. Useful but adds reviewer burden and Copilot CLI-specific knowledge. File a follow-up if you want this.
- **Bundled per-platform JRE** (Tier 2 from the install-UX roadmap) — per-platform `.vsix` with `extension/jre/` so end users don't need Java. Big PR; own scope.

Open an issue with the `meta` label to discuss.
