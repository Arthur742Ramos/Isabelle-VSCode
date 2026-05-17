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
- Explorer-side **Isabelle Proof State** panel that follows the active theory cursor and renders structured placeholder proof-state data through the backend protocol. When the optional Isabelle language server (`isabelle.languageServer.enabled`) is `running`, the panel switches to a live PIDE state-panel: it sends `PIDE/state_init`, subscribes to `PIDE/state_output` filtered by the returned `state_id`, parses the cumulative Isabelle XML payload via the existing PIDE-XML parser, and shows an auto-update banner. The session is single-instance per panel (no per-cursor-move re-init), tears down via `PIDE/state_exit` on dispose, and falls back to the backend placeholder cleanly when the LSP leaves `running` or the session errors.
- Explorer-side **Isabelle Proof Outline** view that follows the active theory and groups command spans with proof steps.
- Command navigation helpers for moving to the next/previous Isabelle command and revealing the current command span.
- Conservative proof action palette for refreshing the proof-state panel, building the active session, or explicitly inserting `sorry`/`oops` without claiming verification.
- Explorer-side **Isabelle Sledgehammer** panel and commands with typed run/cancel protocol messages, current-command context, guarded proof insertion for future suggestions, a local run-history surface with replay of past requests, and a backend boundary that explicitly reports proof search as unavailable until Isabelle/PIDE integration exists. When the optional Isabelle language server (`isabelle.languageServer.enabled`) is `running`, the panel routes Sledgehammer runs through the upstream `PIDE/sledgehammer_request` LSP notification surface instead of the Scala backend, dispatches `PIDE/caret_update` first, parses the cumulative `PIDE/sledgehammer_output` Isabelle XML payload into typed message/sendback nodes, and renders them in a new "Prover output" section. Cancellation routes to `PIDE/sledgehammer_cancel` in LSP mode and stays on `sledgehammer/cancel` in backend mode. In LSP mode, the panel applies a per-URI quiescence gate (default 1500 ms since the last theory edit, configurable via `isabelle.sledgehammer.quiescenceDelayMs`) before dispatching so the first request after a recent edit does not reproducibly hit "Unknown proof context" while Isabelle is still processing; cancellation during the wait clears the queued dispatch without sending anything to the server. `Isabelle: Insert Sledgehammer Proof` round-trips through `PIDE/sledgehammer_sendback` → `PIDE/sledgehammer_insert` and applies the server-supplied insert position via `WorkspaceEdit`, preserving the existing document-version guard. If the LSP leaves the `running` state mid-run, the panel aborts the LSP-mode session and surfaces a failure so the user can retry. PIDE-backed proof search is now live in LSP mode; proof minimization remains future work.
- Conservative checked repair loop foundation that captures local diagnostics/proof context, previews unified-diff proposals without applying edits, and reruns the existing Isabelle build command over current workspace contents.
- Explorer-side **Isabelle Theory Graph** tree that builds a conservative dependency graph from discovered ROOT sessions plus parsed theory import headers, with a view-mode toggle that switches each theory between its forward `imports` and the local reverse `imported by` list, plus a `Show Theory Dependents` quick-pick driven from the active editor for local impact navigation.
- Explorer-side **Isabelle Theory Outline** tree that groups locally extracted theory entities (theorems, lemmas, definitions, datatypes, locales, etc.) for the active `.thy` editor, refreshes as command spans change, and reuses the existing reveal-command navigation. This is local syntax-only extraction from synchronized command spans and does **not** consume PIDE entity metadata.
- Optional Isabelle language server (experimental): the extension can spawn Isabelle's bundled `isabelle vscode_server` as an LSP child and route VS Code's standard PIDE-flavoured features (diagnostics, hover, definition, completion, document symbols) through it. Opt-in via `isabelle.languageServer.enabled`. Cross-platform (Linux, macOS, Windows wherever Isabelle runs). Reachability is verified before spawn; failures surface in the status bar and a dedicated output channel.
- Unit tests for protocol framing, request correlation, ROOT parsing, workspace session discovery, theory graph construction, build command generation, diagnostic parsing, semantic tokenization, repair request capture, patch preview safety, command-span extraction, document status summaries, language-server command construction, and proof-outline helpers.

The theory graph, theory outline, proof outline, document status surface, document symbols, local import links, and in-file definition navigation are local foundations that refresh from session discovery, `.thy` headers, synchronized command spans, and local syntax extraction; they are not live PIDE dependency, diagnostics, or semantic markup yet. The theory-graph reverse navigation is derived from the same parsed `.thy` headers and only reports importers that were locally discovered. This milestone does **not** implement PIDE document processing, live proof checking, PIDE semantic markup/entity metadata, live Sledgehammer proof search, minimization, automatic proof insertion from real suggestions, or automatic AI repair yet. Those require the Scala backend to integrate with Isabelle/PIDE internals rather than only invoking the Isabelle CLI or exposing safe placeholders. The proof actions are conservative affordances and the checked repair loop is local-only: they do not call external AI services, claim verification, or apply proposed edits automatically.

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

The extension can optionally relay an Isabelle session through Isabelle's own bundled language server, `isabelle vscode_server`. This is an opt-in seam toward milestones 4/5/7 (live PIDE document status, PIDE-flavoured semantic markup, and proof tooling): when enabled, the extension spawns the language server as a child process and routes LSP traffic (diagnostics, hover, definition, completion, document symbols) through `vscode-languageclient`.

Prerequisites:

- Isabelle 2019 or newer installed, with `isabelle` on `PATH` or set via `isabelle.executablePath`. The language server entry point is part of every supported Isabelle distribution (Linux, macOS, Windows via the bundled Cygwin layer).
- On Windows, the official Isabelle distribution ships its launcher as `isabelle.ps1`. The extension detects `.ps1`/`.psm1` paths and automatically invokes them via `powershell.exe -File <path>` so Node's `child_process.spawn` (which does not resolve `.ps1` via PATHEXT) does not ENOENT. No user configuration is required for this; simply pointing `isabelle.executablePath` at `isabelle.ps1` (or leaving the default if it resolves on `PATH`) works.
- A workspace that contains `.thy` files with `language: isabelle` (the default for this extension).

To enable:

1. Set `"isabelle.languageServer.enabled": true` (or run `Isabelle: Start Language Server`, which sets the workspace setting and starts the client).
2. The extension first runs `isabelle version` with a 10 s timeout to verify reachability. On failure (Isabelle missing, path wrong, timeout), the language client transitions to a `failed` state and surfaces the error in the `Isabelle Language Server` output channel and the status bar; no LSP child is spawned.
3. On success, the LSP child is started over stdio. Its connection state appears as a status-bar item (`Isabelle LSP: starting / running / stopping / failed`). Click it to see the latest snapshot, including the command line, Isabelle version line, and last error.
4. To stop, run `Isabelle: Stop Language Server` or set `"isabelle.languageServer.enabled": false`. `Isabelle: Restart Language Server` performs a clean stop/start cycle.
5. When both the CLI-build runner has published diagnostics and the language server is enabled and publishes diagnostics for the same file, VS Code keeps them in two separate `DiagnosticCollection` owners and aggregates them in the Problems panel. CLI-build diagnostics appear with the `Source` column set to `isabelle build`. LSP-published diagnostics carry whatever `source` label Isabelle's `vscode_server` includes (if any); that label is supplied by the server and may vary by Isabelle release, so it is not pinned by this extension. The structural separation between the two collections is verified by `test/lsp/diagnosticsCoexistence.test.ts`; the live Problems-panel behavior still requires a running VS Code session against an Isabelle install.

Settings:

- `isabelle.languageServer.enabled` — opt in to the language server (default: `false`).
- `isabelle.languageServer.extraArgs` — extra arguments passed to `isabelle vscode_server` (for example `["-L", "./isabelle.log"]`).
- `isabelle.languageServer.logVerbose` — when `true`, full LSP traffic is logged to a separate `Isabelle Language Server Trace` output channel (helpful for debugging; noisy).

Honest disclaimer: when the language server is enabled, VS Code aggregates results from **both** the LSP-provided features and the extension's existing local syntax-only providers (semantic tokens, hover, document symbols, in-file definitions, document links, theory outline, status decorations, etc.). The local foundation is intentionally left in place so the existing milestone-3/5/7 behavior remains the default whenever the language server is off or unavailable. Live PIDE-backed document status, structured proof state, Sledgehammer proof search, and AI repair verification still require the Scala backend work outlined in the roadmap.

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

For a packaged extension, `npm run package:validate` builds and includes `backend/dist/isabelle-vscode-server.jar`. You can still override `isabelle.backend.command` to use another backend launcher or place an `isabelle-vscode-server` launcher on `PATH`. The extension runs as a workspace extension so the backend starts near the workspace files in remote or container development.

## Roadmap

The high-level roadmap is:

1. Skeleton: extension activation, backend launch, health/version protocol.
2. Session discovery: ROOT/ROOTS/AFP discovery, active session selection, theory tree.
3. Build integration: `isabelle build`, streamed output, clickable diagnostics.
4. PIDE document connection: live edits, local command spans, and a local status surface exist; PIDE status updates and diagnostics remain future work.
5. Semantic markup: local hovers, navigation, semantic tokens, and document symbols exist; PIDE entity metadata remains future work.
6. Proof state panel: cursor-aware structured goals/context.
7. Sledgehammer workflow surface: typed run/cancel boundary and guarded proof insertion; PIDE-backed proof search and minimization remain future work.
8. Theory graph and proof-engineering tools.
9. Checked AI repair loop that only reports success after Isabelle verifies the patch.

Motto: VS Code for UI, Isabelle/Scala for semantics, Isabelle/ML for truth.

The Scala backend exposes a `PideBridge` trait (with a default `LocalSyntaxPideBridge` that preserves today's command-span-and-disclaimer behavior) so milestones 4, 5, and 7's PIDE-backed document status, entity metadata, structured proof state, and Sledgehammer proof search plug into a clear interface without changing the JSON-RPC protocol or the VS Code extension.

See [docs/PIDE_INTEGRATION.md](docs/PIDE_INTEGRATION.md) for the chosen LSP-relay approach (run Isabelle's bundled `isabelle vscode_server` as an opt-in child language server, additive to the Scala backend and the `PideBridge` seam), the runtime prerequisites, and the capability roll-out plan for milestones 4, 5, and 7. The opt-in `isabelle.languageServer.enabled` setting (default `false`) and the LSP client itself shipped in PR #26 and PR #27; the capability checklist in that document tracks the per-feature wiring still to land.
