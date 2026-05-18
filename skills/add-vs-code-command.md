---
name: add-vs-code-command
description: Add a new entry to the Isabelle PIDE command palette and wire it through to a handler.
when-to-use: When the user asks for a new "Isabelle: …" command in the Command Palette. This skill covers the full wiring from `package.json` to the handler to the test, and the conventions that keep the command consistent with the existing 48.
---

# Add a new VS Code command

This extension registers all of its commands declaratively in `package.json` (so the palette knows about them) **and** programmatically in `src/extension.ts` (so they actually do something). Both pieces must be added together — adding only one results in either a palette entry that errors when invoked, or a hidden command no user can find.

## Anatomy of an existing command

For reference, look at `isabelle.checkPrerequisites`:

- **`package.json` → `contributes.commands`**: title and command id
  ```json
  { "command": "isabelle.checkPrerequisites", "title": "Isabelle: Check Setup Prerequisites" }
  ```
- **`package.json` → `activationEvents`**: ensures the extension activates when the command is invoked from the palette before any `.thy` file is open
  ```json
  "onCommand:isabelle.checkPrerequisites"
  ```
- **`src/extension.ts` → inside `activate()`** registration block, added to `context.subscriptions.push(...)`:
  ```ts
  vscode.commands.registerCommand("isabelle.checkPrerequisites", () => runPrerequisiteCheck({ force: true })),
  ```
- **Handler logic** lives elsewhere — for `checkPrerequisites`, it's the `runPrerequisiteCheck` helper at the bottom of `extension.ts`, which delegates to `PrerequisiteChecker.runCheck()` + `notifyIfMissing()`.

## Steps

### 1. Pick a command id

`isabelle.<verbDescriptor>` in lowerCamelCase. Look at existing ids in `package.json` `contributes.commands` for prior art. Examples: `isabelle.buildActiveSession`, `isabelle.refreshTheoryGraph`, `isabelle.previewTheoryInSplit`.

The user-visible **title** always starts with `Isabelle: ` followed by sentence case.

### 2. Register in `package.json`

Add an entry to `contributes.commands`:

```json
{
  "command": "isabelle.yourNewCommand",
  "title": "Isabelle: Your New Command"
}
```

If the command should be invocable from the palette before any `.thy` file is open, add an activation event:

```json
"onCommand:isabelle.yourNewCommand"
```

(If the command only makes sense once an Isabelle theory is open, the `onLanguage:isabelle` activation event is already in `activationEvents` and you don't need to add anything.)

### 3. Wire the handler in `src/extension.ts`

Inside `activate()`, find the `context.subscriptions.push(...)` block and add:

```ts
vscode.commands.registerCommand("isabelle.yourNewCommand", () => yourCommandHandler(output)),
```

Implement `yourCommandHandler` outside `activate()` — keep `extension.ts` small by delegating into a domain module under `src/<area>/` whenever the logic is more than a few lines.

### 4. Decide where the real logic lives

| If the command is… | Put logic in… |
|---|---|
| Pure presentation (showing a quickpick, opening a file, etc.) | A helper in `extension.ts` |
| Operating on Isabelle CLI (build, run a tool) | `src/build/` |
| Touching documents (sync, status, decorations) | `src/document/` |
| Sledgehammer | `src/sledgehammer/` |
| Repair | `src/repair/` |
| Theory graph / outline | `src/theoryGraph/` or `src/semantic/` |
| New domain | New `src/<area>/` directory + module |

Per the repo convention (see [`AGENTS.md`](../AGENTS.md) "Test conventions"), the actual logic should live in a `vscode`-free module that takes injected dependencies. The handler in `extension.ts` is just the thin wiring that constructs the real `vscode` objects (`window`, `commands`, `workspace.getConfiguration(...)`) and passes them into the pure module.

### 5. Add a structural test

Add a test next to the pure module under `test/<area>/`. The test should exercise the logic with injected fakes — see `test/setup/PrerequisiteChecker.test.ts` for the cleanest current example.

```ts
import { describe, expect, it } from "vitest";
import { yourPureLogic } from "../../src/<area>/yourModule";

describe("yourPureLogic", () => {
  it("does the right thing", () => {
    // Inject fakes for spawn / fs / vscode UI surfaces
    const result = yourPureLogic({ spawn: fakeSpawn, ui: fakeUi });
    expect(result.ok).toBe(true);
  });
});
```

### 6. Decide on menu / keybinding contribution (optional)

Most commands live only in the palette. If the command should also appear in a view's title bar (the `…` menu), add it to `contributes.menus.view/title` with the appropriate `when` clause. See the existing `isabelle.refreshSessions` entry as the canonical example.

If the command should have a keybinding, add it to `contributes.keybindings`. Default keybindings are conservative — only add one if the command is invoked frequently.

### 7. Document if user-visible

- **`README.md` "Current milestone" → "Commands"** lists every command. Add yours alphabetically within the existing list.
- If the command is part of an onboarding flow, also add a reference in the appropriate `media/walkthrough/*.md` card — but **use a markdown command link** (`[**Run it**](command:isabelle.yourNewCommand)`) and **don't** hard-code counts ("the X commands"). See [`AGENTS.md`](../AGENTS.md) "Known gotchas" → the 52-commands trap.

### 8. Verify

```powershell
npm run check    # compile + 639+N tests pass (where N is your new tests)
npm run bundle   # confirm the bundle still produces a clean out/extension.js
```

Then load the extension into VS Code (`npm run install:extension`, or use a packaged `.vsix`) and:

1. Open the Command Palette.
2. Type `Isabelle:` and verify your command appears with the right title.
3. Invoke it and verify it does what you expect.

## Gotchas

- **Forgetting the activation event.** If `onCommand:<id>` is missing from `activationEvents`, the command works once the extension is activated (e.g. when you open a `.thy` file) but **silently fails** when invoked from a workspace with no `.thy` file open and the extension cold.
- **Order in `package.json` matters for diffs, not behavior.** Match the alphabetical-ish order of nearby commands so future merges don't conflict.
- **Don't register a command twice.** VS Code throws at activation if you do. The `context.subscriptions.push(...)` block in `extension.ts` is the single source of truth for runtime registration.
- **`registerCommand` returns a `Disposable`.** Always push it into `context.subscriptions` so it's torn down on extension deactivation — this is how every existing command is wired.
- **`isabelle.revealCommandSpan` is intentionally hidden.** It's registered in `extension.ts` but **not** in `contributes.commands`, so it isn't palette-visible. This is the pattern for commands that are only meant to be invoked programmatically from other extension code (e.g. when a tree view item is clicked). Use it deliberately, not by accident — most commands belong in `contributes.commands`.
