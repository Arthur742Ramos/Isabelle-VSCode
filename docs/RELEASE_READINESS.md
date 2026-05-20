# Release readiness gate

This is the decision record for turning a build into a public release. The
current posture is: alpha releases are acceptable for GitHub Releases when the
gates below pass; Marketplace or non-preview release requires the stricter
stable gate.

## Alpha / preview gate

Do not tag a new alpha unless all of these are true:

1. `npm run check` passes.
2. Packaging is validated with `npm run package:validate`, or the Release
   workflow has produced and verified the same artifacts.
3. `docs/SMOKE_THEORY_CHECKLIST.md` has real VS Code-hosted smoke evidence for
   the candidate assets, or the missing platform evidence is explicitly called
   out before tagging.
4. `CHANGELOG.md` has an entry for the candidate.
5. No known data-loss, command-execution, secret-leakage, or extension
   activation blocker is open.

## Stable / Marketplace gate

Marketplace publish is blocked unless the package version is stable and
`package.json` has `preview: false`. Before making that change:

1. The Windows x64, Linux x64, and macOS arm64 quick dogfood transcript in
   `docs/SMOKE_THEORY_CHECKLIST.md` must pass for the exact candidate assets.
2. The macOS bundled-JRE story must be a deliberate decision: notarize/sign the
   per-platform asset, keep the in-product quarantine hint, or ship macOS as
   universal-only.
3. The AI repair data-flow must stay default-deny and pre-send-review-gated.
4. `SECURITY.md`, `CHANGELOG.md`, `README.md`, and Marketplace presentation
   assets must be current.
5. The Release workflow's Marketplace guard must stay enabled.

## Non-blocking polish backlog

These are useful but should not block another alpha unless they are tied to a
specific user harm:

- Reduce command-palette noise with context-aware `enablement` / `when` gates.
- Surface `Isabelle: Explain Current Mode` directly from more mode-gated command
  failures.
- Record screenshots and GIFs for the walkthrough/Marketplace listing.
- Add a Windows PowerShell ExecutionPolicy probe if real users hit locked-down
  corporate machines.
- Add a one-click retry affordance when LSP auto-start is suppressed by a sticky
  failure key.
