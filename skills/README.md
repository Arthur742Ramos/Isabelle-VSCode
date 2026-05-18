# Skills

Cross-agent **skill files** for working in this repository. Each file is a self-contained playbook describing one workflow: when to use it, the exact steps, and verification.

The files are **plain markdown with optional YAML frontmatter** so they're consumable by any AI coding agent (Claude Code, GitHub Copilot, Cursor, Aider, Codex, etc.) and also readable by humans. There is no tooling required — agents discover them either via direct path reference (`skills/<name>.md`), the index below, or pointers from [`AGENTS.md`](../AGENTS.md).

## Available skills

| Skill | When to use |
|---|---|
| [**prepare-release**](prepare-release.md) | Cutting a new versioned release — bump `package.json`, tag, push, verify GitHub Release + Marketplace publish. |
| [**add-vs-code-command**](add-vs-code-command.md) | Adding a new entry to the `Isabelle:` command palette — `package.json` registration, activation events, handler wiring, tests. |
| [**address-pr-review-comments**](address-pr-review-comments.md) | Responding to inline review threads — fetch unresolved threads, evaluate each on merits, fix, reply, resolve via GraphQL. Includes the Windows `gh api` direct-call fallback when the built-in helper script trips on Git Bash path mangling. |

## Skill-file format

```markdown
---
name: skill-name
description: One-line summary (used by agents that read frontmatter).
when-to-use: When the skill applies, in 1–2 sentences.
---

# Skill name

…full playbook…
```

The YAML frontmatter is optional but recommended — Claude Code and similar agents parse it. Other agents simply read the markdown.

## Adding a new skill

1. Create `skills/<kebab-case-name>.md` with the frontmatter above.
2. Add a row to the index in this file.
3. Add a one-line pointer in [`AGENTS.md`](../AGENTS.md) "Further reading" if the skill is broadly applicable.
4. Open a PR with title `docs(skills): add <skill-name>` and the standard PR template.

A good skill is **concrete, repo-specific, and verifiable** — it tells the agent exactly which files to change, which commands to run, and how to know the change worked. Avoid skills that just paraphrase upstream documentation; link to it instead.

## Relationship to other agent files

| File / directory | Purpose |
|---|---|
| `AGENTS.md` | Canonical guide — conventions, toolchain, gotchas. Read once per repo. |
| `.github/copilot-instructions.md` | Compact pointer file GitHub Copilot reads automatically. |
| `skills/<name>.md` | Per-workflow playbooks. Read on demand when you're about to do that thing. |
| `.github/extensions/isabelle-pide-helpers/extension.mjs` | Copilot CLI-specific executable tools (lint walkthrough, check setup). Optional; only loads in Copilot CLI sessions. |
| `CONTRIBUTING.md` | Human-friendly contributor onboarding. |

The split: **AGENTS.md is what you should already know; skills are what you look up when you need them.**
