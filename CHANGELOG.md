# Changelog

All notable user-facing changes are tracked here. This project follows the
spirit of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses
Semantic Versioning while the extension remains in preview.

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
