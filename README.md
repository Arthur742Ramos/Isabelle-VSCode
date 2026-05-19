# Isabelle PIDE for VS Code

This repository is becoming a modern Isabelle/PIDE frontend for VS Code. The target architecture is deliberately more than a syntax-highlighting or build-on-save extension:

```text
VS Code Extension (TypeScript)
  -> custom protocol client, commands, panels, decorations
Scala Backend
  -> Isabelle-facing session, PIDE, tool, and build bridge
Isabelle/PIDE
  -> the semantic source of truth
```

The current foundation establishes the extension/backend boundary and keeps future PIDE work explicit instead of pretending it already exists.

## Installation

The extension is not yet on the VS Code Marketplace. For now, install it via one of the two paths below.

### Runtime prerequisites

| Install path | Java 21+ runtime | Isabelle 2019+ |
| --- | --- | --- |
| **Per-platform `.vsix`** from GitHub Releases (Option 1, recommended) | **Bundled** — no install needed | Required for build / language-server / sledgehammer features |
| **Universal `.vsix`** from GitHub Releases (Option 1, fallback) | You provide it on `PATH` | Required for build / language-server / sledgehammer features |
| **Build from source** (Option 2) | You provide it on `PATH` (the `sbt assembly` step needs it) | Required for build / language-server / sledgehammer features |

If you need to install Java yourself, any vendor's Java 21 works:

| OS | Java 21+ | Isabelle 2019+ |
| --- | --- | --- |
| **Windows** | `winget install Microsoft.OpenJDK.21` | Installer from [isabelle.in.tum.de](https://isabelle.in.tum.de/installation.html) |
| **macOS** | `brew install --cask temurin@21` | Installer from [isabelle.in.tum.de](https://isabelle.in.tum.de/installation.html) (`brew install --cask isabelle` if you prefer Homebrew) |
| **Debian / Ubuntu** | `sudo apt install openjdk-21-jdk` | Tarball from [isabelle.in.tum.de](https://isabelle.in.tum.de/installation.html) |
| **Fedora / RHEL** | `sudo dnf install java-21-openjdk` | Tarball from [isabelle.in.tum.de](https://isabelle.in.tum.de/installation.html) |
| **Arch** | `sudo pacman -S jdk21-openjdk` | AUR (`isabelle`) or tarball from [isabelle.in.tum.de](https://isabelle.in.tum.de/installation.html) |

After installing Isabelle, either put `isabelle` on `PATH` or set the `isabelle.executablePath` setting. On Windows the launcher is `isabelle.ps1`; the extension wraps it via `powershell.exe -File` automatically.

The extension activates without either prerequisite (basic syntax features still work), but the **`Isabelle: Check Setup Prerequisites`** command and the **Get started with Isabelle PIDE** walkthrough will guide you through any missing piece, and standard install paths are auto-detected.

### Option 1 — Install a pre-built `.vsix` from GitHub Releases (recommended for end-users)

> Available once the first `v*` tag has been pushed and the [Release workflow](.github/workflows/release.yml) has run. Check the [Releases page](https://github.com/Arthur742Ramos/Isabelle-VSCode/releases) — if it is empty, use Option 2.

1. Open the [Releases page](https://github.com/Arthur742Ramos/Isabelle-VSCode/releases) and pick the asset matching the **host where the extension will run** (for SSH-Remote / WSL / dev-container setups, this is the remote host's OS + CPU, not your laptop's):

   | Asset suffix | Host platform | Java bundled |
   | --- | --- | --- |
   | `-win32-x64.vsix` | Windows x64 | ✅ |
   | `-win32-arm64.vsix` | Windows on ARM | ✅ |
   | `-linux-x64.vsix` | Linux x64 (glibc) | ✅ |
   | `-linux-arm64.vsix` | Linux ARM64 (glibc) | ✅ |
   | `-alpine-x64.vsix` | Alpine / musl x64 | ✅ |
   | `-alpine-arm64.vsix` | Alpine / musl ARM64 | ✅ |
   | `-darwin-arm64.vsix` | macOS Apple silicon | ✅ |
   | *(no suffix)* `isabelle-pide-vscode-<version>.vsix` | Universal (other platforms, bring-your-own-Java) | ❌ |

   **macOS Intel:** dropped from the per-platform matrix as of v0.1.0-alpha.3. The universal `isabelle-pide-vscode-<version>.vsix` (Java 21+ on PATH required) works on macOS Intel. See AGENTS.md §17 for rationale.

2. Install it in VS Code using either:
   - **GUI** — open the **Extensions** view, click the `…` menu in its title bar, choose **Install from VSIX…**, and pick the downloaded file; or
   - **Command line** — run
     ```powershell
     code --install-extension isabelle-pide-vscode-<version>-<target>.vsix
     ```
3. Reload VS Code if prompted.

> Per-platform builds embed Eclipse Temurin 21 under `extension/jre/`. See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for the bundled-JRE license summary.
>
> **macOS Gatekeeper:** if launching the extension produces *"Apple cannot check it for malicious software"* warnings for files under `extension/jre/`, clear the quarantine flag with:
> ```bash
> xattr -dr com.apple.quarantine ~/.vscode/extensions/arthur742ramos.isabelle-pide-vscode-*/extension/jre
> ```

### Option 2 — Build and install from source (one command)

Prerequisites: **Node.js 20+**, **Java 21**, **sbt**, plus the `code` CLI on `PATH` (in VS Code, run `Shell Command: Install 'code' command in PATH` from the Command Palette).

```powershell
git clone https://github.com/Arthur742Ramos/Isabelle-VSCode.git
cd Isabelle-VSCode
npm install
npm run install:extension
```

`npm run install:extension` compiles the TypeScript, bundles it with esbuild, builds the Scala backend as a fat jar via `sbt assembly`, packages everything into `isabelle-pide-vscode.vsix`, and installs it into your local VS Code via `code --install-extension`. Use the same command to re-install after pulling changes.

If you only want the `.vsix` (for example to share with a teammate), run `npm run package` instead — it produces `isabelle-pide-vscode.vsix` without installing it. Source builds produce the **universal** flavor (no JRE bundled); per-platform `.vsix` files come from the CI release workflow.

### Option 3 — VS Code Marketplace

Not yet. See [Roadmap](#roadmap). Until then, use Option 1 or 2.

## Current milestone

Implemented foundation:

- VS Code extension scaffold that activates for Isabelle `.thy` files.
- Commands:
  - `Isabelle: Show Version`
  - `Isabelle: Check Backend Health`
  - `Isabelle: Discover Sessions`
  - `Isabelle: Refresh Sessions`
  - `Isabelle: Select Active Session`
  - `Isabelle: Build Active Session`
  - `Isabelle: Cancel Build`
  - `Isabelle: Resynchronize Open Theories`
  - `Isabelle: Show Document Status`
  - `Isabelle: Refresh Proof Outline`
  - `Isabelle: Refresh Proof State`
  - `Isabelle: Go to Next Command`
  - `Isabelle: Go to Previous Command`
  - `Isabelle: Reveal Current Command`
  - `Isabelle: Proof Actions`
  - `Isabelle: Run Sledgehammer`
  - `Isabelle: Cancel Sledgehammer`
  - `Isabelle: Insert Sledgehammer Proof`
  - `Isabelle: Pick Sledgehammer Suggestion to Insert`
  - `Isabelle: Replay Sledgehammer Run`
  - `Isabelle: Clear Sledgehammer History`
  - `Isabelle: Create Checked Repair Request`
  - `Isabelle: Copy Checked Repair Request to Clipboard`
  - `Isabelle: Request AI Repair Suggestion (Experimental)`
  - `Isabelle: Set AI Repair Provider Secret`
  - `Isabelle: Clear AI Repair Provider Secret`
  - `Isabelle: Preview Repair Patch`
  - `Isabelle: Check Current Workspace for Repair`
  - `Isabelle: Refresh Theory Graph`
  - `Isabelle: Show Theory Dependents`
  - `Isabelle: Toggle Theory Graph Direction`
  - `Isabelle: Refresh Theory Outline`
  - `Isabelle: Start Language Server`
  - `Isabelle: Stop Language Server`
  - `Isabelle: Restart Language Server`
  - `Isabelle: Show Language Server Status`
  - `Isabelle: Browse Isabelle Documentation`
  - `Isabelle: Preview Theory`
  - `Isabelle: Preview Theory in Split`
  - `Isabelle: Include Word in Spell-Checker (Session)`
  - `Isabelle: Include Word in Spell-Checker (Permanent)`
  - `Isabelle: Exclude Word from Spell-Checker (Session)`
  - `Isabelle: Exclude Word from Spell-Checker (Permanent)`
  - `Isabelle: Reset Spell-Checker Session Words`
  - `Isabelle: Toggle Proof State Auto-Update`
  - `Isabelle: Re-anchor Proof State to Cursor`
  - `Isabelle: Check Setup Prerequisites`
  - `Isabelle: Explain Current Mode`
- `Content-Length` framed JSON-RPC-style protocol with request IDs and a protocol version.
- Backend process manager with stderr routed to the Isabelle PIDE output channel.
- Scala backend skeleton with `server/health`, `isabelle/version`, and backend-backed `session/discover`.
- Conservative ROOT/ROOTS parser and workspace discovery for local sessions, available through the Scala backend with TypeScript local fallback if backend startup fails.
- Explorer-side **Isabelle Sessions** tree with session, imported-session, theory, and document-file entries.
- Active session persistence through `isabelle.session.active`.
- Isabelle CLI build runner for the active session with streamed output, cancellation, and Problems diagnostics for common source-location formats.
- Document synchronization bridge for opening, updating, and closing Isabelle theory documents through the Scala backend.
- Scala backend document state with conservative command-span extraction as a placeholder for future PIDE spans.
- Scala backend `PideBridge` seam with a default local-syntax implementation; a future real PIDE bridge can plug in without protocol changes.
- Status-bar document status surface that summarizes synchronized/local command spans and the current command with an explicit local syntax-only label; it does not publish Isabelle diagnostics. Editor decorations also mark each synchronized command span with its local-only status (pending/running/finished/failed/unknown), derived from the same local command-span source rather than PIDE processing. When the optional Isabelle language server is enabled and `running`, these local-only decorations are suppressed in favor of the LSP's own published diagnostics — the local dashed-border "pending" gutter would otherwise misrepresent the source of the per-command processing/error information shown to the user.
- Local semantic-rendering foundation with Isabelle command/declaration/symbol semantic tokens, basic command/symbol hovers, document symbols, local import links, and in-file go-to-definition for locally parsed declarations.
- Explorer-side **Isabelle Proof State** panel that follows the active theory cursor and renders structured placeholder proof-state data through the backend protocol. When the optional Isabelle language server (`isabelle.languageServer.enabled`) is `running`, the panel switches to a live PIDE state-panel: it sends `PIDE/state_init`, subscribes to `PIDE/state_output` filtered by the returned `state_id`, parses the cumulative Isabelle XML payload via the existing PIDE-XML parser, and shows an auto-update banner. Alongside the main state, the panel also subscribes to `PIDE/dynamic_output` (the upstream caret-driven message stream, no id) and renders the latest snapshot as a secondary "Dynamic output (caret-driven)" section that hides itself when empty. Both sessions are single-instance per panel (no per-cursor-move re-init), tear down via `PIDE/state_exit` on dispose, and fall back to the backend placeholder cleanly when the LSP leaves `running` or the session errors.
- Explorer-side **Isabelle Proof Outline** view that follows the active theory and groups command spans with proof steps.
- Command navigation helpers for moving to the next/previous Isabelle command and revealing the current command span.
- Conservative proof action palette for refreshing the proof-state panel, building the active session, or explicitly inserting `sorry`/`oops` without claiming verification.
- Explorer-side **Isabelle Sledgehammer** panel and commands with typed run/cancel protocol messages, current-command context, guarded proof insertion for future suggestions, and a local run-history surface with replay of past requests. The panel chooses between two PIDE-backed routes at runtime. **LSP mode** (`isabelle.languageServer.enabled` is `running`): the panel routes Sledgehammer runs through the upstream `PIDE/sledgehammer_request` LSP notification surface, dispatches `PIDE/caret_update` first, parses the cumulative `PIDE/sledgehammer_output` Isabelle XML payload into typed message/sendback nodes, and renders them in a "Prover output" section. **Backend mode** (LSP off or unavailable): the panel sends `sledgehammer/run` to the Scala backend, which since PR #81 runs real Sledgehammer through the Headless `PideBridge` (source-injects `sledgehammer` at the cursor, submits via `Headless.Session.use_theories`, harvests "Try this:" output via `snapshot.messages`) — so proof search works whether or not the LSP is running, provided the backend can bootstrap PIDE (working Isabelle + Java). The backend route only reports "unavailable" when it genuinely cannot bootstrap PIDE (no Isabelle install, missing Scala 3 runtime in `contrib/scala-*/`, etc.). Cancellation routes to `PIDE/sledgehammer_cancel` in LSP mode and `sledgehammer/cancel` (which tears down the in-flight Headless `Session.stop()` per AGENTS.md §13) in backend mode. In LSP mode, the panel applies a per-URI quiescence gate (default 1500 ms since the last theory edit, configurable via `isabelle.sledgehammer.quiescenceDelayMs`) before dispatching so the first request after a recent edit does not reproducibly hit "Unknown proof context" while Isabelle is still processing; cancellation during the wait clears the queued dispatch without sending anything to the server. `Isabelle: Insert Sledgehammer Proof` round-trips through `PIDE/sledgehammer_sendback` → `PIDE/sledgehammer_insert` (LSP mode) or applies the parsed sendback directly via `WorkspaceEdit` (backend mode), preserving the existing document-version guard. If the LSP leaves the `running` state mid-run, the panel aborts the LSP-mode session and surfaces a failure so the user can retry. Proof minimization is live via the Scala backend's Headless `PideBridge` (`Isabelle: Minimize Sledgehammer Proof at Cursor`, PR #82) and works whether the LSP is enabled or not.
- Conservative checked repair loop foundation that captures local diagnostics/proof context, previews unified-diff proposals without applying edits, and reruns the existing Isabelle build command over current workspace contents.
- Explorer-side **Isabelle Theory Graph** tree that builds a conservative dependency graph from discovered ROOT sessions plus parsed theory import headers, with a view-mode toggle that switches each theory between its forward `imports` and the local reverse `imported by` list, plus a `Show Theory Dependents` quick-pick driven from the active editor for local impact navigation.
- Explorer-side **Isabelle Theory Outline** tree that groups locally extracted theory entities (theorems, lemmas, definitions, datatypes, locales, etc.) for the active `.thy` editor, refreshes as command spans change, and reuses the existing reveal-command navigation. This is local syntax-only extraction from synchronized command spans and does **not** consume PIDE entity metadata.
- Optional Isabelle language server (experimental): the extension can spawn Isabelle's bundled `isabelle vscode_server` as an LSP child and route VS Code's standard PIDE-flavoured features (diagnostics, hover, definition, completion, document symbols) through it. Opt-in via `isabelle.languageServer.enabled`. Cross-platform (Linux, macOS, Windows wherever Isabelle runs). Reachability is verified before spawn; failures surface in the status bar and a dedicated output channel.
- PIDE-flavoured editor decoration overlay (LSP-mode): when the optional Isabelle language server is `running`, the extension subscribes to the upstream `PIDE/decoration` notification and overlays the editor with the per-URI `text_<color>` ranges that `isabelle vscode_server` publishes (keywords, free/bound variables, type parameters, inner-syntax literals, errors, deprecation, etc.). The overlay sends `PIDE/decoration_request` for newly visible Isabelle theories so the server re-emits, layers cleanly on top of the local semantic-tokens foundation, and tears down (clearing all painted decorations and the per-URI cache) when the LSP leaves `running`.
- Isabelle symbol abbreviation completion (LSP-mode): when the optional Isabelle language server is `running`, the extension dispatches `PIDE/abbrevs_request`, caches the `PIDE/abbrevs_response` table (pairs like `\<lambda>` → `λ`, `==>` → `⟹`, `[|` → `⟦`), and exposes them as a VS Code completion provider on Isabelle `.thy` documents. The provider walks backward from the cursor to find the longest typed prefix that begins at least one known abbreviation, then offers each matching expansion as a completion item with the abbreviation as the filter text. Trigger characters are derived from the cached abbreviations at registration time, and the provider re-registers when the cache refreshes. When the LSP is not `running` the cache stays empty, so no abbreviation suggestions appear and there is no risk of stale data.
- Isabelle documentation browser (LSP-mode): the `Isabelle: Browse Isabelle Documentation` command consults a cached `PIDE/documentation_response` table maintained by `PideDocumentationCache` (it dispatches `PIDE/documentation_request` on each LSP `running` transition), surfaces the available manuals (Tutorial, Isar-Ref, Sledgehammer, etc.) in a quick-pick ranked with Isabelle's own `important` sections first, and opens the selected entry's `platform_path` with the OS's default application via `vscode.env.openExternal`. When the LSP is not running, the command surfaces an informational message instead of opening anything.
- Live theory preview (LSP-mode): the `Isabelle: Preview Theory` (and split-pane variant `Isabelle: Preview Theory in Split`) commands send `PIDE/preview_request { uri, column }` for the active `.thy` editor and render the server's `PIDE/preview_response` HTML body in a single shared webview panel with a strict Content-Security-Policy. The panel re-paints automatically every time the server pushes a fresh snapshot, so editing a theory in the source pane updates the rendered preview in the adjacent pane. Empty server snapshots are filtered so the panel does not flash back to a loading placeholder.
- Spell-checker dictionary commands (LSP-mode): five commands (`Isabelle: Include / Exclude Word (Session / Permanent)` and `Isabelle: Reset Spell-Checker Session Words`) push the upstream `PIDE/include_word`, `PIDE/include_word_permanently`, `PIDE/exclude_word`, `PIDE/exclude_word_permanently`, and `PIDE/reset_words` notifications. The include/exclude variants first send a fresh `PIDE/caret_update` so the server resolves the word at the user's caret rather than wherever a stale background caret update was last pushed; the reset variant is global and skips the caret update.
- Proof state panel controls (LSP-mode): three new user-facing controls map onto the upstream `PIDE/state_*` and `PIDE/output_set_margin` notifications the proof state panel already supports internally. Settings: `isabelle.proofState.autoUpdate` (default `true`, mirrors upstream `state_panel.scala`), `isabelle.proofState.margin` (pretty-printer margin for the main state, default 80, clamped 20–400), `isabelle.dynamicOutput.margin` (pretty-printer margin for the caret-driven dynamic output sub-panel, default 80). Commands: `Isabelle: Toggle Proof State Auto-Update` (flips the setting and forwards `PIDE/state_auto_update`) and `Isabelle: Re-anchor Proof State to Cursor` (sends `PIDE/state_locate` to re-anchor the panel without restarting it). Settings changes are picked up live without requiring a workspace reload.
- Unit tests for protocol framing, request correlation, ROOT parsing, workspace session discovery, theory graph construction, build command generation, diagnostic parsing, semantic tokenization, repair request capture, patch preview safety, command-span extraction, document status summaries, language-server command construction, proof-outline helpers, and the PIDE decoration parser + apply-policy helpers.

The theory graph, theory outline, proof outline, document status surface, document symbols, local import links, and in-file definition navigation are local foundations that refresh from session discovery, `.thy` headers, synchronized command spans, and local syntax extraction. The theory-graph reverse navigation is derived from the same parsed `.thy` headers and only reports importers that were locally discovered. The Scala backend now ships a **real `PideBridge` implementation** wired to Isabelle's Headless API (Phases 1–5, PRs #74–#82) — it powers `Isabelle: Show PIDE Document Status`, `Isabelle: Show PIDE Proof State at Cursor`, the PIDE-backed Sledgehammer pipeline, and `Isabelle: Minimize Sledgehammer Proof at Cursor`, all without going through the LSP relay. The default `LocalSyntaxPideBridge` still exists as a fallback when the real bridge cannot bootstrap (e.g. no Isabelle install), and proof actions stay conservative affordances that do not claim verification. Real PIDE behavior is also delivered through the optional Isabelle LSP relay (see "Isabelle language server" below): when `isabelle.languageServer.enabled` is `running`, diagnostics, hover/definition/completion, the `PIDE/decoration` overlay, the proof state panel, dynamic output, Sledgehammer, live theory preview, abbreviation completion, the documentation browser, and spell-checker dictionary commands all route through that LSP. The two paths are additive — `Isabelle: Minimize Sledgehammer Proof at Cursor` (PideBridge) works whether the LSP is on or off, and LSP-mode Sledgehammer (`Isabelle: Run Sledgehammer`) covers proof search while the LSP is `running`. The checked AI repair loop never auto-applies edits and never calls a third-party network service without explicit per-provider opt-in (see [docs/AI_REPAIR.md](docs/AI_REPAIR.md)). See [docs/ROADMAP_STATUS.md](docs/ROADMAP_STATUS.md) for the current shipped / open / upstream-blocked breakdown.

## Checked repair workflow

The checked repair commands provide a conservative local foundation for future proof-repair tooling:

1. Run `Isabelle: Create Checked Repair Request` from an Isabelle theory. The extension captures the active document URI/path/version, cursor position, VS Code diagnostics, and the current proof-state response if the backend can provide one. It opens an untitled Markdown request that you can review and save manually.
2. Save a proposed repair as a unified diff, then run `Isabelle: Preview Repair Patch`. The extension reads the patch locally, rejects unsafe shapes such as added/deleted files, renames, binary diffs, absolute paths, path traversal, unsupported newline markers, dirty target documents, and mismatched context, then opens readonly VS Code diff previews plus a local Markdown verification plan with active-session build details when available.
3. If you trust a preview, apply the edit manually. The extension intentionally never writes patch contents for you.
4. Run `Isabelle: Check Current Workspace for Repair` or the exact build command shown in the verification plan. This reruns the existing active-session build over the current workspace files. It does **not** validate a readonly preview unless you have manually applied those edits first, and the extension does not report a repair as checked until that Isabelle build succeeds.

Repair requests may include source excerpts, diagnostics, and proof-state details. Review them before sharing outside your workspace.

Two additional, additive entry points sit on top of the same local request bundle:

- `Isabelle: Copy Checked Repair Request to Clipboard` puts the same Markdown bundle on the clipboard so you can paste it into any AI tool you already trust. No network call is made.
- `Isabelle: Request AI Repair Suggestion (Experimental)` delegates the bundle to an extension-registered AI provider. The extension ships **no default provider**. Even when a provider is registered, the command refuses to call it until both `isabelle.repair.aiProvider` and `isabelle.repair.aiAcknowledgedSharing` are set — the second is the explicit acknowledgement that the provider will receive the full repair request. Any patch a provider returns is opened for review and still has to go through `Isabelle: Preview Repair Patch` before any edit is applied. See [docs/AI_REPAIR.md](docs/AI_REPAIR.md) for the full safety contract and provider registration shape.

## Isabelle language server

The extension can run Isabelle's bundled `isabelle vscode_server` as a child language server and route PIDE-flavoured LSP traffic (diagnostics, hover, definition, completion, document symbols, decorations, sledgehammer, theory preview, …) through `vscode-languageclient`.

**By default, the language server auto-starts whenever the activation-time prerequisite check finds a working Java 21+ runtime and a reachable Isabelle 2019+.** On a fresh install with Isabelle on PATH, you get the rich PIDE experience with **zero configuration**. On a machine without Isabelle, the activation toast guides you to the [setup walkthrough](#installation) and the LSP stays off until prerequisites are met.

Prerequisites:

- Isabelle 2019 or newer installed, with `isabelle` on `PATH` or set via `isabelle.executablePath`. The language server entry point is part of every supported Isabelle distribution (Linux, macOS, Windows via the bundled Cygwin layer).
- On Windows, the official Isabelle distribution ships its launcher as `isabelle.ps1`. The extension detects `.ps1`/`.psm1` paths and automatically invokes them via `powershell.exe -File <path>` so Node's `child_process.spawn` (which does not resolve `.ps1` via PATHEXT) does not ENOENT. No user configuration is required for this; simply pointing `isabelle.executablePath` at `isabelle.ps1` (or leaving the default if it resolves on `PATH`) works.
- A workspace that contains `.thy` files with `language: isabelle` (the default for this extension).

Lifecycle:

1. On activation the extension runs a non-blocking prerequisite probe (`java -version`, `isabelle version`) with short timeouts.
2. If both succeed and `isabelle.languageServer.enabled` has not been explicitly set, the LSP auto-starts and writes a one-line note to the `Isabelle PIDE` output channel.
3. The LSP's connection state appears as a status-bar item (`Isabelle LSP: starting / running / stopping / failed`). Click it for the latest snapshot, including the command line, Isabelle version line, and last error.
4. If an auto-start fails, the failure is remembered **per resolved Isabelle runtime** (executable path + extra args) so the extension does not retry the same broken configuration on every activation. Change `isabelle.executablePath` or `isabelle.languageServer.extraArgs` to clear the failure flag, or run `Isabelle: Start Language Server` to retry.
5. Run `Isabelle: Stop Language Server` to stop a running LSP, or `Isabelle: Restart Language Server` to perform a clean stop/start cycle.
6. When both the CLI-build runner and the LSP publish diagnostics for the same file, VS Code aggregates them in the Problems panel. CLI-build diagnostics appear with the `Source` column set to `isabelle build`; LSP diagnostics carry whatever `source` label `isabelle vscode_server` includes.

Overrides:

- **Force the LSP on**, regardless of detection — set `"isabelle.languageServer.enabled": true`.
- **Force the LSP off**, even when Isabelle is reachable — set `"isabelle.languageServer.enabled": false`.
- **Disable auto-start globally** but keep the explicit override working — set `"isabelle.languageServer.autoStart": false`.

Settings:

- `isabelle.languageServer.enabled` — explicit override. When unset (the default), see `autoStart`. When `true`, the LSP starts regardless of detection. When `false`, the LSP stays off even when Isabelle is reachable.
- `isabelle.languageServer.autoStart` — auto-start the LSP on detection when `enabled` is unset (default: `true`).
- `isabelle.languageServer.extraArgs` — extra arguments passed to `isabelle vscode_server` (for example `["-L", "./isabelle.log"]`).
- `isabelle.languageServer.logVerbose` — when `true`, full LSP traffic is logged to a separate `Isabelle Language Server Trace` output channel (helpful for debugging; noisy).

Honest disclaimer: when the language server is running, VS Code aggregates results from **both** the LSP-provided features and the extension's existing local syntax-only providers (semantic tokens, hover, document symbols, in-file definitions, document links, theory outline, status decorations, etc.). The local foundation is intentionally left in place so the existing local behavior remains the default whenever the language server is off or unavailable. Live PIDE-backed document status, structured proof state, Sledgehammer proof search, and AI repair verification still require the Scala backend work outlined in the roadmap.

## Contributing

- **Humans:** start with [`CONTRIBUTING.md`](CONTRIBUTING.md) for the quick-start and PR checklist.
- **AI coding agents** (Copilot CLI, GitHub Copilot Coding Agent, Claude Code, Cursor, Aider, …): read [`AGENTS.md`](AGENTS.md) — it documents the architecture map, validation matrix, repo conventions (TS strict, vscode-free structural tests, conventional commits, `windowsHide: true` for spawns), and the gotchas that have bitten previous contributors (workflow-scope OAuth pushes, fat-jar packaging, `.ps1` launcher handling on Windows). [`.github/copilot-instructions.md`](.github/copilot-instructions.md) is the compact pointer file GitHub Copilot reads automatically.
- The GitHub Copilot Coding Agent boots into a pre-configured environment via [`.github/workflows/copilot-setup-steps.yml`](.github/workflows/copilot-setup-steps.yml) (Node 20, Java 21, sbt, `npm ci`).

## Development

Install dependencies:

```powershell
npm install
```

Compile and test the extension code:

```powershell
npm run check
```

Validate the VS Code extension package contents after compiling, testing, and packaging the bundled Scala backend jar:

```powershell
npm run package:validate
```

Produce a redistributable `.vsix` (compiles, bundles with esbuild, builds the backend fat jar via `sbt assembly`, and packages everything):

```powershell
npm run package
```

Produce that same `.vsix` **and** install it into your local VS Code in one shot:

```powershell
npm run install:extension
```

Compile the Scala backend if `sbt` is available:

```powershell
npm run backend:compile
```

Run the Scala backend unit tests if `sbt` is available:

```powershell
npm run backend:test
```

Run the backend during extension development:

```powershell
npm run backend:run
```

Then configure VS Code:

```json
{
  "isabelle.backend.command": "sbt",
  "isabelle.backend.args": [
    "-Dsbt.supershell=false",
    "-Dsbt.log.noformat=true",
    "backend/run"
  ],
  "isabelle.executablePath": "isabelle"
}
```

For a packaged extension, `npm run package` (or `npm run install:extension` for one-step local install) builds and includes `backend/dist/isabelle-vscode-server.jar` as a fat jar runnable with plain `java -jar`. You can still override `isabelle.backend.command` to use another backend launcher or place an `isabelle-vscode-server` launcher on `PATH`. The extension runs as a workspace extension so the backend starts near the workspace files in remote or container development.

## Roadmap

For the consolidated current status of every milestone (what is shipped, what remains, what is upstream-blocked), see [docs/ROADMAP_STATUS.md](docs/ROADMAP_STATUS.md). For the end-to-end manual verification gate every release should pass, see [docs/SMOKE_THEORY_CHECKLIST.md](docs/SMOKE_THEORY_CHECKLIST.md) (driven by the [`examples/Smoke.thy`](examples/Smoke.thy) theory).

The high-level roadmap is:

1. Skeleton: extension activation, backend launch, health/version protocol.
2. Session discovery: ROOT/ROOTS/AFP discovery, active session selection, theory tree.
3. Build integration: `isabelle build`, streamed output, clickable diagnostics.
4. PIDE document connection: live edits, local command spans, a local status surface, AND (when the optional Isabelle language server is `running`) live LSP diagnostics that coexist with CLI-build diagnostics on separate `DiagnosticCollection` owners.
5. Semantic markup: local hovers, navigation, semantic tokens, and document symbols are the always-on foundation; when the LSP is `running`, hover / definition / completion / `PIDE/decoration` overlay / abbreviation completion / documentation browser / live theory preview / spell-checker dictionary commands all route through it. `textDocument/documentSymbol` remains upstream-blocked.
6. Proof state panel: cursor-aware structured goals/context, LSP-backed via `PIDE/state_init` + `PIDE/state_output` + dynamic-output sub-surface, with auto-update / margin / re-anchor user controls.
7. Sledgehammer workflow: PIDE-backed proof search live in LSP mode (via `PIDE/sledgehammer_request` + sendback insert flow with quiescence gate); proof minimization shipped via the Scala backend's Headless `PideBridge` route (`Isabelle: Minimize Sledgehammer Proof at Cursor`, PR #82) — the LSP-side `PIDE/sledgehammer_minimize*` surface remains upstream-blocked but is no longer user-visible.
8. Theory graph and proof-engineering tools.
9. Checked AI repair loop: capture diagnostics + proof context, opt-in third-party provider seam with strict diff preview, no auto-apply.

Motto: VS Code for UI, Isabelle/Scala for semantics, Isabelle/ML for truth.

The Scala backend exposes a `PideBridge` trait (with a default `LocalSyntaxPideBridge` that preserves today's command-span-and-disclaimer behavior) so milestones 4, 5, and 7's PIDE-backed document status, entity metadata, structured proof state, and Sledgehammer proof search plug into a clear interface without changing the JSON-RPC protocol or the VS Code extension.

See [docs/PIDE_INTEGRATION.md](docs/PIDE_INTEGRATION.md) for the chosen LSP-relay approach (run Isabelle's bundled `isabelle vscode_server` as an opt-in child language server, additive to the Scala backend and the `PideBridge` seam), the runtime prerequisites, and the capability roll-out plan for milestones 4, 5, and 7. The opt-in `isabelle.languageServer.enabled` setting (default `false`) and the LSP client itself shipped in PR #26 and PR #27; the capability checklist in that document tracks the per-feature wiring still to land.
