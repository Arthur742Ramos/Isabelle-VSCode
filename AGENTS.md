# AGENTS.md

This file is the **canonical guide for AI coding agents** (Copilot CLI, GitHub Copilot Coding Agent, Claude Code, Cursor, Aider, codex, etc) and humans onboarding to this repository. It documents what the project is, how it's built, the conventions you must follow, and the gotchas that have bitten previous contributors.

If you change something in this repo, read this file first. Updating it when you discover a new convention or trap is part of the deal.

## TL;DR for an agent

```text
1. Run `npm install` once (Tier-1 toolchain).
2. Run `npm run check` to compile + run the vitest suite (~3 s).
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
| **Scala backend** (`backend/`) | Scala 3.3.4 | JSON-RPC server that fronts Isabelle CLI invocations, parses ROOT/ROOTS, exposes a `PideBridge` seam wired to the real Isabelle/PIDE Headless API (Phases 1-5, PRs #74-#82). Built as a fat jar via `sbt assembly` and bundled in the `.vsix`. Scala version is pinned to match Isabelle 2025-2's bundled PIDE — see AGENTS.md §11. |

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

### Tier 2 — Backend changes / packaging / install / hosted integration tests

| Tool | Version | Why |
|---|---|---|
| **Java JDK** | 21+ | `sbt assembly` needs it; the bundled backend jar needs it at runtime. Microsoft OpenJDK, Adoptium Temurin, Oracle — any vendor. |
| **sbt** | 1.12+ | `npm run backend:*` scripts. |
| **VS Code CLI** | `code` or `code-insiders` on PATH | `npm run install:extension` installs the freshly-built `.vsix` into your local VS Code. Set up via *Shell Command: Install 'code' command in PATH* from the Command Palette. |
| **Isabelle** | 2019+ | Only needed to **exercise** features that talk to Isabelle (build, language server, sledgehammer). The extension itself activates and most local features work without it. |
| **Display server** | any (or `xvfb-run` on headless Linux) | `npm run test:integration` boots a real VS Code; it needs a display. Windows/macOS dev machines just work; CI uses `xvfb-run`. |

If you don't have Tier 2 installed, you can still do meaningful work — see the validation matrix below.

---

## Command cheatsheet

```powershell
# Tier 1 (Node-only)
npm install               # Once, after clone
npm run compile           # tsc -> out/*.js (development emit, not the bundle)
npm run watch             # tsc -watch
npm run test              # vitest run (~3 s)
npm run check             # compile + test (CI uses this)
npm run bundle            # esbuild -> single out/extension.js for packaging

# Tier 2 (needs Java + sbt)
npm run backend:compile   # sbt compile
npm run backend:test      # sbt test
npm run backend:package   # sbt assembly -> backend/dist/isabelle-vscode-server.jar (fat jar)
npm run backend:run       # sbt run (for dev with isabelle.backend.command = sbt)

# Tier 2 — VS Code-hosted integration tests (needs a display server; Linux CI uses xvfb-run)
npm run test:integration  # bundle + tsc test/integration + boot VS Code via @vscode/test-electron
npm run test:all          # npm run check + npm run test:integration (combined gate)

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
| `test/**` (structural vitest, *not* `test/integration/**`) | `npm run check` | — |
| `test/integration/**` (hosted Mocha) | `npm run test:integration` | Re-run `npm run check` to confirm vitest still ignores the hosted-test tree |
| `package.json` (scripts, contributes, deps) | `npm run check` + `npm run bundle` | `npm run package` if `vsce` packaging surface affected, and `npm run test:integration` if you added/removed a contributed command (the hosted drift detector covers this) |
| `backend/**` (Scala) | `npm run backend:test` + `npm run backend:compile` | Re-bundle so the new fat jar is included |
| `.github/workflows/release.yml` | nothing locally — push and observe via Actions | Also validate YAML with `node -e "require('yaml').parse(...)"` |
| `.github/workflows/copilot-setup-steps.yml` | same as above | Workflow only takes effect once merged to default branch |
| `README.md`, `docs/**`, `media/walkthrough/**` | nothing — they're not linted | Skim-check rendered markdown |
| `.vscodeignore` | `npm run package:validate` | Verifies the `.vsix` still contains the right files |

CI (`.github/workflows/ci.yml`) runs two parallel jobs on every PR:

- **`validate`** — `npm run check`, `npm audit --audit-level=moderate`, and `npm run backend:compile` (with Java 21 + sbt).
- **`integration-tests`** — `xvfb-run npm run test:integration` on `ubuntu-latest` with a cached `.vscode-test/` download. Catches activation regressions and command-registration drift.

You should reproduce both locally for anything non-trivial (`npm run test:all`).

---

## Repository conventions

### TypeScript

- Strict mode is on (`tsconfig.json`). No `any` slip-ins, no `// @ts-ignore` without a comment explaining why.
- `vscode` API is **only** imported from `src/extension.ts` and a small set of UI-thin modules. Everything testable should live in a `vscode`-free module (see "Test conventions" below).
- esbuild bundles `src/extension.ts` to a single `out/extension.js` with `external: vscode`. Don't add `node_modules/**` paths to `.vscodeignore` — they're meant to be excluded; the bundle is the shipping artifact.

### Test conventions — **structural / vscode-free**

**Verified universal for vitest:** every test file under `test/**/*.test.ts`
(excluding `test/integration/**`) avoids importing `vscode` directly. They
exercise pure modules with injected fakes for `fs`, `child_process.spawn`,
`vscode` UI surfaces, etc. This remains the **primary** test mode.

When you add a new module:

1. Put pure logic in a module that does not import `vscode` / `child_process` / `fs`.
2. Inject dependencies via interfaces (see `src/setup/PrerequisiteChecker.ts` and `src/setup/isabelleAutoDetect.ts` for the cleanest current examples).
3. Wire the production implementation in a sibling file (see `src/setup/runtime.ts`).
4. Test the pure module with vitest + node-only fakes.

Why: vitest cannot import `vscode`. The `vscode-languageclient` package transitively imports `vscode` and is the reason `src/lsp/IsabelleLanguageClient.ts` and a few other files are not directly unit-tested under vitest — they're covered structurally via injectable seams in `lspNotificationRegistry.ts` and friends.

#### Hosted integration tests (small, additive)

There is also a **deliberately tiny** VS Code-hosted Mocha surface under
`test/integration/`, driven by `@vscode/test-electron` (`npm run test:integration`).
It exists to catch two failure modes that no structural test can see:

1. `activate()` actually runs end-to-end without throwing inside a real
   extension host (`activation.test.ts`).
2. Every command declared in `package.json` `contributes.commands` is
   actually registered by `src/extension.ts` (`commandRegistration.test.ts`,
   computed dynamically from `package.json` — never hard-code the count;
   see gotcha #7 below).

This surface is **opt-in**: `npm run check` deliberately does *not* run it,
so Tier-1 (Node-only) contributors keep their fast green. Use
`npm run test:all` to run both suites. CI runs the hosted suite as a
separate `integration-tests` job on `ubuntu-latest` under `xvfb-run`.

**Do not** expand the hosted surface speculatively. Add a hosted test only
when the behaviour genuinely cannot be tested structurally (and prefer to
add an injectable seam first). LSP behaviour, Sledgehammer dispatch, proof
state, AI repair, etc. all require a real Isabelle install and are covered
by `docs/SMOKE_THEORY_CHECKLIST.md` instead.

Prefer vscode-free unit/structural tests with injected fakes. The hosted
surface is the floor, not the ceiling.

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
| `jre/` | bundled Eclipse Temurin JRE downloaded by the per-platform release job (only exists in CI and inside per-platform `.vsix`) |
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
│  (backend/, Scala 3.3.4) │  │  (bundled with Isabelle)          │
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

`media/walkthrough/open-theory.md` used to say "52 commands in the Command Palette". Actual count was 48 and would have drifted. Hard-coded counts in docs go stale the moment someone adds or removes a command. Use "the full set" or compute the number dynamically. (Same lesson applies to test counts — write "689 tests pass" only in commit messages and PR descriptions, not in docs.)

### 8. LSP auto-start respects explicit overrides

The Isabelle language server auto-starts on activation when both Java and Isabelle are reachable AND `isabelle.languageServer.enabled` has not been explicitly set at any scope (user, workspace, or workspace folder). The detection lives in `src/setup/lspAutoStart.ts::decideLanguageServerStartup` (pure function, fully tested under `test/setup/lspAutoStart.test.ts`). Three things to know when working on this surface:

- **Don't change the package.json default for `isabelle.languageServer.enabled`.** Keep it `false`. The auto-start is driven by `inspect().{global,workspace,workspaceFolder}Value === undefined`, which means "user has not touched the setting". Changing the package default would make every existing user's machine look like "default", flipping behavior under their feet.
- **Auto-start failures are remembered per resolved Isabelle runtime.** The key is `isabelle.lsp.autoStartFailed.<hash(executable + extraArgs)>` in `workspaceState`. Changing any of `isabelle.executablePath`, `isabelle.languageServer.enabled`, `isabelle.languageServer.extraArgs`, or `isabelle.languageServer.autoStart` clears every such key; a successful auto-start clears its own key. The key shape comes from `computeAutoStartFailureKey()` — don't compute it ad hoc elsewhere.
- **`languageClient.start()` doesn't throw on reach-check / spawn failure.** It sets `state: "failed"` internally. Always check `languageClient.getStatus().state` after awaiting `start()` to detect failures from the auto-start path; the `.catch()` block only catches actual exceptions.

### 9. Per-platform VSIX with bundled JRE

The Release workflow (`.github/workflows/release.yml`) ships TWO flavors per tag: a **universal** `.vsix` (no JRE bundled, requires `java` 21+ on `PATH`) plus **seven per-platform** `.vsix` files (`win32-x64`, `win32-arm64`, `linux-x64`, `linux-arm64`, `alpine-x64`, `alpine-arm64`, `darwin-arm64`) that embed Eclipse Temurin 21 under `extension/jre/`. (`darwin-x64` was dropped in v0.1.0-alpha.3 — see §17.) Notes for anyone working on this surface:

- **Resolver:** `src/backend/resolveJavaCommand.ts` is the single source of truth for "where is the bundled Java?". `BackendManager` and `PrerequisiteChecker` both consult it. Path layout is platform-aware — macOS keeps the vendor `Contents/Home/` tree (so Eclipse Adoptium's signatures stay intact), Windows uses `.exe`, Linux/other POSIX uses plain `bin/java`. Validation requires `isFile()` + (POSIX) `X_OK`. A corrupt local `jre/` falls through to PATH `"java"` rather than wedging activation.
- **Bumping the bundled Temurin version:** edit the three `TEMURIN_*` env values at the top of `release.yml`. The SHA256 is fetched from Adoptium and verified inline, so no separate hash table needs updating. Verify by triggering a `workflow_dispatch` run before tagging.
- **`.vscodeignore` is the universal manifest; `.vscodeignore.platform` mirrors it but does NOT exclude `jre/**`.** Per-platform builds pass `vsce package --ignoreFile .vscodeignore.platform`. Keep the two in sync — the release job will fail-fast if the universal VSIX ever contains `extension/jre/`.
- **Platform-mismatched install:** users who download `-win32-x64.vsix` on macOS get a hard "not compatible" error from VS Code. The release notes table is the safety net; the README install table mirrors it. The universal `.vsix` is the fallback for everything not in the matrix (NixOS, *BSD, exotic CPU archs).
- **`linux-armhf` is intentionally NOT in the matrix.** Adoptium 21 does not ship a 32-bit ARM Linux JRE. Such users fall back to the universal `.vsix`.
- **macOS Gatekeeper:** the bundled Temurin binaries are signed by Eclipse Adoptium, but the surrounding `.vsix` is not notarized by us. The README documents the `xattr -dr com.apple.quarantine ~/.vscode/extensions/...jre` workaround.
- **State semantics:** after this PR, `PrerequisiteState.java === true` means "*a working Java runtime for the extension backend is available*", not "system PATH java is installed". Marketplace users may have `java: true` without any system Java. Walkthrough card + README reflect this.

### 10. Never set `transport: TransportKind.stdio` on the Isabelle LSP `ServerOptions`

Isabelle's bundled `isabelle vscode_server` tool **only accepts single-dash options** (`-A`, `-L`, `-l`, `-v`, ...) and always communicates over stdin/stdout. There is no `--stdio` / `--socket=...` / `--pipe=...` flag. Run `isabelle vscode_server -?` upstream to confirm.

`vscode-languageclient` v9's `Executable` ServerOptions handling (`node_modules/vscode-languageclient/lib/node/main.js` ~L405) auto-appends a transport argument *only* when `transport` is explicitly set. Setting `transport: TransportKind.stdio` makes it push `--stdio` onto the args; Isabelle's bash `getopts` then parses that as `--` (end-of-options) + `stdio` and the server exits 1 with `*** Illegal command-line option "--"` before any LSP traffic. The activation path subsequently logs `Pending response rejected since connection got disposed`, the language client retries on a backoff, and the user sees a stream of confusing reach-check failures.

Always build the executable ServerOptions through `buildExecutableServerOptions(cmd)` in `src/lsp/languageServerArgs.ts`. That helper deliberately returns `{ command, args }` only, never a `transport` field. The omission is pinned by `test/lsp/languageServerArgs.test.ts::buildExecutableServerOptions` (`expect("transport" in opts).toBe(false)`), so a future refactor cannot silently regress this.

When `transport` is undefined, vscode-languageclient still wires stdout/stdin to the protocol reader/writer — you get stdio behavior without the rejected argument. If you ever genuinely need to set `transport` (e.g. socket fallback for remote/SSH dev containers), first verify that the running upstream `isabelle vscode_server` build actually accepts the corresponding `--...` switch — most likely it does not.

### 13. PIDE Phase 2b cancellation tears down + re-bootstraps the Headless session

Phase 2b chose **Option A** (`Session.stop()` teardown on cancel + re-bootstrap on next request) over Option B (custom `isabelle.Progress` subclass via ByteBuddy) and Option C (async-with-callback JSON-RPC refactor). The trade-off has a non-trivial UX cost (~20 s on the next request after a cancel) that future agents need to understand before working on Phase 4 (Sledgehammer non-LSP) and Phase 5 (Sledgehammer minimization), which inherit this cost.

- **Why A won**: smallest blast radius (~150 LOC, no new deps), no protocol changes affecting stable code paths, no fragile bytecode subclassing of Scala-3 modules. The re-bootstrap cost is acceptable because cancellation is rare in practice — users typically cancel by mistake (cursor moved, dialog appeared), not as a routine workflow step.
- **Why NOT B**: ByteBuddy adds 2-3 MB of runtime dep weight, and reliably emitting Scala-3-compatible bytecode that subclasses `isabelle.Progress` (with its non-trivial initialization patterns) is fragile across Isabelle releases. The cost-to-value ratio doesn't make sense for a feature that ships in one PR.
- **Why NOT C**: pulls in wire-shape changes (notification channel for results) that affect every existing synchronous operation. Risk of regression on stable code paths (`document/openTheory`, `proofState/get`, etc.). Defer until we have a second long-running operation that needs the same pattern.
- **Hidden Option D** (compile-time `isabelle.jar % Provided` + direct `Progress` subclass): cleaner than A but pins our compile against Isabelle's API surface — re-pinning per upstream release becomes a maintenance tax. Worth revisiting only if Option A's UX cost becomes painful in practice (especially during Phase 4 Sledgehammer real-world use, where the re-bootstrap cost stacks on top of an already-multi-second proof search).

**Upgrade trigger**: if a user complaint or telemetry signal shows users routinely cancel PIDE operations (e.g. >5% of `pide/cancelWarmup` calls per session over a representative population), pivot to Option D in a Phase 2x PR: add `isabelle.jar` as `% Provided` to `backend/build.sbt`, implement `CancellableProgress extends isabelle.Progress` with an `AtomicBoolean stopped` flag the `check()` override consults, swap `HeadlessFacade.submitTheory` to pass the custom Progress as `use_theories$default$12`. License contract preserved (no bundling — `% Provided` is compile-only).

**Implementation guardrails preserved across Phase 2b + the 2b polish PR**:
- The post-cancel `Session.stop()` runs on `HeadlessSessionRegistry.cleanupExecutor` (single daemon thread) so the dispatcher's main thread acknowledges cancels immediately. Don't move it back to the main thread under any "but it's only 100ms" justification — `Session.stop()` can block 100ms-1s while the actor acknowledges, and that's user-visible jank on a clearly-cancellable operation.
- `inflightFacade.getAndSet(None)` is the atomic-swap idempotence guard. Don't replace with a plain `inflightFacade.get()` + conditional clear — the race window allows double-teardown on rapid multi-clicks.
- TS side surfaces a transient status-bar message after the user cancels: "Isabelle: PIDE session cancelled; will rebuild on next request (~20 s)...". This is the only way users see WHY their next operation pays the rebootstrap cost.

---

### 11. Never bundle Isabelle's PIDE jars; load reflectively from `<ISABELLE_HOME>` at runtime

The Phase 1 PIDE classpath bridge (`backend/src/main/scala/dev/isabelle/vscode/server/{IsabelleHome,IsabellePideClasspath,PideBridgeSelector}.scala`) loads `isabelle.Isabelle_System` and the rest of Isabelle's PIDE API surface from the user's local install at runtime, through a child `URLClassLoader` constructed against `<ISABELLE_HOME>/lib/classes/isabelle.jar` plus the matching `<ISABELLE_HOME>/contrib/scala-*/lib/*.jar` directory.

Things that bite:

- **License contract.** We must never bundle `isabelle.jar` or anything from `contrib/scala-*/lib/` into our backend fat jar or `.vsix`. The license guard at `backend/scripts/check-license.js` is wired into `npm run backend:package` and fails the build (exit code 2) if any class under the `isabelle/` top-level package leaks into `backend/dist/isabelle-vscode-server.jar`. `dev/isabelle/` (our own code) is fine. See `THIRD_PARTY_NOTICES.md` "Isabelle/PIDE runtime classpath bridge" for the user-facing summary.
- **Scala versions must match.** Isabelle2025-2 ships PIDE compiled against Scala 3.3.4 (the `.tasty` files alongside every `isabelle.*.class` prove it). The backend tracks the same Scala version (Phase 0, PR #72). If you ever bump `scalaVersion` in `backend/build.sbt` away from whatever the next Isabelle release ships, the reflective `Class.forName("isabelle.Isabelle_System$", true, loader)` probe will fail with `ExceptionInInitializerError` because of TASTy/binary mismatches. `PideBridgeSelector` reports this as `reason: "module-init-failed"` so users see something actionable, but the fix is always "match Isabelle's Scala version, then re-run `npm run backend:package`."
- **Don't cache the `URLClassLoader` long-term in Phase 1.** On Windows, an open `URLClassLoader` pins the jar file handles, so users could not update Isabelle while VS Code was running. `PideBridgeSelector` builds a fresh loader per call and closes it in a `try/finally`. Phase 2+ (when documents actively depend on the loader for a long-lived session) will introduce a proper lifetime-managed cache keyed by a fingerprint that includes `isabelle.jar` mtime + size so a re-installed Isabelle invalidates the loader.
- **Scala 3 module access pattern.** Don't stop at `loadClass("isabelle.Isabelle_System")` — that only proves the bytes are findable. The probe must call `Class.forName("isabelle.Isabelle_System$", true, loader).getField("MODULE$").get(null)` to verify the Scala 3 module initialiser runs cleanly on our JVM. The selector reports the difference as `proofOfLife: "module-loaded"` vs `"class-only"` vs `"none"` so reviewers can tell whether downstream PIDE calls will work.
- **`URLClassLoader` parent stays `getClass.getClassLoader`.** Both our backend's fat jar and Isabelle's `contrib/scala-3.3.4/lib/` ship the same `scala3-library_3-3.3.4.jar` and `scala-library-2.13.14.jar`. Parent-first delegation routes Scala stdlib calls to our bundled copies (same binary version), which avoids `ClassCastException`s if/when Scala values cross the reflective boundary in Phase 2+. Switching to `ClassLoader.getPlatformClassLoader()` would create two `scala.collection.immutable.List$` class identities and break basic reflective dispatch.
- **Cross-platform install resolution.** `IsabelleHome.resolve` walks env → executable-path-with-ancestor-walking → platform defaults. The ancestor walk handles macOS app-bundle nesting (`Isabelle.app/Contents/Resources/Isabelle/Isabelle2025-2/`), Nix store paths, Snap wrappers, and symlinked launchers via `toRealPath`. Lexicographic ordering of `Isabelle*` candidates approximates "newest version wins" — fine for `YYYY-N` releases today, may need re-visiting if Isabelle ever ships `YYYY-10` since lexicographic order would put `2025-2 > 2025-10`.

### 12. PIDE document submission (Phase 2a) — bootstrap order, env vars, `Throwable` catch

Phase 2a wires `document/checkWithPide` through `isabelle.Headless.Session.use_theories(...)`, lazy-built on first call and cached for backend process lifetime in `HeadlessSessionRegistry`. The reflective bootstrap chain is fragile in five places that bit the spike before stabilizing:

- **Environment.init MUST run before any Isabelle class initializer.** `isabelle.Options$.<clinit>` reaches `Symbol → Isabelle_System → Settings → Environment.settings()`, and `Environment.settings()` calls `init("","")` if `_settings == null`. With empty args the bootstrap throws `Unknown Isabelle root directory`. `HeadlessBootstrap.bootstrap` invokes `isabelle.setup.Environment.init(home, cygwinRoot)` as Step 1, which populates `_settings` so subsequent class initializers can short-circuit. Don't reorder.
- **Bash subprocess on Windows.** `Environment.init` on Windows runs `<cygwinRoot>\bin\bash -l "<isabelleRoot>\bin\isabelle" getenv -d <tempfile>` to dump the resolved settings. This is a 2-5 s subprocess invocation that happens on the worker thread; the dispatcher stays free to receive `pide/cancelWarmup`. Without a working Cygwin install at `<home>/contrib/cygwin/bin/bash.exe`, init fails with a `RuntimeException` — `HeadlessBootstrap` surfaces this as `BootstrapFailure(step="environment-init", ...)` so the TS layer can show a remediation hint.
- **Backend JVM needs three env vars.** `BackendManager.spawn` threads `ISABELLE_HOME` AND `ISABELLE_ROOT` AND (on Windows) `CYGWIN_ROOT` derived from `isabelle.executablePath` via `pideEnvBuilder.buildPideEnv`. Setting only `ISABELLE_HOME` is not enough: `Environment.bootstrap_directory` looks up `ISABELLE_ROOT` (env var name), not `ISABELLE_HOME`, so the latter is set defensively for the Settings map lookup but not used by the bootstrap path.
- **Scratch directory MUST come from `context.globalStorageUri.fsPath`, NOT OS temp.** Threaded as `BACKEND_SCRATCH_DIR` env var. The OS temp dir gets nuked on schedules we don't control; `globalStorageUri` is per-extension, cross-platform, and auto-cleaned on uninstall. `ScratchTheoryStore` stages each `<TheoryName>.thy` under `<scratchRoot>/<workspaceHash>/` with Symbol-encoding applied via `SymbolTranslator.encode` before writing.
- **`use_theories` master_dir must be Isabelle-standard, not platform-native.** On Windows, Isabelle's parser rejects `C:\...` paths with `Illegal character ":"`. `HeadlessFacade.toIsabellePath` invokes `isabelle.setup.Environment.standard_path(platformPath)` reflectively before passing the master_dir to `use_theories`. Don't skip this translation even if the path looks OK on POSIX — it's a no-op there and a hard requirement on Windows.
- **`NonFatal` does NOT catch `ExceptionInInitializerError`.** It's a `LinkageError` subclass; Scala's `NonFatal` predicate excludes it explicitly. Every reflective entry point in `HeadlessBootstrap` / `HeadlessFacade` / `SymbolTranslator` catches `Throwable`, not `NonFatal`. If you add a new reflective call to the bridge, follow the same pattern — a bare `case NonFatal(_)` will silently propagate an Isabelle static-initializer failure as an uncaught backend exception that kills the JVM.
- **`List$.apply` varargs signature is fragile across Scala patch releases.** `HeadlessFacade.scalaListOf` builds `value :: Nil` directly via the `scala.collection.immutable.$colon$colon` cons constructor reflectively, rather than depending on `List$.apply(scala.collection.immutable.Seq)` whose compiled signature can shift. If you need to build other Scala collections reflectively, prefer constructor-based construction over the apply-varargs trick for the same reason.
- **Long-lived Session caching breaks the Phase 1 "no cache, close per call" pattern.** `Headless.Session` is too expensive to rebuild per call (~19 s startup on the dev machine). `HeadlessSessionRegistry` caches it by fingerprint `(canonicalHome, sessionName, isabelleJarSize, isabelleJarMtimeMillis)` and invalidates when any component changes. The classloader stays open for the cached lifetime — Windows users who upgrade Isabelle in place must reload the window to release the file handles. The `Isabelle: Show PIDE Document Status` command surfaces the live fingerprint so users can confirm the cache is valid.
- **Cancellation of an in-flight `use_theories` is teardown-based (Phase 2b).** `use_theories` is a synchronous blocking call into PolyML via JNI; there is no Java-level interrupt point until it returns naturally. Phase 2b's `HeadlessSessionRegistry.cancelInflightWarmup` therefore calls `Session.stop()` on the in-flight facade, which sends a Stop signal to the Isabelle session actor. The blocking call returns with an Interrupt-class exception that `HeadlessFacade.submitTheory` catches; `CheckWithPideHandler` then returns `status: "pide-cancelled"`. **Side effect**: the cached facade is torn down by the cancel, so the next `document/checkWithPide` call re-bootstraps a fresh Session (~20 s cost on that next call). This is the deliberate trade-off vs the harder mechanisms (custom `Progress` subclass via ByteBuddy, async-with-callback protocol change) — accept the re-bootstrap on cancel for simplicity, since cancellation is rare. If Phase 2c surfaces that users actually cancel often, swap in a custom `Progress` impl that aborts via `Progress.check()` without tearing the Session down.
- **Phase 2c diagnostic + lifecycle surface.** Three new JSON-RPC methods: `pide/warmup` (eager facade build, dispatched on the worker thread so `pide/cancelWarmup` can still interrupt mid-call); `pide/cacheState` (read-only fingerprint + inflight snapshot for `Isabelle: Show PIDE Document Status`); `pide/invalidateCache` (force-evict the cached facade for "I updated Isabelle, force rebuild" scenarios). New TS command `Isabelle: Invalidate PIDE Cache` exposes the last to users. The orphaned `isabelle.pide.prewarmOnActivation` setting (added in Phase 2a) is now actually wired — `extension.ts::maybePrewarmPide` dispatches `pide/warmup` ~1.5 s after activation when the setting is `true` AND `isabelle.session.active` is non-empty. Prewarm failures log to the output channel only (no user-facing toast) because a failed prewarm is harmless — the next user-facing PIDE call retries from scratch.

### 14. PIDE Phase 3a snapshot extraction — Headless mode does NOT auto-print proof goals (per-command)

Phase 3a (PR #79) wires `proofState/getWithPide` end-to-end against `Document.Snapshot`: the snapshot cache (`SnapshotCache`) populates lazily per `(uri, version, session)` after a `use_theories` submission, the cursor's offset is resolved via shared `OffsetToPosition`, and the matching command is located by walking `snapshot.node.commands.toList` and accumulating `command.length`. So far so good.

**Per-command Results() is sparse**: Isabelle's `Headless.use_theories` populates `Command.State.results` only with prover messages emitted during normal evaluation — it does NOT auto-populate the per-command proof-goal print that the IDE state panel renders. In the jEdit / LSP flow, that printing is driven by a separate `Print_State` agent that subscribes to dynamic_output and runs `Output.print_state(...)` reflectively for the command at the user's cursor.

**Phase 3b solution (PR #80)**: instead of trying to reflectively reconstruct the `Print_State` agent (which would require the full `Query_Operation` infrastructure), use `snapshot.messages` — the same surface the `isabelle dump` tool uses for its `messages` aspect. Returns a list of `(XML.Tree, ?)` tuples that DO include the prover messages emitted during `use_theories` (theorem statements, definitions, syntax declarations). Flatten via `XML.content(tree)`, return as `goals[]`. Real Unicode (`∧`, `⟹`, `⇒`) comes through after `Symbol.decode`.

`SnapshotProofStateExtractor.extractPrinterMessages` implements this. The Phase 3a `[results]` fallback path is preserved as a last resort but now usually unused because the messages path returns real content.

**Remaining limitation**: per-command FILTERING of messages by cursor range is not implemented in Phase 3b — `snapshot.messages` returns ALL messages emitted during the use_theories run, not just those tagged for the cursor's command. The result is "what did the prover emit while elaborating this theory" rather than "what's the proof state right HERE". Phase 3c (or a follow-up polish PR) can add range filtering via `Text.Range`-based `snapshot.cumulate(...)` if users find the breadth confusing.

**Headless-mode UX divergence** (documented in `docs/PIDE_INTEGRATION.md`): proof state in Headless mode (LSP off) refreshes on cursor move + explicit command, NOT continuously as the prover progresses. Live progress notifications require the LSP relay's `PIDE/state_output` channel.

### 15. PIDE Phase 4 Sledgehammer — source-injection trick, not Query_Operation reflection

The jEdit / LSP path to Sledgehammer is `isabelle.Query_Operation`, which requires an `Editor` + `editor.Context`, a `print_function` overlay attached to a live Session, and subscription to `Session.commands_changed` for the result. That surface is heavyweight in Headless mode — it would require either implementing an `Editor` stub reflectively OR finding a Headless-flavored "submit print overlay" entry point that doesn't exist in the public PIDE API.

**Phase 4 solution (PR #81)**: instead of going through Query_Operation, treat `sledgehammer` as a regular Isabelle command and inject it into the source text at the cursor before re-submitting through `Headless.Session.use_theories`. Implementation:

1. `SledgehammerSourceInjector` (pure) — given the cursor `(line, character)`, inserts a `sledgehammer` line with the same indentation immediately before the cursor's line, returns the mutated text + the position of the injected keyword.
2. `SledgehammerWithPideHandler.runInjectedSubmission` — reuses the entire Phase 2a/3 pipeline (resolve home, build classpath, acquire/build facade, write scratch theory via `ScratchTheoryStore` after Symbol-encoding, call `facade.submitTheoryWithRaw`).
3. After submission, walk `snapshot.messages` via the Phase 3b `SnapshotProofStateExtractor.extractPrinterMessages` path — the prover output emitted while elaborating the injected `sledgehammer` command shows up there as "Try this: ..." lines.
4. `SledgehammerSuggestionParser` (pure regex) — `^\s*(\w+):\s*Try this:\s*(.+?)(?:\s*\(([^()]+)\))?\s*$` extracts the prover name, proof text, and optional timing. Duplicates by `(method, proofText)` are removed preserving first occurrence.

Tested live against `Isabelle2025-2` + `Smoke.thy` cursor on the `sorry` line: returns 4 structured suggestions (`fastforce`, `simp`, `auto`, `metis`) with timings and `using assms by ...` / `by (metis ...)` proof bodies. End-to-end ~80 s on a cold session (covered by the cold bootstrap + Sledgehammer's own ~15-30 s elaboration); sub-second on a hot session because `Headless.Session` is cached for backend lifetime (Phase 2a).

**Important: do NOT cache the injected snapshot.** The cache key (uri, version, session) refers to the user's actual source. A sledgehammer submission has a DIFFERENT source (we mutated it). `SledgehammerWithPideHandler` evicts any existing entry for the URI after running so a follow-up `proofState/getWithPide` re-submits the user's original text against the now-mutated Session — important because the Session has remembered the mutated text. Re-submission of the user's actual text against the same Session is correctly handled because `use_theories` is keyed on theory name + content.

**Cancellation reuses Phase 2b**: `sledgehammer/cancel` calls `HeadlessSessionRegistry.cancelInflightWarmup` which tears down the in-flight facade via `Session.stop()` on a background executor. The next `sledgehammer/run` or `proofState/getWithPide` pays the ~20 s re-bootstrap cost.

**The "command at cursor" reported in the result is from the INJECTED text, not the user's text.** This is by design — the user wants to know "what command did the prover see Sledgehammer applied to?" and the injected sledgehammer is exactly that. The reported offsets are in the injected text's coordinate system; the TS panel does not currently visualize them.

### 16. PIDE Phase 5 Sledgehammer minimization — same injection, with options + fact overrides

Sledgehammer's built-in `minimize=true` (Phase 4's default) already minimizes the proof IT found from scratch. Phase 5's M7 unlock is a different scenario: the user has an EXISTING proof body like `by (metis foo bar baz qux assms)` (perhaps copied from a reviewer's comment or an older codebase) and wants to know "does Sledgehammer think any of these facts are unnecessary?"

**Phase 5 solution (PR #82)**: same source-injection pipeline as Phase 4, but with two extension points:

- `SledgehammerSourceInjector.Options` now carries optional `params: Map[String,String]` (becomes `sledgehammer [k=v, ...]`), `onlyFacts: Seq[String]` (becomes `(fact1 fact2 ...)` — the syntax for "restrict to these facts"), `addFacts: Seq[String]` (becomes `(add: ...)`), and `delFacts: Seq[String]` (becomes `(del: ...)`).
- `SledgehammerWithPideHandler.handle` parses these from the JSON-RPC request (extending the `sledgehammer/run` wire shape, all new fields optional → backward-compatible).

TS side adds a dedicated command `Isabelle: Minimize Sledgehammer Proof at Cursor`:

1. Reads the line at the cursor via `editor.document.lineAt(line).text`.
2. Parses it via `parseProofBody` (pure module in `src/sledgehammer/minimizeProofParser.ts`) which recognizes `by (method fact1 fact2)`, `by method`, `using ... by (method ...)`, `apply (method ...)`.
3. Sends `sledgehammer/run` with `onlyFacts: [...all facts...]` + `sledgehammerOptions: { minimize: "true", preplay_timeout: "10" }`.
4. Returns the minimized suggestions through the existing pipeline.

**Trade-off**: relies on Sledgehammer's own minimizer rather than reflectively invoking `Sledgehammer_Minimize.run` directly. The advantage is zero reflective surface beyond Phase 4's; the disadvantage is the `preplay_timeout=10` is the only minimization-aggressiveness knob exposed. If users need stricter minimization (e.g. binary search via `Sledgehammer_Prover_Minimize.binary_minimize`), Phase 5b can add direct reflection.

**The `injectedCommand` field on `SledgehammerRunResult`** echoes the actual `sledgehammer [...] (...)` text the backend injected. The TS minimize UX surfaces this in the output channel so users can see exactly what was tried. Useful for debugging "why did this produce these suggestions?".

**Fact-name escaping**: `escapeFactName` defends against fact names containing spaces or quotes by wrapping in double quotes and escaping internal quotes. Empty/whitespace fact names become `_` (a placeholder Isabelle parses but doesn't match anything). Conservative — covers the unusual but legal cases without trying to be too clever.

### 17. macOS Intel (`darwin-x64`) is NOT in the per-platform release matrix

GitHub's `macos-13` runner pool (the last Intel-x64 macOS option) has chronic queueing issues since the `macos-15` / `macos-26` rollout pushed Intel runners into low-priority capacity. Three consecutive `release.yml` runs (two `workflow_dispatch` runs in May 2026 plus the `v0.1.0-alpha.2` tag push) all stalled with `darwin-x64` queued for hours, blocking the `publish` job and stranding every other platform's artifacts.

The trade-off:
- **Benefit of keeping it:** macOS Intel users get a `.vsix` that bundles Eclipse Temurin 21.
- **Cost of keeping it:** every release tag stalls indefinitely until/unless `macos-13` becomes available. Marketplace publish never fires for the other 8 platforms.
- **Mitigation for affected users:** the universal `.vsix` works on macOS Intel as long as `java` 21+ is on `PATH` (Homebrew: `brew install --cask temurin@21`).

**Decision:** drop `darwin-x64` from the matrix. Re-add only if (a) GitHub announces healthy Intel macOS runner capacity, or (b) we see evidence of meaningful macOS Intel user demand. Tracking via a documented open question rather than a hot follow-up.

If you re-add it: the entry pattern lives in `.github/workflows/release.yml` under `build-platform.strategy.matrix.include`. Keep `runner: macos-13` (last Intel-supporting label) and set `native_smoke: true`. Verify with a `workflow_dispatch` run BEFORE tagging. Don't forget to re-add the row to the README install table, the release-notes asset table inside `release.yml`'s `publish` job, and remove the macOS-Intel callout from the release notes body.

---

## When opening a PR

1. Use the PR template (`.github/PULL_REQUEST_TEMPLATE.md`).
2. Fill in **Test evidence** with the actual command(s) you ran and the result. Reviewers should not have to guess what you validated.
3. Keep PRs focused — one logical change per PR. A "feat + ci + docs" mega-PR is hard to review and hard to revert.
4. If you addressed review comments on a previous PR, post a summary in the body and **resolve** the threads as you go. See `skills/address-pr-review-comments.md` for the reply-then-resolve playbook using `gh api graphql` + the `resolveReviewThread` mutation, and the Windows Git Bash path-mangling workaround.
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

## Cross-agent skills (`skills/`)

Workflow-specific playbooks that any agent (Claude Code, GitHub Copilot, Cursor, Aider, codex, …) can read on demand. Each file is markdown with optional YAML frontmatter — no tooling required.

- **`skills/prepare-release.md`** — cut a new versioned release (bump, tag, push, watch the Release workflow).
- **`skills/add-vs-code-command.md`** — register a new `Isabelle:` command in the palette, wire the handler, and add a structural test.
- **`skills/address-pr-review-comments.md`** — fetch unresolved threads, reply, and resolve via GraphQL (includes the Windows `gh api` direct-call fallback for Git Bash path mangling).

Add new skills as `skills/<kebab-case-name>.md` and update the index in `skills/README.md`.

## Copilot CLI extension (`.github/extensions/isabelle-pide-helpers/`)

Optional, **Copilot CLI-only**. Registers two repo-specific tools the agent can call:

- `isabelle_lint_walkthrough` — verifies `media/walkthrough/*.md` `command:` links resolve to real `package.json` commands and flags drift-prone counts like "52 commands".
- `isabelle_check_setup` — probes the local toolchain (Node, Java, sbt, Isabelle, `code`/`code-insiders`) and reports which Tier of changes are buildable.

Other agents safely ignore the `.github/extensions/` directory; nothing depends on the extension being loaded.

## Future agent enablement (not yet built)

The following ideas were considered for the current agent-enablement work and rejected for scope:

- **CI invariant on test count drift** — would catch sudden test-count drops in PRs. Useful but adds reviewer noise; defer.
- **Additional skills** — `add-pide-lsp-capability.md`, `add-new-setting.md`, `investigate-flaky-test.md`. Add as concrete need arises.

Open an issue with the `meta` label to discuss.
