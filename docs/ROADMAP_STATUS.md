# Roadmap status

This document consolidates where each milestone from the
[README roadmap](../README.md#roadmap) stands today. It is the
single page to read for "what is shipped, what is still open, why."

> Last refreshed: 2026-05-20 (alpha posture pass: `v0.1.0-alpha.6` is published; smoke evidence is tracked in [#90](https://github.com/Arthur742Ramos/Isabelle-VSCode/issues/90), walkthrough screenshots are tracked in [#93](https://github.com/Arthur742Ramos/Isabelle-VSCode/issues/93), Marketplace posture is tracked in [#97](https://github.com/Arthur742Ramos/Isabelle-VSCode/issues/97), and AFP-scale dogfood is documented in [`SMOKE_THEORY_CHECKLIST.md`](SMOKE_THEORY_CHECKLIST.md#beyond-smokethy-afp-scale-dogfood-record)). Previously: 2026-05-19 — release matrix change dropped `darwin-x64` after three consecutive release-tag runs stalled on the `macos-13` runner pool; see AGENTS.md §17 for re-add criteria. Previously: 2026-05-18 — bundled per-platform JRE (`release.yml` now ships eight platform-targeted `.vsix` files alongside the universal one; `extension/jre/` removes the Java prerequisite for end users on supported platforms). Previously: PRs #51-#57 — PIDE decoration overlay, abbrevs completion, documentation browser, status consolidation, live theory preview, spell-checker dictionary commands, proof state auto-update / margin / relocate controls. For per-feature checkboxes,
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
| 7 Sledgehammer workflow | ✅ 7 of 7 — minimization shipped via Headless `PideBridge` (PR #82); LSP-side `PIDE/sledgehammer_minimize*` surface still upstream-blocked but no longer user-visible |
| 8 Theory graph + proof-engineering tools | ✅ Done |
| 9 Checked AI repair loop | ✅ Seam + 3rd-party API + SecretStorage + safe bundled provider |
| Install UX — bundled per-platform JRE | ✅ 7 per-platform `.vsix` files (win32-x64, win32-arm64, linux-x64, linux-arm64, alpine-x64, alpine-arm64, darwin-arm64) bundle Eclipse Temurin 21; universal `.vsix` still available for bring-your-own-Java fallback. macOS Intel (`darwin-x64`) was dropped from the matrix in v0.1.0-alpha.3 due to chronic `macos-13` runner-pool unavailability — see AGENTS.md §17. |

Vitest baseline: **all green**. The exact case count drifts as the suite grows — read it from `npm run test` or the CI `validate` job log per release. (Per AGENTS.md gotcha #7, hard-coded test counts in docs go stale on the next PR, so we intentionally don't pin one here.)

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
All seven recommendations from
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
proof-minimization — is shipped via the **Headless `PideBridge`
route** (PR #82), not via the LSP. The upstream LSP still exposes
no `PIDE/sledgehammer_minimize*` notification (verified at
`mirror-isabelle@ce22e9ea`), so the Scala backend's `PideBridge`
extends the Phase 4 source-injection path with
`Options.{params, onlyFacts, addFacts, delFacts}` and submits
`sledgehammer [minimize=true, preplay_timeout=10] (fact1 fact2 ...)`
through `Headless.Session.use_theories`. A new TS command
`Isabelle: Minimize Sledgehammer Proof at Cursor` parses an
existing `by (metis foo bar)` / `using ... by` / `apply (...)`
line at the cursor and dispatches with the extracted fact list.
See `AGENTS.md` §16 and `proof_state_and_minimization_lsp_research.md`.

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

- **Seven per-platform `.vsix` files** — `win32-x64`, `win32-arm64`,
  `linux-x64`, `linux-arm64`, `alpine-x64`, `alpine-arm64`,
  `darwin-arm64`. Each embeds Eclipse Temurin 21 under
  `extension/jre/` (`extension/jre/Contents/Home/` on macOS, keeping
  Adoptium's signed layout intact). End users on these platforms
  install the matching asset, get the matching Java automatically,
  and the activation-time prerequisite probe finds the bundled
  runtime via `src/backend/resolveJavaCommand.ts` — no system Java
  needed. (`darwin-x64` was dropped in v0.1.0-alpha.3 due to chronic
  `macos-13` runner-pool unavailability — see AGENTS.md §17.)
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
(`windows-latest` / `ubuntu-latest` / `macos-latest`) and smoke-test
the packaged VSIX by unzipping it
and invoking the bundled `java -version`. Cross-arch matrix entries
(arm64 on x64 hosts, Alpine musl on Ubuntu glibc) get layout-only
smoke; live cross-arch smoke is a documented Tier-2 manual check.

See [`../THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md) for the
Eclipse Temurin license summary and `release.yml`'s `TEMURIN_*` env
values for the bumping procedure.

## What is honestly still open

### Code work that could land in future PRs

- **Scala backend real `PideBridge` implementation.** ✅ **COMPLETE**
  (PRs #72 / #74 / #75 / #76 / #77 / #78 / #79 / #80 / #81 / #82).
  - **Phase 0** ✅ (PR #72) — backend compiles + tests under Scala
    3.3.4 matching Isabelle's bundled Scala.
  - **Phase 1** ✅ (PR #74) — runtime classpath bridge: backend
    resolves `<ISABELLE_HOME>`, builds a child `URLClassLoader` from
    `<home>/lib/classes/isabelle.jar` + `<home>/contrib/scala-*/lib/*.jar`,
    reflectively loads `isabelle.Isabelle_System$.MODULE$`. New
    JSON-RPC `isabelle/pideVersion` + command
    `Isabelle: Show PIDE Backend Status`. License contract:
    `backend/scripts/check-license.js` runs as part of
    `npm run backend:package`, fails on any `isabelle.*` class in the
    fat jar. See `THIRD_PARTY_NOTICES.md` + `AGENTS.md` §11.
  - **Phase 2a** ✅ (PR #75) — PIDE document submission via
    `Headless.Session.use_theories(...)`. New JSON-RPC
    `document/checkWithPide` + `pide/cancelWarmup`. Long-lived Session
    cached per `(home, session, isabelle.jar fingerprint)`. 4-step
    session cascade + scratch directory via `globalStorageUri` +
    Symbol round-trip. See `AGENTS.md` §12.
  - **Phase 2b** ✅ (PRs #76 + #78 polish) — in-flight `use_theories`
    cancellation via `Session.stop()` teardown on a background
    executor + atomic `inflightFacade.getAndSet(None)` idempotence.
    Trade-off documented in `AGENTS.md` §13 (upgrade path Option D
    with `isabelle.jar % Provided` if real-world cancellation use
    becomes painful).
  - **Phase 2c** ✅ (PR #77) — PIDE cache diagnostics + prewarm
    wiring. New `pide/warmup`, `pide/cacheState`, `pide/invalidateCache`
    JSON-RPC + `Isabelle: Show PIDE Document Status` /
    `Isabelle: Invalidate PIDE Cache` commands. `isabelle.pide.prewarmOnActivation`
    setting now drives an eager warmup.
  - **Phase 3a** ✅ (PR #79) — snapshot extraction infrastructure:
    `SnapshotCache` per-(uri, version, session) LRU-16, pure
    `OffsetToPosition` arithmetic, reflective walk of
    `snapshot.node.commands.toList` to identify the cursor's command.
    New JSON-RPC `proofState/getWithPide` + command
    `Isabelle: Show PIDE Proof State at Cursor`.
  - **Phase 3b** ✅ (PR #80) — real prover output via reflective
    `snapshot.messages` (same primitive `isabelle dump`'s `messages`
    aspect uses). Flattens `XML.content(tree)` per entry. Real Unicode
    (`∧`, `⟹`, `⇒`) preserved end-to-end. Per-command range filter
    via `Text.Range` + `snapshot.cumulate` deferred to optional 3c.
    See `AGENTS.md` §14.
  - **Phase 4** ✅ (PR #81) — PIDE-backed Sledgehammer via
    source-injection. `SledgehammerSourceInjector` mutates the source
    to insert a `sledgehammer` command at the cursor, re-submits via
    `use_theories`, harvests "Try this:" output via Phase 3b's
    `snapshot.messages` walker, parses via `SledgehammerSuggestionParser`.
    Returns structured `SledgehammerRunResult` to the existing
    `SledgehammerPanel`. Cancellation reuses Phase 2b teardown. See
    `AGENTS.md` §15.
  - **Phase 5** ✅ (PR #82) — Sledgehammer minimization (closes M7
    upstream-blocked item below). Extends Phase 4's injector with
    `Options.{params, onlyFacts, addFacts, delFacts}` to support
    `sledgehammer [minimize=true, preplay_timeout=10] (fact1 fact2 ...)`.
    New TS command `Isabelle: Minimize Sledgehammer Proof at Cursor`
    parses the line at the cursor (`by (metis foo bar)` / `using ... by`
    / `apply (...)`) and dispatches with the extracted fact list. See
    `AGENTS.md` §16.
  - **Phase 3c** ✅ — range-filtered `snapshot.messages` for per-cursor
    PIDE proof state. Reflective tuple-walk probes each
    `snapshot.messages` entry's `range()` accessor, then a pure
    `MessageFilterMode`-driven policy (`CursorCommandOnly` default for
    the proof state panel, `WholeSnapshot` explicit opt-in from
    Sledgehammer) keeps only entries overlapping the cursor's command.
    Mixed-mode policy: if some entries are positioned and some aren't,
    drop the unpositioned (else whole-file noise creeps back). See
    `AGENTS.md` §14.
  - **Optional follow-ups** (not committed to):
    - **Phase 5b** — direct `Sledgehammer_Minimize.run` reflection if
      `preplay_timeout=10` proves insufficient.
    - **Phase 2d** — free polish slot, e.g. multi-session cache if
      `prewarmOnActivation` needs it.
- macOS Intel per-platform .vsix dropped from release matrix (AGENTS.md §17). Re-add if GitHub Intel macOS runner capacity recovers.
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
- ~~Milestone 7 Sledgehammer minimization at the LSP level.~~ **Resolved
  via the Headless backend route, not via the LSP.** PR #82 ships
  `Isabelle: Minimize Sledgehammer Proof at Cursor` over the PIDE
  bridge — `isabelle vscode_server` still has no
  `PIDE/sledgehammer_minimize_request` notification, but the Scala
  backend's `PideBridge` now invokes Sledgehammer with
  `minimize=true` + `onlyFacts: [...]` reflectively. See
  `AGENTS.md` §16.

### Tier-2 manual verifications (need a live Isabelle install)

For the end-to-end walkthrough of every Tier-2 capability against a single tiny theory, see [`SMOKE_THEORY_CHECKLIST.md`](SMOKE_THEORY_CHECKLIST.md) (driven by [`examples/Smoke.thy`](../examples/Smoke.thy)). The per-capability list below is the master inventory each release dogfood should still cover individually.

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
- [`PIDE_INTEGRATION.md`](PIDE_INTEGRATION.md) — shipped PIDE architecture,
  capability inventory, and remaining gaps for Milestones 4, 5, 6, 7.
- [`sledgehammer_lsp_research.md`](sledgehammer_lsp_research.md) —
  original probe of the upstream Sledgehammer LSP surface.
- [`proof_state_and_minimization_lsp_research.md`](proof_state_and_minimization_lsp_research.md)
  — refreshed probe that found the M6 LSP surface and confirmed
  M7 minimization is upstream-blocked.
- [`AI_REPAIR.md`](AI_REPAIR.md) — Milestone 9 safety contract,
  provider authoring contract, bundled `manual-paste-back`
  walkthrough, third-party extension-API example.

## Post-alpha.6 release hardening

`v0.1.0-alpha.6` has been cut and the Release workflow produced the universal
VSIX plus seven per-platform assets. The remaining hardening work is to dogfood
those assets and keep the smoke checklist as the gate for the next alpha/beta
tag.

Current blockers / trackers:

- [#90](https://github.com/Arthur742Ramos/Isabelle-VSCode/issues/90) — run the
  quick dogfood transcript on Windows x64, Linux x64, and macOS arm64 if
  available; record failures as `alpha-blocker`s.
- [#93](https://github.com/Arthur742Ramos/Isabelle-VSCode/issues/93) — capture
  real walkthrough screenshots / GIFs; do not ship fake or broken image
  references.
- [#97](https://github.com/Arthur742Ramos/Isabelle-VSCode/issues/97) — keep the
  Marketplace posture explicit. Current stance: GitHub Releases only until the
  smoke transcript passes on the core OS trio and the screenshot pass lands.
- [#89](https://github.com/Arthur742Ramos/Isabelle-VSCode/issues/89) — track the
  remaining upstream `textDocument/documentSymbol` gap.

Known `alpha.6` limitations:

- No platform has recorded the full VS Code-hosted smoke transcript for the
  published `v0.1.0-alpha.6` assets yet.
- Screenshot/GIF captures are intentionally absent until a contributor with a
  real graphical Isabelle setup records them.
- The bundled `Smoke.thy` fixture proves the wiring, not AFP-scale behavior,
  long-running proof latency, or a paper-style case study.
- `textDocument/documentSymbol` remains local-provider-only until Isabelle's LSP
  advertises `documentSymbolProvider`.
- Marketplace publication remains a product/release decision, not a workflow
  accident.

Automation that is useful but not sufficient for the next tag:

- `npm run check`
- `npm run package:validate`
- `npm run test:integration` when a VS Code executable is available
- Manual-dispatch **Tier-2 smoke** workflow (`.github/workflows/tier2-smoke.yml`):
  installs a real Isabelle distribution on Linux, Windows, and macOS runners,
  packages/extracts a universal VSIX, launches the VS Code extension host with
  `ISABELLE_VSCODE_TIER2_SMOKE=1`, and checks the deterministic subset of
  `SMOKE_THEORY_CHECKLIST.md` against `examples/Smoke.thy`. Enable its
  `run_sledgehammer` input when you need CI evidence for the slow proof-search
  path.
- `isabelle build -o quick_and_dirty -D <absolute examples path>` as a headless
  sanity check for the bundled `Smoke.thy` session

Only the Smoke checklist exercises the full release promise: activation, LSP
notifications, panels, Sledgehammer, preview, and Headless `PideBridge` commands
through the VS Code UI.

## Beta readiness

The repo is currently shipped as **`0.1.x-alpha`** (`preview: true` in `package.json`). "Beta" in this project means "the alpha demo has been verified end-to-end on three OSes against a real Isabelle install, with no known regressions". The predicates below are the gate for promoting the version label from `alpha.N` to `beta.0`. They are intentionally narrow — most of them are already true; the bottleneck is **live verification**, not more code.

### Hard gates (all must be true)

- [ ] `npm run test:all` is green on `main` (both the structural Vitest suite AND the hosted Mocha integration suite under `xvfb`).
- [ ] CI `validate` + `integration-tests` jobs pass on the candidate commit.
- [ ] The Release workflow has produced all 8 `.vsix` artifacts (1 universal + 7 per-platform) for the candidate tag, and `npm run package:validate` confirms each one has the expected layout.
- [ ] `docs/SMOKE_THEORY_CHECKLIST.md` "Quick dogfood transcript" (steps 1–9 against `examples/Smoke.thy` + the bundled `Isabelle_VSCode_Smoke` session) runs cleanly on a clean machine on **at least three** of: Windows x64, Linux x64, macOS arm64. ("Clean" = no prior install of the extension, only the per-platform `.vsix` + Isabelle 2025-2.)
- [ ] The full per-capability checklist in `SMOKE_THEORY_CHECKLIST.md` (M4–M9 + Install UX) has been walked at least once on one of those three OSes for the candidate build.
- [ ] No open `alpha-blocker` (or equivalent) issue. Issues with the `manual-verification` label may remain open if they don't block the dogfood transcript.
- [ ] `THIRD_PARTY_NOTICES.md` and the bundled-JRE license summary are current — bumping Temurin in `release.yml` requires re-validating the notices.
- [ ] No `Scala 2.13` doc drift (the backend is Scala 3.3.4 since PR #72 — see AGENTS.md §11); no hard-coded test counts; no `darwin-x64` claims in release docs (dropped in alpha.3 — see AGENTS.md §17).

### Soft gates (preferred, not blocking)

- [ ] Screenshots (or a short GIF) for at least the proof state panel and Sledgehammer "Prover output" landed under `media/screenshots/` and referenced from `media/walkthrough/*.md`. See `media/screenshots/README.md` for the capture spec.
- [x] Phase 3c (range-filtered `snapshot.messages`) — landed. The PIDE proof-state panel now shows per-cursor focus instead of whole-file context. See [`AGENTS.md`](../AGENTS.md) §14 and `SnapshotProofStateExtractor.MessageFilterMode`.
- [ ] At least one external contributor (not the original author) has completed the smoke transcript successfully and reported back.

### Explicit non-goals for beta

- VS Code Marketplace publication (`preview: true` stays; `"private": true` stays). Marketplace is tracked in [#97](https://github.com/Arthur742Ramos/Isabelle-VSCode/issues/97) and remains a separate decision after beta has been stable for at least one minor release.
- Cross-arch live smoke on every CI runner (Alpine musl, Linux/Windows ARM64 cross-compiled JRE bundles, etc.). CI continues to layout-smoke those targets; live verification stays Tier-2 manual.
- Documentation localization, formal accessibility audit, or any UX polish that requires more than a session of editor-side work.
- Default network-calling AI repair provider (intentionally blocked — see `docs/AI_REPAIR.md`).

### What "post-beta" means

Once the gates above pass:

1. Bump `package.json` `version` from `0.1.x-alpha.N` to `0.1.x-beta.0`, leaving `preview: true`.
2. Tag the commit with `v0.1.x-beta.0` per `skills/prepare-release.md`.
3. Update the README "Current milestone" section to drop the "alpha" framing.
4. Open a tracking issue for the post-beta roadmap (optional Marketplace publication, Phase 5b, etc.).

