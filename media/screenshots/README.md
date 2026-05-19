# Walkthrough screenshots

This folder holds the PNG / GIF assets that the [installation walkthrough](../walkthrough/) and the README reference. It is intentionally checked into git so the assets travel with each `.vsix` and render correctly on the VS Code Marketplace listing once we publish there.

**Status:** this folder is the **capture spec**, not the captures. The PNGs/GIFs listed below have not yet been recorded — they require a contributor with a working Isabelle install on a real graphical machine to capture them. CLI-only agents (Copilot CLI, Copilot Coding Agent, etc.) cannot produce screenshots without a real display.

If you are that contributor: see "How to capture" below. Drop the PNGs in this directory with the exact filenames listed, then open a small follow-up PR (`docs: add walkthrough screenshots`) that adds the matching `![alt](../screenshots/NN-*.png)` references in the walkthrough cards and the README. Once both pieces land, the alpha→beta soft gate (in [`docs/ROADMAP_STATUS.md`](../../docs/ROADMAP_STATUS.md#beta-readiness)) ticks itself off.

We do NOT ship broken image references ahead of the captures because the walkthrough is the first thing a new user sees — a gray "image missing" icon next to "Open a theory" looks worse than no image at all.

## Required captures

Each row is a single PNG (or short looping GIF where called out). Aim for ~1200×800 logical pixels (Retina/HiDPI is fine; VS Code will downscale on Marketplace). Use the **Default Dark+ Modern** theme so the screenshots match the Marketplace's preferred contrast. Crop tightly around the relevant UI surface; do NOT include the full VS Code chrome (title bar, file picker, terminal pane) unless explicitly noted.

| Filename | What to capture | Walkthrough card |
|---|---|---|
| `01-proof-state-panel.png` | The **Isabelle Proof State** view in the Explorer sidebar, with the cursor on `add_zero_right_smoke`'s `by simp` in `examples/Smoke.thy`. Goal text should be visible (`n + 0 = n`). LSP must be `running`. | `open-theory.md` (after the "What you should see immediately" list) |
| `02-sledgehammer-prover-output.png` | The **Isabelle Sledgehammer** panel after a successful run against the `sorry` in `conj_commute_smoke`. Show the "Prover output" section with at least two suggestions (typically `blast` and `metis`). | `run-build.md` (after the "What you should see" list) |
| `03-theory-graph.png` | The **Isabelle Theory Graph** view in the Explorer sidebar, expanded so the `Isabelle_VSCode_Smoke` session and the `Smoke` theory are visible. If the workspace has any AFP sessions, include 1–2 of them for context. | `open-theory.md` (in the "Explorer sidebar" bullet) |
| `04-status-bar-lsp-running.png` | A tight crop of the bottom status bar showing both `Isabelle: Isabelle_VSCode_Smoke` (active session) and `Isabelle LSP: running`. ~600×40 pixels. | README "Isabelle language server" section |
| `05-walkthrough-getting-started.gif` *(optional, ~10 s, ≤2 MB)* | A short loop: open `examples/Smoke.thy` → status bar flips to `Isabelle LSP: starting` → `running` → proof state panel populates. Record at 15 fps via [VS Code's built-in screen recorder](https://code.visualstudio.com/docs/getstarted/keybindings) or any platform tool. | README hero (top of file, above the architecture diagram) |

## How to capture

1. **Set up the smoke project** per [`docs/SMOKE_THEORY_CHECKLIST.md`](../../docs/SMOKE_THEORY_CHECKLIST.md) — open the repo, pick session `Isabelle_VSCode_Smoke`, wait for the LSP to report `running`.
2. **Use Default Dark+ Modern**: `Ctrl/Cmd+K Ctrl/Cmd+T` → "Default Dark+ Modern".
3. **Disable distracting state**: close the Source Control / Run / Extensions side-bar tabs you don't need; close any open notification toasts; hide the minimap (`View > Appearance > Show Minimap` → off) to reduce noise.
4. **Capture at native resolution**, then crop to the surface listed in the table above. On Windows: `Win+Shift+S` → Rectangle. On macOS: `Cmd+Shift+4`. On Linux: any GNOME/KDE screenshot tool.
5. **Save as PNG with no metadata stripping concerns** (vsce packaging strips EXIF anyway, but try to avoid screenshots that reveal local paths in the file tab strip — crop them out or rename the workspace folder to something neutral like `isabelle-vscode/` first).
6. **For the GIF**, use a tool like [ScreenToGif](https://www.screentogif.com/) (Windows), [Gifski](https://gif.ski/) (macOS), or [peek](https://github.com/phw/peek) (Linux). Keep the file under 2 MB so the README load stays snappy on the Marketplace.

## What to do once they're captured

1. Drop the files in this directory with the exact filenames in the table above.
2. Open a small follow-up PR that adds the corresponding `![alt](path)` references in the walkthrough cards (`media/walkthrough/*.md`) and `README.md`. Use the "Walkthrough card" column of the table above as the placement guide.
3. Run `npm run package:validate` to confirm the resulting `.vsix` still passes the layout integrity check.
4. Tick the matching box in the [`docs/ROADMAP_STATUS.md`](../../docs/ROADMAP_STATUS.md#beta-readiness) "Soft gates" section.
5. Open the PR with the `documentation` label.

## Why this folder is intentionally non-fabricated

Generating fake / placeholder PNGs of the proof state panel would mislead users about what the extension actually shows and would have to be re-replaced before any Marketplace listing. The walkthrough cards are designed to work with or without these screenshots — they currently describe the expected UI in prose. Real captures are a polish item, not a blocker.
