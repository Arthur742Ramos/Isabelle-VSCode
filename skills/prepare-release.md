---
name: prepare-release
description: Cut a new versioned release of the Isabelle PIDE VS Code extension.
when-to-use: When you're about to ship a new release — the Release workflow at .github/workflows/release.yml publishes a .vsix to GitHub Releases and (when VSCE_PAT is set) the VS Code Marketplace on every v* tag push.
---

# Prepare and ship a release

The Release workflow at `.github/workflows/release.yml` does the heavy lifting — your job is to drive `package.json` and `git` correctly so it fires.

## Preconditions

- You're on a clean checkout of `main` with no uncommitted changes.
- `npm run check` is green.
- `npm run package:validate` is green.
- The `docs/SMOKE_THEORY_CHECKLIST.md` release-candidate smoke record has real
  VS Code-hosted evidence for the candidate version. Do not treat a headless
  `isabelle build` as a substitute for the Smoke transcript.
- All PRs targeting this release have been merged.
- For Marketplace publish: a `VSCE_PAT` repo secret is configured under **Settings → Secrets and variables → Actions**. The publish step is gated and **no-ops cleanly** if the secret is absent — you can still cut a GitHub-Release-only build.

## Steps

### 1. Decide the next version

Follow [Semantic Versioning](https://semver.org/):

- **Patch** (e.g. `0.1.0` → `0.1.1`) — bug fixes only, no new features, no breaking changes.
- **Minor** (e.g. `0.1.0` → `0.2.0`) — new features, no breaking changes.
- **Major** (e.g. `0.1.0` → `1.0.0`) — breaking changes to the extension API (`src/api/IsabellePideExtensionApi.ts`), settings, or commands.

### 2. Bump `package.json`

```powershell
# from a freshly synced main checkout
git checkout -b release/v<X.Y.Z>
npm version <X.Y.Z> --no-git-tag-version
```

`npm version` rewrites both `package.json` and `package-lock.json` and refuses to bump backwards. The `--no-git-tag-version` flag keeps the tag-driven release workflow in charge of tagging (otherwise `npm version` would tag on the bump commit).

### 3. Commit the bump

```powershell
git add package.json package-lock.json
git commit -m "chore(release): v<X.Y.Z>"
git push -u origin release/v<X.Y.Z>
```

Open a PR with the standard template, title `chore(release): v<X.Y.Z>`. The PR should contain **only** the version bump — no other changes.

### 4. Merge the PR

Once CI is green and the PR is merged to `main`, switch back to `main` and pull.

```powershell
git checkout main
git pull
```

### 5. Tag and push

Before tagging, re-open `docs/SMOKE_THEORY_CHECKLIST.md` and confirm the
release-candidate table is populated for the version you are about to tag. If
`package.json` was pre-bumped in an earlier hardening PR, keep the existing
version and only tag after the smoke evidence is recorded.

```powershell
git tag v<X.Y.Z>
git push origin v<X.Y.Z>
```

The Release workflow will run automatically on tag push.

### 6. Verify

Watch the workflow run at `https://github.com/Arthur742Ramos/Isabelle-VSCode/actions`. It will:

1. Verify the tag matches `package.json` version (`v<X.Y.Z>` ↔ `version: "<X.Y.Z>"`). The workflow fails fast if these disagree.
2. Run `npm run check` and `npm run backend:package` (Java + sbt installed by the workflow itself).
3. Produce `isabelle-pide-vscode-<X.Y.Z>.vsix`.
4. Assert the bundled `extension.js`, the backend fat jar, and `package.json` are present in the `.vsix`.
5. Publish a GitHub Release with the `.vsix` attached and end-user install instructions in the body.
6. **If `VSCE_PAT` is set:** publish to the VS Code Marketplace via `npx @vscode/vsce publish --packagePath … --pat …`.
7. **If `VSCE_PAT` is not set:** print a `::notice::` explaining how to enable it next time.

The `.vsix` will appear under [Releases](https://github.com/Arthur742Ramos/Isabelle-VSCode/releases) within ~3 minutes of the tag push.

## Gotchas

### Tag-version mismatch

If you tag a version that doesn't match `package.json`, the workflow fails the "Verify tag matches package.json version" step **before** building. To recover:

```powershell
git push --delete origin v<X.Y.Z>     # remove the bad tag
git tag -d v<X.Y.Z>                   # locally too
# fix package.json, re-tag, push again
```

### Re-running for a tag

A tag is immutable but the workflow run isn't — re-run from the Actions tab if a step failed for transient reasons (network, runner flake). The `concurrency: release-${{ github.ref }}` group ensures no duplicate run starts.

### First-time Marketplace publish

Before the **first** Marketplace publish, the publisher (`arthur742ramos`) must exist on https://marketplace.visualstudio.com/manage. The `vsce publish` step will fail with a clear error if it doesn't — create the publisher first, then re-run the workflow.

## What this skill does NOT cover

- **Pre-release / preview tagging** (`v0.2.0-rc.1`, etc.) — the workflow's tag matcher is `v*` which accepts these, but the `npm version` syntax is different (`npm version prerelease --preid=rc`) and Marketplace handling of pre-release tags has its own ceremony. Open an issue if you want this codified.
- **Rolling back a bad release** — once published to the Marketplace, you generally [unpublish a specific version](https://github.com/microsoft/vscode-vsce#unpublishing-extensions) rather than amend it. Coordinate via an issue.
