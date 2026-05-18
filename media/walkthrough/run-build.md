# Try `Isabelle: Build Active Session`

The most direct way to confirm the extension is correctly wired to your Isabelle install is to run the CLI build runner against a session.

## What it does

`Isabelle: Build Active Session` invokes `isabelle build` for whichever session is currently active in the **Isabelle Sessions** view, streams the output into the `Isabelle PIDE` channel, and parses Isabelle's error reports into the **Problems** panel with clickable file/line locations.

It uses the `isabelle` CLI directly — it does **not** require the Scala backend or the experimental language server.

## Steps

1. Make sure Isabelle is reachable. Run `Isabelle: Check Setup Prerequisites` from the Command Palette to confirm.
2. Make sure a session is active. Click the **Isabelle: no active session** status-bar item, or run `Isabelle: Select Active Session`. Sessions are auto-discovered from `ROOT` / `ROOTS` files in your workspace.
3. Run **`Isabelle: Build Active Session`** from the Command Palette.

## What you should see

- The `Isabelle PIDE` output channel opens and streams build progress.
- On success, no entries appear in **Problems**.
- On error, file/line markers appear in **Problems** that you can click to jump to the source.

## Cancelling

Long builds can be aborted with **`Isabelle: Cancel Build`**.

## After this

You're set up. Explore the other commands and panels. The Isabelle language server auto-starts as soon as the activation-time check sees both Java and Isabelle on PATH, so you should see live PIDE features (real diagnostics, proof state, decorations, sledgehammer) without any extra configuration. To force it off, set `isabelle.languageServer.enabled` to `false`.
