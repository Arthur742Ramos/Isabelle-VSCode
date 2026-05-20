# Changelog

All notable user-facing changes are tracked here. This project follows the
spirit of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses
Semantic Versioning while the extension remains in preview.

## Unreleased

### Added

- Release-readiness gate documentation in `docs/RELEASE_READINESS.md`.
- A stable-build Marketplace publish guard in the Release workflow: prerelease
  versions and `preview: true` packages remain GitHub-Release-only even when a
  `VSCE_PAT` secret is configured.
- A pre-send review step for `Isabelle: Request AI Repair Suggestion
  (Experimental)`, so users see the exact checked-repair bundle before any
  provider receives it.
- A macOS bundled-JRE Gatekeeper hint when the per-platform JRE cannot be
  spawned.
- `SECURITY.md` with the supported security posture and reporting path.

### Changed

- The Scala backend assembly merge strategy now fails loud on unexpected
  duplicate non-metadata files instead of silently picking the first copy.

## 0.1.0-alpha.6

### Added

- Per-platform `.vsix` artifacts that bundle Eclipse Temurin 21 for supported
  Windows, Linux, Alpine, and macOS Apple-silicon targets.
- Headless PIDE bridge features for document status, proof state, Sledgehammer
  search, and Sledgehammer proof minimization.
- LSP-backed theory preview, Isabelle documentation browsing, abbreviation
  completion, spell-checker dictionary commands, PIDE decorations, proof state,
  dynamic output, and Sledgehammer integration.
- Checked repair workflow with strict patch preview validation, manual
  paste-back AI provider support, and `SecretStorage`-backed provider secrets.

### Known gaps

- Live VS Code-hosted smoke evidence is still incomplete for the published
  alpha assets; see `docs/SMOKE_THEORY_CHECKLIST.md`.
- Marketplace publication remains intentionally deferred while the package is
  `preview: true` / `private: true`.

## Earlier alphas

- Established the TypeScript VS Code extension shell, Scala JSON-RPC backend,
  session discovery, Isabelle build integration, local theory/proof navigation,
  semantic-token foundations, and conservative checked-repair pipeline.
