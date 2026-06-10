# Changelog

All notable user-facing changes are tracked here. This project follows the
spirit of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses
Semantic Versioning while the extension remains in preview.

## Unreleased

### Added

- `Isabelle: Insert Symbol` command. Browse and search the full Isabelle symbol
  table by glyph, token (`\<forall>`), group (`logic`), or ASCII abbreviation
  (`ALL`, `!`) in a quick-pick, and insert the chosen symbol at the cursor — for
  when you want a symbol but don't know its name. Inserts the Unicode glyph when
  the symbol has one, otherwise the markup token. Works offline.
- `Isabelle: New Theory File` command. Scaffolds a correctly-named `<Name>.thy`
  (Isabelle requires the theory name to equal the file base name) with a ready
  `theory … imports Main begin … end` header, in the active file's folder (or the
  workspace root), then opens it with the cursor in the body. The name is
  validated against Isabelle's identifier rules as you type, and an existing file
  is offered to open rather than overwritten.
- Isabelle snippets. Tab-completable skeletons for the core authoring
  constructs — `theory`, `lemma` (Isar / one-liner / assumes-shows), `theorem`,
  `corollary`, `definition`, `abbreviation`, `fun`, `primrec`, `datatype`,
  `record`, `inductive`, `locale`, `context`, document headings, and Isar proof
  skeletons (`proof … qed`, induction, cases, obtain, fix/assume/show). The
  `theory` skeleton defaults its name to the file name, which Isabelle requires.
- Structural code folding for Isabelle theory files. A prover-independent,
  source-only folding-range provider collapses structured Isar proofs
  (`proof … qed`, nesting-aware), the document-heading hierarchy
  (`chapter` / `section` / `subsection` / `subsubsection` / `paragraph` /
  `subparagraph`), multi-line block comments `(* … *)`, and the multi-line
  theory header (`theory … begin`). Folding works the instant a `.thy` file
  opens — no language server, Scala backend, or live Isabelle required — and
  masks comments, cartouches, and string literals (symbol-escape aware) so
  keywords inside prose or inner syntax never trigger a spurious fold.
- Editor ergonomics for Isabelle's Unicode brackets: typing `‹`, `⟨`, or `⟦`
  now auto-inserts its matching `›`, `⟩`, or `⟧`, the same pairs surround a
  selection when typed over it, and they participate in bracket matching. An
  Isabelle-aware `wordPattern` keeps symbol escapes (`\<alpha>`, `\<^sub>`) and
  primed identifiers (`xs'`) selectable as single words, and quotes no longer
  auto-close inside comments.
- Extension icon and gallery banner. A clean turnstile (`⊢`, “proves”) mark on
  an indigo gradient now represents the extension in the Marketplace, the
  Extensions view, and the editor — replacing the generic default icon.

### Changed

- Settings now render their inline code, bold, and examples correctly in the
  VS Code Settings UI. Every configuration setting whose help text uses Markdown
  was moved from a plain `description` to `markdownDescription`, so backticks
  like `isabelle.executablePath` show as formatted code instead of literal
  back-tick characters. A manifest test pins the convention going forward.
- The packaged `.vsix` no longer ships contributor- and agent-facing docs
  (`AGENTS.md`, `docs/`, `skills/`, `scripts/`) to end users — README links
  resolve against the repository, so these are repo-only. A test pins the
  exclusions and keeps `.vscodeignore` and `.vscodeignore.platform` in sync.

### Fixed

- The backend client now fails in-flight requests cleanly if the Scala backend
  ever emits a malformed protocol frame, instead of letting the parse error
  escape as an uncaught extension-host exception and leaving requests to hang.
- The optional PIDE prewarm timer scheduled at activation is now cleared on
  deactivation, so it can no longer fire against disposed services when a window
  closes immediately after start-up.
- Guarded several panels and document sync against stale/out-of-order async
  results: the proof state panel ignores a backend response that a newer refresh
  has superseded, document sync ignores an out-of-order theory result older than
  the version already recorded, and the Sledgehammer panel claims its run slot
  before the session quick-pick so a second invocation can no longer start a
  duplicate backend job.
- Removed stray `<error_message>…</error_message>` pseudo-tags from the
  `isabelle.sledgehammer.quiescenceDelayMs` setting description.

## Unreleased

### Added

- Offline Isabelle symbol completion. Typing a symbol token (`\`, `\<`,
  `\<fora`, `\<^bo`, …) now offers the full authoritative Isabelle symbol table
  — `\<forall>` → ∀, `\<Longrightarrow>` → ⟹, `\<lambda>` → λ, and the rest —
  with glyph previews, Unicode code points, and the ASCII abbreviations Isabelle
  accepts (so fuzzy-matching `ALL` or `%` finds the symbol too). It is backed by
  an embedded table generated from Isabelle's own `etc/symbols`, needs no prover
  or language server, and works the instant a `.thy` file opens. When the
  language server is also running, its `PIDE/abbrevs` completions remain
  available alongside these. See `THIRD_PARTY_NOTICES.md` for the symbol-table
  attribution.
- Isabelle symbol conversion commands. `Isabelle: Convert Symbols to Unicode (∀)`
  and `Isabelle: Convert Symbols to ASCII (\<forall>)` rewrite symbol tokens to
  their glyphs and back across the current selection (or the whole file when
  nothing is selected). The mapping is lossless and prover-independent — paste
  an ASCII Isabelle proof and render it as Unicode, or normalize a file back to
  portable ASCII notation. Also available from the editor right-click menu.
- Rich Isabelle symbol hovers. Hovering over a `\<...>` symbol token **or** its
  rendered glyph (∀, ⟹, λ, …) now shows the symbol name, its Unicode code point,
  its group, and the ASCII abbreviations Isabelle accepts — sourced from the same
  authoritative table, so it covers the full symbol set rather than a handful of
  hard-coded entries.

## 0.1.0-alpha.6

The first alpha that ships a real Headless PIDE bridge alongside the
LSP relay, per-platform `.vsix` artifacts with a bundled JRE, a hardened
release-readiness gate, and a wide pass of UX polish on setup, language
server lifecycle, proof state, and AI repair surfaces.

### Added

- Per-platform `.vsix` artifacts that bundle Eclipse Temurin 21 for
  Windows x64/arm64, Linux x64/arm64, Alpine x64/arm64, and macOS
  Apple-silicon, alongside a universal "bring-your-own-Java" `.vsix`.
- Headless PIDE bridge powering `Isabelle: Show PIDE Document Status`,
  `Isabelle: Show PIDE Proof State at Cursor`, Sledgehammer search via
  source-injection, and `Isabelle: Minimize Sledgehammer Proof at Cursor` —
  all working whether the LSP is enabled or not, provided Isabelle + Java
  can be bootstrapped.
- LSP-backed PIDE decorations, proof state panel with dynamic output,
  Sledgehammer search/insert/cancel, live theory preview, Isabelle
  documentation browser, abbreviation completion, and spell-checker
  dictionary commands.
- Checked AI repair workflow: bundle capture, unified-diff preview
  validation, manual paste-back provider, third-party provider extension
  API, and `SecretStorage`-backed provider secrets.
- `Isabelle: Request AI Repair Suggestion (Experimental)` now shows a
  pre-send review of the exact checked-repair bundle (with byte-count) so
  no provider receives anything until the user confirms.
- PIDE trust indicators in the proof state panel surface whether the
  rendered state comes from the live Headless `PideBridge`, the LSP
  relay, or the conservative local placeholder.
- `Isabelle: Retry Language Server Auto-Start` — one-click recovery when
  a sticky LSP auto-start failure key has suppressed the auto-spawn.
- `Isabelle: Explain Current Mode` now offers actionable next-step quick
  actions (install Java, start LSP, open setup walkthrough, …) instead
  of read-only diagnostics.
- Windows PowerShell launcher failures (locked-down execution policy,
  missing `isabelle.ps1`) now report administrator-friendly remediation
  hints instead of being misclassified as "Isabelle not installed".
- Release-readiness gate documentation in
  [`docs/RELEASE_READINESS.md`](docs/RELEASE_READINESS.md).
- Stable-build Marketplace publish guard in the Release workflow:
  prerelease versions and `preview: true` packages remain
  GitHub-Release-only even when a `VSCE_PAT` secret is configured.
- macOS bundled-JRE Gatekeeper hint surfaced by the setup prerequisite
  check when the per-platform JRE cannot be spawned.
- `SECURITY.md` documenting the supported security posture and reporting
  path.
- Manual-dispatch **Tier-2 smoke** workflow that downloads a real
  Isabelle distribution on Linux/Windows/macOS runners and exercises the
  deterministic subset of `SMOKE_THEORY_CHECKLIST.md` against
  `examples/Smoke.thy`.

### Changed

- Command palette discoverability polish: context-relevant commands now
  surface when they apply (proof state refresh hides when the panel is
  not visible, Sledgehammer insertion gates on having a suggestion, etc.).
- The Scala backend assembly merge strategy now fails loud on unexpected
  duplicate non-metadata files instead of silently picking the first copy.
- Workspace `isabelle.session.roots` values are now forwarded to Headless
  PIDE submissions, with paths converted to Isabelle-style forward-slash
  form on Windows so `use_theories` does not reject them.

### Fixed

- LSP auto-start retry no longer forces `isabelle.languageServer.enabled`
  back on for users who deliberately disabled it.
- The PIDE proof-state freshness ticker is scoped to the visible panel so
  hidden panels do not keep doing work.
- Session directory params received by the backend are validated before
  being passed to PIDE, avoiding noisy crashes on malformed inputs.
- Vulnerable `qs` and `tmp` transitive dependencies updated to clear
  open advisories.

### Known gaps

- Live VS Code-hosted smoke evidence is still pending for the candidate
  assets; tracked by
  [#90](https://github.com/Arthur742Ramos/Isabelle-VSCode/issues/90)
  and the release-candidate table in
  [`docs/SMOKE_THEORY_CHECKLIST.md`](docs/SMOKE_THEORY_CHECKLIST.md).
- Walkthrough screenshots and GIFs are tracked separately in
  [#93](https://github.com/Arthur742Ramos/Isabelle-VSCode/issues/93).
- Marketplace publication remains intentionally deferred while the
  package is `preview: true` / `private: true` — see
  [#97](https://github.com/Arthur742Ramos/Isabelle-VSCode/issues/97).

## Earlier alphas

- Established the TypeScript VS Code extension shell, Scala JSON-RPC backend,
  session discovery, Isabelle build integration, local theory/proof navigation,
  semantic-token foundations, and conservative checked-repair pipeline.
