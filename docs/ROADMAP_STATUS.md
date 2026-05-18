# Roadmap status

This document consolidates where each milestone from the
[README roadmap](../README.md#roadmap) stands today. It is the
single page to read for "what is shipped, what is still open, why."

> Last refreshed: 2026-05-18 (bundled per-platform JRE — `release.yml` now ships eight platform-targeted `.vsix` files alongside the universal one; `extension/jre/` removes the Java prerequisite for end users on supported platforms). Previously: PRs #51-#57 — PIDE decoration overlay, abbrevs completion, documentation browser, status consolidation, live theory preview, spell-checker dictionary commands, proof state auto-update / margin / relocate controls. For per-feature checkboxes,
> see [`PIDE_INTEGRATION.md`](PIDE_INTEGRATION.md); for the
> upstream LSP research that backs the M6/M7 decisions, see
> [`sledgehammer_lsp_research.md`](sledgehammer_lsp_research.md)
> and [`proof_state_and_minimization_lsp_research.md`](proof_state_and_minimization_lsp_research.md);
> for the M9 AI repair contract, see [`AI_REPAIR.md`](AI_REPAIR.md);
> for the bundled-JRE license summary, see
> [`../THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md).

## Headline

| Milestone | Status |
| --- | --- |
| 1 Skeleton (activation, backend launch, health/version) | ✅ Done |
| 2 Session discovery (ROOT/ROOTS/AFP, active session, theory tree) | ✅ Done |
| 3 Build integration (`isabelle build`, streamed output, diagnostics) | ✅ Done |
| 4 PIDE document connection | ✅ Done (Tier-2 manual still recommended) |
| 5 Semantic markup | ✅ 8 of 9 — `documentSymbol` upstream-blocked; PIDE/decoration overlay + PIDE/abbrevs completion + PIDE/documentation browser + PIDE/preview live theory preview + PIDE spell-checker dictionary commands shipped |
| 6 Proof state panel | ✅ 3 of 3 — LSP-backed via PIDE state-panel + dynamic_output + user-facing auto-update / margin / relocate settings and commands |
| 7 Sledgehammer workflow | ✅ 6 of 7 — minimization upstream-blocked |
| 8 Theory graph + proof-engineering tools | ✅ Done |
| 9 Checked AI repair loop | ✅ Seam + 3rd-party API + SecretStorage + safe bundled provider |
| Install UX — bundled per-platform JRE | ✅ 8 per-platform `.vsix` files (win32 / linux / alpine / darwin × x64 / arm64) bundle Eclipse Temurin 21; universal `.vsix` still available for bring-your-own-Java fallback |

Vitest baseline: **719 cases, all green**.

## What is fully shipped

### Milestone 1 — Skeleton
Custom `Content-Length`-framed JSON-RPC protocol between the
extension and the Scala backend; reach-check + version probe.

### Milestone 2 — Session discovery
ROOT/ROOTS parser, workspace discovery, active-session
persistence, Explorer-side **Isabelle Sessions** tree. AFP path
hook.

### Milestone 3 — Build integration
`isabelle build` runner for the active session, streamed output,
cancellation, Problems-panel diagnostics for common source-location
formats. CLI-build diagnostics use a dedicated collection
(`isabelle-build`) so the LSP relay (PR #29) does not collide.

### Milestone 4 — PIDE document connection
The optional Isabelle language server (`isabelle vscode_server`)
ships behind `isabelle.languageServer.enabled`. When it is
`running`:

- `textDocument/{didOpen,didChange,didClose}` are auto-synced for
  every `.thy` document via the `vscode-languageclient` document
  selector; structurally pinned by
  `test/lsp/featureCoexistence.test.ts` so a future refactor
  can't narrow the selector silently.
- LSP-published `PublishDiagnostics` and CLI-build diagnostics
  coexist on separate `DiagnosticCollection` owners
  (`isabelle-build` vs the LSP-assigned name); pinned by
  `test/lsp/diagnosticsCoexistence.test.ts`. Live verification
  (introduce a deliberate Isabelle error, see both sources in
  the Problems panel) remains a Tier-2 manual run.
- The local command-span "pending" dashed-border decorations are
  suppressed in favor of the LSP's published diagnostics — see
  `shouldSuppressLocalCommandSpanDecorations` in
  `src/document/commandSpanDecorationGroups.ts`. The policy is
  binary today (off only when LSP is `running`) and will extend
  to swap the source once upstream exposes per-command status as
  a structured LSP notification.

### Milestone 5 — Semantic markup
Local syntax-only foundation (semantic tokens, hover, definition,
document-link, document-symbol) registered against
`{language: "isabelle", scheme: "file"}`. When the LSP is
`running`, `vscode-languageclient` auto-registers hover, definition,
and completion providers against the same selector (Isabelle
2025-2 advertises all three); VS Code aggregates results from
both. On top of that, the new `PideDecorationOverlayService`
subscribes to upstream `PIDE/decoration` and overlays the editor
with the server's per-URI `text_<color>` ranges (keywords, free /
bound / type variables, inner-syntax literals, errors,
deprecation, etc.) — see `PIDE_INTEGRATION.md` for the full
decoration-type map. The new `PideAbbrevsCache` +
`PideAbbrevsCompletionProvider` dispatch `PIDE/abbrevs_request` on
every `running` transition, cache the resulting
`PIDE/abbrevs_response` table (pairs like `\<lambda>` → `λ`),
and surface it as a VS Code completion provider that walks
backward from the cursor to find the longest matching prefix. The
new `PideDocumentationCache` + `Isabelle: Browse Isabelle
Documentation` command dispatch `PIDE/documentation_request`, cache
the response, and surface the available Isabelle manuals
(Tutorial, Isar-Ref, Sledgehammer, etc.) as a quick-pick that
opens the selected entry with the OS default. The new
`PidePreviewSubscriber` + `Isabelle: Preview Theory` /
`Isabelle: Preview Theory in Split` commands send
`PIDE/preview_request` for the active theory and render the
server's `PIDE/preview_response` HTML body in a CSP-locked
webview that re-paints live as the source changes. Five new
spell-checker commands (`Isabelle: Include / Exclude Word
(Session / Permanent)` and `Isabelle: Reset Spell-Checker
Session Words`) push the upstream `PIDE/include_word`-family
notifications, with the include/exclude variants first sending
`PIDE/caret_update` so the server resolves the word at the
user's caret. The only outstanding capability is the
`textDocument/documentSymbol` merge — Isabelle 2025-2 does NOT
advertise `documentSymbolProvider`, so VS Code's Outline +
breadcrumb stay on the local provider. Documented as
upstream-blocked in `PIDE_INTEGRATION.md`.

### Milestone 6 — Proof state panel
The panel branches on `IsabelleLanguageClient.getStatus().state ===
"running"`:

- **LSP mode** (PR #43): dispatches `PIDE/state_init`, captures
  the returned `state_id`, subscribes to
  `PIDE/state_output { id, content, auto_update }`, parses the
  Isabelle XML markup via the shared
  `parsePideSledgehammerOutput`, renders an auto-update banner,
  and tears down via `PIDE/state_exit` on dispose. Single
  instance per panel — no re-init on cursor moves.
- **Dynamic-output sub-surface** (PR #45): a secondary
  caret-driven "Dynamic output" section subscribes to
  `PIDE/dynamic_output` and renders the latest snapshot under
  the main state. Hides itself when the snapshot is empty.
- **User-facing controls** (PR #57): three settings
  (`isabelle.proofState.autoUpdate`, `isabelle.proofState.margin`,
  `isabelle.dynamicOutput.margin`) and two commands
  (`Isabelle: Toggle Proof State Auto-Update`,
  `Isabelle: Re-anchor Proof State to Cursor`) wire the
  upstream `PIDE/state_auto_update` / `PIDE/state_set_margin` /
  `PIDE/state_locate` / `PIDE/output_set_margin` notifications
  through to the user. Settings changes propagate live without
  a workspace reload, and only the notifications whose
  underlying setting actually changed are re-sent.
- **Backend fallback**: when the LSP is off or errors, the panel
  falls back to the existing local-syntax `proofState/get`
  placeholder so users see something useful rather than an empty
  panel.

### Milestone 7 — Sledgehammer
Six of seven recommendations from
`sledgehammer_lsp_research.md` are shipped:

1. LSP notification I/O seam on `IsabelleLanguageClient` (PR #31).
2. Branch `SledgehammerPanel.run()` between LSP mode and
   backend mode; LSP mode dispatches `PIDE/caret_update` →
   `PIDE/sledgehammer_request` (PR #37).
3. Single-flight request serialisation via the one-shot
   `LspSledgehammerSession` (PR #36).
4. Isabelle XML parser for `PIDE/sledgehammer_output` (PR #32) +
   "Prover output" renderer section.
5. Two-step sendback insert flow via
   `PIDE/sledgehammer_sendback` → `PIDE/sledgehammer_insert`
   (PR #38).
6. Settings (`isabelle.sledgehammer.{provers,isar,try0}`) +
   `PIDE/sledgehammer_provers_response` cache (PRs #33, #34).
7. Quiescence gate before the first dispatch
   (`isabelle.sledgehammer.quiescenceDelayMs`, default 1500 ms;
   PR #39).

Plus a polish PR (#41) for the `Pick Sledgehammer Suggestion`
quick-pick when multiple sendbacks come back.

The **seventh recommendation** in the research note —
proof-minimization — is upstream-blocked: the upstream LSP
exposes no `PIDE/sledgehammer_minimize*` notification (verified
at `mirror-isabelle@ce22e9ea`). The only paths are an upstream
change to `isabelle vscode_server` or a Scala-backend
`PideBridge` implementation that calls `Sledgehammer_Minimize.run`
directly. Documented in
`proof_state_and_minimization_lsp_research.md`.

### Milestone 8 — Theory graph + proof-engineering tools
Explorer-side **Isabelle Theory Graph** tree, forward/reverse
view toggle, `Show Theory Dependents` quick-pick, **Isabelle
Theory Outline** tree for locally extracted entities, proof
navigation commands (next/previous/reveal), conservative
"Proof Actions" palette (`sorry` / `oops` / refresh / build),
local definition / hover / document-symbol providers — all
shipped before this session.

### Milestone 9 — Checked AI repair loop
Three layers:

- **Local-only path** (pre-session): `Isabelle: Create Checked
  Repair Request` captures URI, version, cursor, VS Code
  diagnostics, and optional proof state into a Markdown bundle
  the user reviews and pastes anywhere.
- **Clipboard + opt-in seam** (PR #44): `Isabelle: Copy Checked
  Repair Request to Clipboard` puts the same bundle on the
  clipboard. `Isabelle: Request AI Repair Suggestion` delegates
  to a configured AI provider only when both
  `isabelle.repair.aiProvider` is non-empty AND
  `isabelle.repair.aiAcknowledgedSharing` is `true`. Pure gate
  helper (`decideRepairAiGate`) with dedicated tests. Any
  provider-returned diff routes through the existing strict
  `previewRepairPatch` pipeline before any edit is applied.
- **Bundled safe provider + ecosystem hooks** (PRs #46–#48):
  - Public extension API `IsabellePideExtensionApi` (v1) so
    third-party VS Code extensions can register providers via
    the standard `activate()` exports flow.
  - `vscode.SecretStorage`-backed `RepairAiSecretStore` plus
    `Isabelle: Set / Clear AI Repair Provider Secret` commands.
  - Built-in `manual-paste-back` provider that satisfies the
    `RepairAiProvider` contract WITHOUT any network call: copies
    the request to the clipboard, prompts for the AI's response
    file, returns its content through the existing preview
    pipeline. Honours `AbortSignal` at every awaitable boundary.

See `AI_REPAIR.md` for the full safety contract and provider
authoring guide.

### Install UX — bundled per-platform JRE
The Release workflow (`.github/workflows/release.yml`) ships TWO
flavors per `v*` tag:

- **Eight per-platform `.vsix` files** — `win32-x64`, `win32-arm64`,
  `linux-x64`, `linux-arm64`, `alpine-x64`, `alpine-arm64`,
  `darwin-x64`, `darwin-arm64`. Each embeds Eclipse Temurin 21 under
  `extension/jre/` (`extension/jre/Contents/Home/` on macOS, keeping
  Adoptium's signed layout intact). End users on these platforms
  install the matching asset, get the matching Java automatically,
  and the activation-time prerequisite probe finds the bundled
  runtime via `src/backend/resolveJavaCommand.ts` — no system Java
  needed.
- **One universal `.vsix`** — no bundled JRE, requires `java` 21+
  on `PATH`. Stays available for `linux-armhf`, *BSD, NixOS, exotic
  CPU archs, and bring-your-own-Java security-constrained envs.

The bundled-JRE picker is platform-aware and validates
`isFile()` + (POSIX) `X_OK` before accepting the candidate; a
corrupt local `jre/` (or a stale dev checkout) falls through to
PATH `"java"` silently. The activation-time prereq checker re-probes
PATH `"java"` whenever a bundled candidate fails its `-version` spawn
so universal-VSIX users still see the existing "install Java" toast
when their PATH lacks Java.

CI matrix builds run on the target's native runner where possible
(`windows-latest` / `ubuntu-latest` / `macos-latest` + `macos-13`
for darwin-x64) and smoke-test the packaged VSIX by unzipping it
and invoking the bundled `java -version`. Cross-arch matrix entries
(arm64 on x64 hosts, Alpine musl on Ubuntu glibc) get layout-only
smoke; live cross-arch smoke is a documented Tier-2 manual check.

See [`../THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md) for the
Eclipse Temurin license summary and `release.yml`'s `TEMURIN_*` env
values for the bumping procedure.

## What is honestly still open

### Code work that could land in future PRs

- **Scala backend real `PideBridge` implementation.** The
  largest open track. Requires linking against Isabelle's PIDE
  jars and is multi-PR work. Would unblock:
  - Milestone 7 minimization (since the LSP doesn't expose it).
  - Live PIDE-backed proof state / Sledgehammer for users
    WITHOUT the LSP relay (today they get the local-syntax
    placeholders + backend boundary disclaimers).
- **Decoration overlays from
  `PIDE/dynamic_output.decorations`.** Upstream sends optional
  decoration data alongside the dynamic-output content; mapping
  it to editor gutters would require new vscode editor decoration
  plumbing. (The `PIDE/decoration` overlay landed in PR #51
  already handles the per-URI `text_<color>` channel; this open
  item is the analogous caret-driven channel on the
  dynamic-output side.)
- **More opinionated bundled AI providers** (OpenAI, Anthropic,
  GitHub Copilot, etc.). Third parties can already plug in via
  the v1 API. Shipping any default that calls a third-party
  network service crosses the no-silent-data-sharing line; needs
  an explicit owner decision and likely per-provider opt-in beyond
  the existing acknowledgement gate.

### Upstream-blocked (Isabelle changes required)

- Milestone 5 `textDocument/documentSymbol` merge.
- Milestone 7 Sledgehammer minimization at the LSP level.

### Tier-2 manual verifications (need a live Isabelle install)

Documented per checkbox in `PIDE_INTEGRATION.md`:

- M4 PublishDiagnostics live coexistence (deliberate Isabelle
  error, see both sources in Problems panel).
- M5 hover / definition / completion end-to-end against
  cross-file declarations.
- M5 `PIDE/decoration` overlay end-to-end — open an Isabelle
  theory with the LSP enabled and confirm that keywords, free
  variables, type parameters, and `text_bad` errors are painted
  with the upstream-published ranges.
- M5 `PIDE/abbrevs` completion end-to-end — type `\<lam` in a
  `.thy` with the LSP enabled and accept the `λ` suggestion from
  the cached `PIDE/abbrevs_response` table.
- M5 `Isabelle: Browse Isabelle Documentation` end-to-end — with
  the LSP enabled, run the command, pick the Tutorial entry, and
  confirm the PDF opens with the OS's default application.
- M5 `Isabelle: Preview Theory` (and split) end-to-end — open a
  `.thy`, run the command, confirm the rendered HTML matches
  the source and re-renders as you edit.
- M5 spell-checker dictionary commands end-to-end — type a
  custom word in a `.thy`, run `Isabelle: Include Word
  (Permanent)`, confirm the spell-check decoration disappears.
- M6 PIDE state + dynamic-output live updating as the prover
  progresses.
- M6 proof state controls end-to-end — toggle
  `isabelle.proofState.autoUpdate` off, confirm the panel
  stops auto-refreshing; edit `isabelle.proofState.margin` and
  watch the rendered state re-flow; run `Isabelle: Re-anchor
  Proof State to Cursor` and confirm the panel re-anchors.
- M7 Sledgehammer / sendback / quiescence / multi-suggestion
  flows end-to-end.
- M9 manual-paste-back end-to-end (copy → paste in external AI
  tool → save .patch → open patch file → previewRepairPatch
  validates → apply → checkRepairWorkspace).

## Cross-references

- [README.md](../README.md) — feature catalog + "Checked repair
  workflow" + "Isabelle language server" how-to.
- [`PIDE_INTEGRATION.md`](PIDE_INTEGRATION.md) — capability
  roll-out checklist for Milestones 4, 5, 6, 7.
- [`sledgehammer_lsp_research.md`](sledgehammer_lsp_research.md) —
  original probe of the upstream Sledgehammer LSP surface.
- [`proof_state_and_minimization_lsp_research.md`](proof_state_and_minimization_lsp_research.md)
  — refreshed probe that found the M6 LSP surface and confirmed
  M7 minimization is upstream-blocked.
- [`AI_REPAIR.md`](AI_REPAIR.md) — Milestone 9 safety contract,
  provider authoring contract, bundled `manual-paste-back`
  walkthrough, third-party extension-API example.
