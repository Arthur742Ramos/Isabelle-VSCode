# isabelle-pide-helpers

A small Copilot CLI extension scoped to this repository. It runs only inside [Copilot CLI](https://github.com/github/copilot-cli) sessions; humans and other agents are unaffected.

## What it registers

| Tool | What it does | When to use it |
|---|---|---|
| `isabelle_lint_walkthrough` | Scans `media/walkthrough/*.md` and checks (a) every `[label](command:foo)` markdown link references a command actually registered in `package.json`'s `contributes.commands`, and (b) no card hard-codes drift-prone counts like "52 commands" / "639 tests" / "5 steps". | Before opening a PR that touches walkthrough cards or contributed commands. |
| `isabelle_check_setup` | Probes the local toolchain (Node, npm, Java 21+, sbt, Isabelle 2019+, `code`/`code-insiders` CLI) and reports which Tier of changes are buildable on this machine. | At session start when you're not sure whether `npm run check`, `npm run backend:*`, or `npm run install:extension` will work locally. |

Both tools are read-only — they spawn child processes with short timeouts and parse output, never mutate the repo.

## Why two tools and not more

The candidates that didn't make the cut:

- **`isabelle_validate_vsix`** — duplicates the "Confirm VSIX contents" step in `.github/workflows/release.yml`. CI already catches missing `extension.js` / missing fat jar before tags publish. Local pre-release sanity check is the only real use case, and we tag releases rarely enough that the extra surface area wasn't worth it.
- **`isabelle_run_setup_workflow`** — wrapper that runs `npm install && npm run check`. Trivially expressed as a shell command; no value-add over the `task` agent.
- **`isabelle_warn_on_workflow_push` hook** — would warn before a `.github/workflows/*` push that you may need the `Remove-Item Env:\GH_TOKEN` workaround. Hooks operate on tool calls, not on shell exit codes, so this would either fire too eagerly (every shell command) or not at all (no good trigger). The same lesson is captured in `AGENTS.md` "Known gotchas" → workflow-scope OAuth, which any agent that reads AGENTS.md will internalize.

If you want one of these added, open an issue or send a PR.

## Maintenance notes

- Pure ESM. No build step. `npm install` doesn't touch it.
- Imports `@github/copilot-sdk/extension` — resolved automatically by Copilot CLI's module resolver at runtime, **not** installed via npm. Don't add it to `package.json`.
- Failures from either tool surface as `resultType: "failure"` so the agent can react instead of the extension process crashing.
- The `lint_walkthrough` tool reads `package.json` and `media/walkthrough/*.md` directly via `node:fs`; if the repo layout changes (e.g. walkthrough cards move), update the `WALKTHROUGH_DIR` constant in `extension.mjs`.

## How to reload after editing

```text
extensions_reload({})
```

Run it from within a Copilot CLI session after editing `extension.mjs`. New tool descriptions take effect immediately within the same turn.
