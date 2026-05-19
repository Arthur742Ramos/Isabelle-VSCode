# Tier-2 manual verification checklist

This checklist exercises every Tier-2 capability the extension advertises against `examples/Smoke.thy` — both the **LSP-mode** features (when `isabelle.languageServer.enabled` is `running`: diagnostics, hover, decorations, proof state, dynamic output, Sledgehammer search, preview, abbreviations, documentation browser, spell-checker dictionary commands) and the **Headless `PideBridge`** features (`Isabelle: Show PIDE Document Status`, `Isabelle: Show PIDE Proof State at Cursor`, `Isabelle: Minimize Sledgehammer Proof at Cursor` — these run through the Scala backend's real PIDE bridge and do **not** require the LSP). It exists because the structural test suite (see `npm run test` / CI for the current count — per AGENTS.md gotcha #7 we don't pin a number here) intentionally avoids importing `vscode` and cannot validate either live PIDE round-trip. See [`docs/ROADMAP_STATUS.md`](ROADMAP_STATUS.md) "Tier-2 manual verifications" for the master list this file expands on.

> **Why this file exists.** Per `AGENTS.md`, the test suite stays vscode-free by convention. That keeps unit-tests fast and CI cheap, but it means the end-to-end "did the extension actually wire up to Isabelle?" path is a human check. This file is that human check, in a form you can run on every release candidate.

## Prerequisites

- Isabelle 2025-2 (or 2024+) on `PATH`, OR the `isabelle.executablePath` setting pointing at the launcher.
- Java 21+ on `PATH`, OR a per-platform `.vsix` install (which bundles Temurin 21).
- The extension installed from a recent `.vsix` (`npm run install:extension` or a GitHub Release asset).
- `isabelle.languageServer.enabled` is set to `true`, OR is unset/`default` (the extension auto-starts the LSP when prerequisites are reachable; see [Known gotcha 8 in `AGENTS.md`](../AGENTS.md#8-lsp-auto-start-respects-explicit-overrides)).
- **A VS Code workspace that includes the bundled `examples/` directory** (open the repo root, or add `examples/` as a folder in a multi-root workspace). The bundled `examples/ROOT` defines session `Isabelle_VSCode_Smoke` containing `Smoke`, which makes the build / proof-state / Sledgehammer steps below run against a real session out of the box.

## Quick dogfood transcript

Use this as the **single happy path** every release should pass. The full per-capability checklist follows.

1. Open the repo (or any workspace containing `examples/`) in VS Code. Open `examples/Smoke.thy`.
2. Click the **Isabelle: no active session** status-bar item and pick `Isabelle_VSCode_Smoke` (defined by the bundled `examples/ROOT`). The status bar should switch to **Isabelle: Isabelle_VSCode_Smoke**.
3. Wait for the status bar to show **Isabelle LSP: running** (or use `Isabelle: Show Language Server Status` to confirm). For a fuller picture, run `Isabelle: Explain Current Mode` — it prints whether PIDE features are available and, if not, exactly why.
4. Place the cursor on the `sorry` in `conj_commute_smoke`.
5. **Sledgehammer panel:** run `Isabelle: Run Sledgehammer`. Wait for "Prover output" to render at least one suggestion (typically `blast` / `metis`).
6. Run `Isabelle: Insert Sledgehammer Proof` to replace `sorry` with the suggestion. Confirm the file compiles (no Problems panel entries).
7. **Build:** run `Isabelle: Build Active Session`. Confirm the output channel scrolls and the build succeeds against `Isabelle_VSCode_Smoke`.
8. **Preview:** run `Isabelle: Preview Theory in Split`. Confirm the rendered HTML matches the source and updates as you type.
9. **Minimize:** after step 6 left an inserted proof body like `by (metis ...)` on the lemma, run `Isabelle: Minimize Sledgehammer Proof at Cursor`. Confirm a minimized variant comes back (or the same body if Sledgehammer cannot shrink it further).

If all nine steps work cleanly, the alpha is healthy enough to share.

> **If anything fails:** run `Isabelle: Explain Current Mode` first. It is the single most efficient way to identify whether the cause is a missing prerequisite, an LSP that never started, a deliberately disabled language server, or a stale auto-start failure key. Most "the extension doesn't work" reports turn out to be one of those four.

## Capability-by-capability checklist

Tick each box as you verify. Open an issue with the `manual-verification` label if any step regresses.

### M4 — PIDE document connection

- [ ] Open `Smoke.thy` with the LSP `running`. The status bar shows **Isabelle LSP: running**.
- [ ] Confirm the Problems panel is empty (the file is intentionally well-formed).
- [ ] **Diagnostics coexistence.** Uncomment the `deliberately_broken_smoke` lemma in section 3. Wait for the LSP to publish a diagnostic, then run `Isabelle: Build Active Session`. Both sources should show in the Problems panel with distinct owners (`isabelle-build` for the CLI build, the LSP-assigned name for the live one). Re-comment when done.

### M5 — Semantic markup (LSP-backed)

- [ ] **Hover.** Hover over `Main` in the `imports` clause. Confirm a hover surfaces (LSP-provided when running, local-provider fallback otherwise).
- [ ] **Go to definition.** With the cursor on the `simp` in section 2, press <kbd>F12</kbd>. Confirm something opens (LSP-provided cross-theory navigation when running).
- [ ] **Completion.** Type `lem` at the start of a new line. Confirm `lemma` appears in the completion list.
- [ ] **PIDE/decoration overlay.** Confirm keywords (`lemma`, `assumes`, `by`, etc.) and free variables (`A`, `B`, `n`) are visibly colored differently from comments. The LSP publishes `text_<color>` ranges per file; the overlay should layer on top of the local semantic-tokens foundation.
- [ ] **Abbreviation completion.** In `identity_smoke`, delete the `\<lambda>` and re-type `\<lam`. Accept the completion. Confirm the `λ` Unicode glyph (or the upstream-rendered ASCII expansion) is inserted.
- [ ] **Documentation browser.** Run `Isabelle: Browse Isabelle Documentation`. Confirm the quick-pick shows manuals (Tutorial, Isar-Ref, Sledgehammer, etc.) and "Open" opens the PDF in your OS's default app.
- [ ] **Live preview.** Run `Isabelle: Preview Theory in Split`. Confirm the rendered HTML body appears in the adjacent column. Edit the source — confirm the preview re-renders (no flash-back to a loading placeholder).
- [ ] **Spell-checker.** Place the cursor inside `conj_commute_smoke` (a single Isabelle "word"). Run `Isabelle: Include Word in Spell-Checker (Permanent)`. Confirm any existing spell-checker decoration on that word clears.

### M6 — Proof state panel

- [ ] Open the **Isabelle Proof State** view in the Explorer side bar. With the cursor on `add_zero_right_smoke`'s `by simp`, confirm the panel shows the goal state.
- [ ] Move the cursor up to before `by simp`. Confirm the panel refreshes to show the pre-proof state.
- [ ] **Auto-update toggle.** Run `Isabelle: Toggle Proof State Auto-Update`. Move the cursor — confirm the panel stays anchored. Toggle back, confirm it follows again.
- [ ] **Re-anchor.** With auto-update off, move the cursor to a new command and run `Isabelle: Re-anchor Proof State to Cursor`. Confirm the panel jumps to the new location.
- [ ] **Margin.** Edit `isabelle.proofState.margin` to a small value (e.g. 30). Confirm the rendered state re-wraps. Reset to 80.
- [ ] **Dynamic output.** A "Dynamic output (caret-driven)" section should appear below the main state when Isabelle emits caret-driven messages (e.g. inside a Sledgehammer run). Confirm it hides itself when empty.
- [ ] **PIDE per-cursor focus (Phase 3c).** Run `Isabelle: Show PIDE Proof State at Cursor` with the cursor on `add_zero_right_smoke`. Confirm the returned messages are scoped to that lemma, not the whole theory. Move the cursor to `identity_smoke` and re-run — the messages should reflect that definition instead. The `notes` field in the JSON-RPC response should record `kept=N` < `collected=M` when filtering kicked in.

### M7 — Sledgehammer

- [ ] Cursor on the `sorry` in `conj_commute_smoke`. Run `Isabelle: Run Sledgehammer`. Confirm the panel shows "Prover output" with at least one suggestion within ~30 s.
- [ ] **Cancellation.** Run Sledgehammer again, immediately run `Isabelle: Cancel Sledgehammer`. Confirm the run aborts cleanly.
- [ ] **Quiescence gate.** Edit the file (any change), then immediately run Sledgehammer. Confirm a brief delay (~1.5 s) before dispatch — this is the per-URI quiescence gate avoiding "Unknown proof context".
- [ ] **Insert.** After a successful run, run `Isabelle: Insert Sledgehammer Proof`. Confirm `sorry` is replaced and the file still compiles.
- [ ] **Pick suggestion.** Re-run Sledgehammer. If multiple suggestions land, run `Isabelle: Pick Sledgehammer Suggestion to Insert` and confirm the quick-pick shows them all and inserts the chosen one.
- [ ] **Minimization.** With the cursor on a line like `by (metis foo bar baz qux assms)`, run `Isabelle: Minimize Sledgehammer Proof at Cursor`. Confirm the panel reports back a minimized proof (typically dropping any unnecessary facts). This routes through the Headless `PideBridge` (PR #82), NOT through the LSP — works whether `isabelle.languageServer.enabled` is on or off, but does require a working Isabelle install + Java since it submits a real `sledgehammer [minimize=true]` command via `Headless.Session.use_theories`.

### M8 — Theory graph + proof-engineering

- [ ] Open the **Isabelle Theory Graph** view. Confirm `Smoke` appears under session `Isabelle_VSCode_Smoke` with `Main` (from `HOL`) as a dependency.
- [ ] Toggle direction with `Isabelle: Toggle Theory Graph Direction`. Confirm the tree flips.
- [ ] Run `Isabelle: Show Theory Dependents` on `Smoke`. Confirm the quick-pick lists any local importers (likely empty for a fresh checkout).
- [ ] Open the **Isabelle Theory Outline** view. Confirm the three definitions/lemmas in `Smoke.thy` appear.
- [ ] Run `Isabelle: Go to Next Command` / `Isabelle: Go to Previous Command`. Confirm the cursor jumps span-by-span.

### M9 — Checked AI repair

- [ ] Run `Isabelle: Create Checked Repair Request`. Confirm a Markdown document opens containing the URI, version, cursor, diagnostics, and (when the LSP is running) proof state.
- [ ] Run `Isabelle: Copy Checked Repair Request to Clipboard`. Paste somewhere — confirm the same Markdown bundle is on the clipboard.
- [ ] (Optional) Configure a provider via `isabelle.repair.aiProvider`, acknowledge sharing via `isabelle.repair.aiAcknowledgedSharing`, run `Isabelle: Request AI Repair Suggestion`. Confirm any returned diff routes through `Isabelle: Preview Repair Patch` before any edit.

### Install UX

- [ ] On a clean machine, install the matching per-platform `.vsix`. Run `Isabelle: Check Setup Prerequisites`. Confirm Java is reported as **bundled / ok**.
- [ ] Install the universal `.vsix` on the same machine. Run the prereq check again. Confirm Java is now reported as **system / ok** (or absent if you removed PATH `java`).

## What this checklist explicitly does NOT cover

- **Cross-platform smoke testing** — each per-platform `.vsix` is layout-smoked in CI but not invoked in anger. macOS Apple-silicon / Linux ARM64 require a real machine for true verification.
- **AFP integration** — `Smoke.thy` only imports `Main`. AFP path discovery is exercised by the unit test suite; live verification needs a real AFP checkout.
- **Long-running proofs** — `Smoke.thy` is deliberately tiny. Real-world performance / timeout behavior needs a heavier theory.

## When this checklist passes

The alpha is healthy enough to share with a small group. Cut a release per [`skills/prepare-release.md`](../skills/prepare-release.md). Open an issue with the `alpha-blocker` label for anything that fails.
