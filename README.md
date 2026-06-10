<div align="center">

<img src="media/icon.png" width="120" alt="Isabelle PIDE for VS Code logo" />

# Isabelle PIDE for VS Code

**The interactive Isabelle proof experience, in your editor.**
Live proof state, Sledgehammer, build diagnostics, and theory tooling — backed by a real Isabelle/PIDE engine.

[![Latest release](https://img.shields.io/github/v/release/Arthur742Ramos/Isabelle-VSCode?include_prereleases&sort=semver&label=release&color=2563eb)](https://github.com/Arthur742Ramos/Isabelle-VSCode/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/Arthur742Ramos/Isabelle-VSCode/ci.yml?branch=main&label=CI&logo=github)](https://github.com/Arthur742Ramos/Isabelle-VSCode/actions/workflows/ci.yml)
[![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.90-007ACC?logo=visualstudiocode&logoColor=white)](https://code.visualstudio.com/)
[![License: MIT](https://img.shields.io/github/license/Arthur742Ramos/Isabelle-VSCode?color=22c55e)](LICENSE)
[![Status: preview](https://img.shields.io/badge/status-preview%20%2F%20alpha-f59e0b)](#status-and-limitations)
[![Platforms](https://img.shields.io/badge/platforms-Windows%20%C2%B7%20macOS%20%C2%B7%20Linux-64748b)](#installation)

</div>

> **Preview / alpha.** `0.1.0-alpha.6` is installable today from [GitHub Releases](https://github.com/Arthur742Ramos/Isabelle-VSCode/releases); it is not on the Marketplace yet. It is a capable, well-tested alpha — see [Status and limitations](#status-and-limitations) for exactly what works and what is still in progress.

---

Isabelle PIDE brings the interactive [Isabelle/PIDE](https://isabelle.in.tum.de/) proof workflow into VS Code: **live proof state**, **Sledgehammer** proof search with one-click insertion, **streamed build diagnostics**, **theory navigation**, and **Unicode-aware editing**.

The rich PIDE features light up **automatically** the moment Isabelle is detected — no configuration. And a fast **local foundation** (syntax, folding, outline, navigation, an offline proof-gap audit) works the instant you open a `.thy` file, with **no Isabelle, Java, or setup required**.

## ✨ Why you'll like it

- **Zero-config when Isabelle is present.** Install Isabelle, open a theory, and the bundled PIDE language server auto-starts — proof state, Sledgehammer, decorations, and previews just appear.
- **Useful even without Isabelle.** Highlighting, folding, outlines, a theory dependency graph, go-to-definition, and a `sorry`/`oops` audit all run locally and instantly.
- **Real PIDE, not a guess.** A Scala/Headless backend talks to Isabelle's own Headless API, so document checks, per-cursor proof state, and Sledgehammer work even when the LSP relay is off.
- **Honest by design.** Local-only surfaces are clearly labelled, proof actions never claim verification, and the AI repair seam never auto-applies edits or calls a network service without your explicit consent.
- **Cross-platform & batteries-included.** Per-platform builds bundle a Java 21 runtime, so most users need nothing but Isabelle.

## 🧰 Features

### ⚡ Works instantly — no Isabelle, Java, or setup required

- **Syntax & semantic highlighting** for Isabelle commands, declarations, and symbols.
- **Snippets** — tab-completable skeletons for the core constructs (`theory`, `lemma`, `theorem`, `fun`, `definition`, `datatype`, `locale`, `proof`, induction/cases proofs, …); the `theory` skeleton even defaults its name to the file name, as Isabelle requires.
- **New theory scaffolding** — `Isabelle: New Theory File` creates a correctly-named `<Name>.thy` (Isabelle requires the theory name to equal the file name) with a ready `theory … imports Main begin … end` header, validating the name as you type.
- **Offline symbol entry** — type `\<` and complete the full Isabelle symbol table (`\<forall>` → ∀, `\<Longrightarrow>` → ⟹, …) with glyph previews and ASCII abbreviations, with no prover or language server running. `Isabelle: Insert Symbol` also lets you browse/search the whole table by glyph, name, group, or abbreviation.
- **Offline method completion** — after `apply`, `by`, or `proof` (or a method combinator), get completions for the core HOL proof methods (`simp`, `auto`, `blast`, `induct`, `rule`, `metis`, …), each tagged by role. The gate is tight enough to stay out of argument and term positions. No prover required.
- **Symbol hover** — hover over any `\<...>` token *or* its rendered glyph (∀, ⟹, λ) to see the symbol name, Unicode code point, group, and the ASCII abbreviations Isabelle accepts.
- **Command & method hovers** — hover an outer-syntax command (`lemma`, `instantiation`, `lift_definition`, …) or a proof method in method position (`simp`, `auto`, `induct`, `metis`, …) to see what it does, labelled by role. No prover required.
- **Symbol conversion** — `Isabelle: Convert Symbols to Unicode` / `to ASCII` rewrite `\<forall>` ↔ ∀ across the selection or whole file (lossless, offline) — paste an ASCII proof and render it, or normalize back to portable ASCII.
- **Structural code folding** — fold `proof … qed` blocks, the `section`/`subsection` hierarchy, multi-line comments, and the `theory … begin` header (comment/cartouche/string aware).
- **Unicode bracket editing** — auto-close and surround the cartouche `‹ ›` and `⟨ ⟩` / `⟦ ⟧` pairs, with symbol- and prime-aware word selection (`\<alpha>`, `\<^sub>`, `xs'`).
- **Explorer views** — **Sessions**, **Theory Graph** (forward/reverse dependencies), **Theory Outline**, and **Proof Outline** trees that follow the active theory.
- **Navigation** — go-to-definition for local declarations, command/symbol hovers, import links, and next/previous/reveal command jumps.
- **Offline proof-gap audit** — flags `sorry` and `oops` in the Problems panel with no prover running (it ignores comments, cartouches, and strings).

### 🚀 With Isabelle installed — auto-detected, zero-config

- **Build & diagnostics** — run `isabelle build` for the active session with streamed output and clickable, source-located diagnostics in the Problems panel.
- **Live proof state** — a cursor-aware panel renders structured goals and context, plus a caret-driven *dynamic output* sub-panel, with auto-update / margin / re-anchor controls.
- **Sledgehammer** — search for proofs, insert a suggestion in one click, browse run history and replay, and **minimize an existing proof at the cursor**.
- **PIDE editor overlay** — keyword / variable / type / error decorations published by Isabelle, layered on the local highlighting.
- **Symbol abbreviations** — completion that expands `\<lambda>` → `λ`, `==>` → `⟹`, `[|` → `⟦`, and the rest of Isabelle's abbreviation table.
- **Live theory preview**, **documentation browser** (Tutorial, Isar-Ref, Sledgehammer manuals…), and **spell-checker dictionary** commands.

### 🔒 Checked, safety-first AI repair (opt-in)

- Capture a **checked-repair bundle** (document, diagnostics, proof state) to paste into any AI tool you already trust — no network call.
- Returned diffs go through a **strict unified-diff preview** that rejects unsafe shapes. The extension **never auto-applies edits** and **never calls a third-party service** unless you both select a provider *and* acknowledge sharing. See [docs/AI_REPAIR.md](docs/AI_REPAIR.md).

> Features tagged as PIDE/preview/Sledgehammer/proof-state use the optional **Isabelle language server**, which auto-starts when Isabelle is detected, and/or the **Headless PIDE backend**. The local foundation stays available as a fallback whenever Isabelle is off or unavailable. Every command lives under the **`Isabelle:`** prefix in the Command Palette.

## 🚀 Quick start

1. **Install the extension.** Download the `.vsix` for your platform from the [latest release](https://github.com/Arthur742Ramos/Isabelle-VSCode/releases) and install it:
   ```powershell
   code --install-extension isabelle-pide-vscode-<version>-<target>.vsix
   ```
   …or in VS Code: **Extensions ▸ ⋯ ▸ Install from VSIX…**
2. **Open a `.thy` file.** Highlighting, folding, outlines, navigation, and the proof-gap audit work immediately.
3. **(Optional) Add Isabelle** 2019+ on your `PATH` (or set `isabelle.executablePath`). The extension auto-detects it and starts the PIDE language server — run **`Isabelle: Check Setup Prerequisites`** or follow the **Get started with Isabelle PIDE** walkthrough if anything is missing.

Per-platform builds bundle Java 21, so most users don't need to install Java at all.

## Installation

The extension is not yet on the VS Code Marketplace ([tracked in #97](https://github.com/Arthur742Ramos/Isabelle-VSCode/issues/97)). Install a pre-built `.vsix` from Releases, or build from source.

### Option 1 — Pre-built `.vsix` from GitHub Releases *(recommended)*

Open the [Releases page](https://github.com/Arthur742Ramos/Isabelle-VSCode/releases), pick the newest `v0.1.0-alpha.*`, and download the asset matching the **host where the extension runs** (for SSH-Remote / WSL / dev-container setups, that is the remote host's OS + CPU, not your laptop's):

| Asset suffix | Host platform | Java bundled |
| --- | --- | --- |
| `-win32-x64.vsix` | Windows x64 | ✅ |
| `-win32-arm64.vsix` | Windows on ARM | ✅ |
| `-linux-x64.vsix` | Linux x64 (glibc) | ✅ |
| `-linux-arm64.vsix` | Linux ARM64 (glibc) | ✅ |
| `-alpine-x64.vsix` | Alpine / musl x64 | ✅ |
| `-alpine-arm64.vsix` | Alpine / musl ARM64 | ✅ |
| `-darwin-arm64.vsix` | macOS Apple silicon | ✅ |
| *(no suffix)* `isabelle-pide-vscode-<version>.vsix` | Universal (other platforms, bring-your-own-Java) | ❌ |

Then install via **Extensions ▸ ⋯ ▸ Install from VSIX…** or `code --install-extension <file>.vsix`, and reload if prompted.

> Per-platform builds embed Eclipse Temurin 21 under `extension/jre/` — see [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
> **macOS Intel** is not in the per-platform matrix (dropped in v0.1.0-alpha.3); use the universal `.vsix` with Java 21+ on `PATH`. See AGENTS.md §17.
> **macOS Gatekeeper:** if the bundled JRE triggers *"Apple cannot check it for malicious software"*, clear the quarantine flag:
> ```bash
> xattr -dr com.apple.quarantine ~/.vscode/extensions/arthur742ramos.isabelle-pide-vscode-*/extension/jre
> ```

### Option 2 — Build from source *(one command)*

Prerequisites: **Node.js 20+**, **Java 21**, **sbt**, and the `code` CLI on `PATH`.

```powershell
git clone https://github.com/Arthur742Ramos/Isabelle-VSCode.git
cd Isabelle-VSCode
npm install
npm run install:extension   # compile + bundle + sbt assembly + package + install
```

Use `npm run package` instead if you only want the `.vsix`. Source builds produce the **universal** flavor (no bundled JRE).

## Requirements

The extension **activates with no prerequisites** — basic editing features always work. The PIDE features need a runtime:

| You want… | Java 21+ | Isabelle 2019+ |
| --- | --- | --- |
| Local editing (highlighting, folding, outlines, audit) | — | — |
| `isabelle build` diagnostics, the Isabelle language server, and LSP-mode proof state / Sledgehammer / preview | — | ✅ |
| Headless PIDE backend (document checks, per-cursor proof state, backend Sledgehammer, proof minimization) and zero-config LSP **auto-start** | ✅ *(bundled in per-platform `.vsix`)* | ✅ |

> The language server itself runs on Isabelle's own bundled JDK, so you can force it on (`"isabelle.languageServer.enabled": true`) without a separate Java. A Java 21+ runtime is what the extension's **Scala/Headless backend** needs and what the convenience **auto-start** probes for — and it's bundled in the per-platform `.vsix`, so most users never install Java.

If you need to install them yourself, any vendor's Java 21 works:

| OS | Java 21+ | Isabelle 2019+ |
| --- | --- | --- |
| **Windows** | `winget install Microsoft.OpenJDK.21` | [isabelle.in.tum.de](https://isabelle.in.tum.de/installation.html) |
| **macOS** | `brew install --cask temurin@21` | [isabelle.in.tum.de](https://isabelle.in.tum.de/installation.html) (or `brew install --cask isabelle`) |
| **Debian / Ubuntu** | `sudo apt install openjdk-21-jdk` | [isabelle.in.tum.de](https://isabelle.in.tum.de/installation.html) |
| **Fedora / RHEL** | `sudo dnf install java-21-openjdk` | [isabelle.in.tum.de](https://isabelle.in.tum.de/installation.html) |
| **Arch** | `sudo pacman -S jdk21-openjdk` | AUR (`isabelle`) or tarball |

After installing Isabelle, put `isabelle` on `PATH` or set `isabelle.executablePath`. On Windows the launcher is `isabelle.ps1`; the extension wraps it via `powershell.exe -File` automatically, and **`Isabelle: Check Setup Prerequisites`** reports an actionable hint if a locked-down PowerShell policy blocks it.

## The Isabelle language server

The extension can run Isabelle's bundled `isabelle vscode_server` as a child language server and route PIDE-flavoured traffic (diagnostics, hover, definition, completion, decorations, proof state, dynamic output, Sledgehammer, theory preview, abbreviation completion, documentation, spell-checker) through it.

**By default it auto-starts** whenever the activation-time check finds a working Java 21+ and a reachable Isabelle 2019+ — so a fresh install with Isabelle on `PATH` gives you the rich PIDE experience with **zero configuration**. The connection state shows as a status-bar item (`Isabelle LSP: starting / running / failed`); click it for the command line, version, and last error. A failed auto-start is remembered per Isabelle runtime so it doesn't retry a broken config on every launch — clear it with **`Isabelle: Retry Language Server Auto-Start`**.

| Setting | Default | Purpose |
| --- | --- | --- |
| `isabelle.languageServer.enabled` | *(unset)* | Force the LSP on (`true`) or off (`false`); unset defers to `autoStart`. |
| `isabelle.languageServer.autoStart` | `true` | Auto-start on detection when `enabled` is unset. |
| `isabelle.languageServer.extraArgs` | `[]` | Extra args for `isabelle vscode_server` (e.g. `["-L", "./isabelle.log"]`). |
| `isabelle.languageServer.logVerbose` | `false` | Log full LSP traffic to a trace channel (noisy). |

**Honest boundary:** when the LSP is running, VS Code aggregates results from **both** the LSP and the extension's local syntax-only providers; the local foundation stays as the fallback. The Scala **Headless `PideBridge`** additionally powers document checks, per-cursor proof state, Sledgehammer search, and proof minimization without the LSP. See [docs/PIDE_INTEGRATION.md](docs/PIDE_INTEGRATION.md).

## Checked repair workflow

A conservative, local foundation for proof-repair tooling that never edits your files for you:

1. **`Isabelle: Create Checked Repair Request`** captures the document URI/version, cursor, diagnostics, and proof state into a Markdown bundle you review.
2. Save a proposed fix as a unified diff and run **`Isabelle: Preview Repair Patch`** — it rejects unsafe diffs (new/deleted files, renames, binary, absolute paths, traversal, dirty targets, mismatched context) and opens read-only diff previews plus a verification plan.
3. Apply trusted edits **yourself**; the extension intentionally never writes patch contents for you.
4. **`Isabelle: Check Current Workspace for Repair`** reruns the active-session build — a repair is not reported as checked until that Isabelle build succeeds.

`Isabelle: Copy Checked Repair Request to Clipboard` and the experimental `Isabelle: Request AI Repair Suggestion` build on the same bundle; both keep you in control of any sharing. Full safety contract: [docs/AI_REPAIR.md](docs/AI_REPAIR.md).

## Status and limitations

`0.1.0-alpha.6` is a credible alpha with the hybrid PIDE/LSP/Headless architecture, bundled per-platform JRE assets, proof state, Sledgehammer (search / insert / minimize), theory tooling, and the checked repair seam. The remaining work is mostly confidence and presentation:

- **Live Tier-2 smoke evidence** against a real Isabelle install is still being recorded ([#90](https://github.com/Arthur742Ramos/Isabelle-VSCode/issues/90)).
- **Screenshots / GIFs** are not captured yet ([#93](https://github.com/Arthur742Ramos/Isabelle-VSCode/issues/93)).
- **Marketplace publication** is deferred until the smoke transcript and visuals are ready ([#97](https://github.com/Arthur742Ramos/Isabelle-VSCode/issues/97)).
- `textDocument/documentSymbol` is **upstream-blocked** in Isabelle 2025-2, so Outline / breadcrumbs use the local provider.
- AFP-scale dogfooding and latency notes are still to be recorded before claiming beta.

For a fast confidence check, run [`docs/SMOKE_THEORY_CHECKLIST.md`](docs/SMOKE_THEORY_CHECKLIST.md) against [`examples/Smoke.thy`](examples/Smoke.thy).

## 🏗️ How it works

```text
VS Code Extension (TypeScript)   commands · panels · decorations · folding · navigation
        │  Content-Length JSON-RPC          │  vscode-languageclient (optional)
        ▼                                    ▼
Scala backend                         isabelle vscode_server (LSP relay)
  sessions · build · Headless PideBridge      live PIDE diagnostics, proof state,
        │                                      decorations, preview, Sledgehammer
        ▼
Isabelle / PIDE  —  the semantic source of truth
```

The Scala backend and the LSP relay are **additive**: backend PIDE operations keep working without the LSP whenever Isabelle can be bootstrapped, while the LSP owns live editor-facing PIDE features when it is running.

> *Motto: VS Code for UI, Isabelle/Scala for semantics, Isabelle/ML for truth.*

## Roadmap

See [docs/ROADMAP_STATUS.md](docs/ROADMAP_STATUS.md) for the consolidated, per-milestone status (shipped / open / upstream-blocked). The milestones are: skeleton → session discovery → build integration → PIDE document connection → semantic markup → proof state panel → Sledgehammer workflow → theory graph & tooling → checked AI repair loop.

## Contributing

Contributions are welcome!

- **Humans:** start with [`CONTRIBUTING.md`](CONTRIBUTING.md) for the quick-start and PR checklist.
- **AI coding agents** (Copilot, Claude Code, Cursor, Aider, …): read [`AGENTS.md`](AGENTS.md) — architecture map, validation matrix, conventions, and gotchas.

```powershell
npm install        # once
npm run check      # compile + vitest (fast)
npm run package    # build a redistributable .vsix
```

`npm run backend:test` runs the Scala suite (needs Java 21 + sbt); `npm run test:integration` runs the hosted VS Code suite. More targets are documented in [`AGENTS.md`](AGENTS.md) and [`CONTRIBUTING.md`](CONTRIBUTING.md).

## License & acknowledgements

Released under the [MIT License](LICENSE). Isabelle/PIDE jars are **never** bundled — they are loaded from your local install at runtime; per-platform builds bundle Eclipse Temurin under the terms in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md). Built on the work of the [Isabelle](https://isabelle.in.tum.de/) team. Security policy: [`SECURITY.md`](SECURITY.md).
