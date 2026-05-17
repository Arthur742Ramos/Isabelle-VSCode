# PIDE integration roadmap

This document tracks the staged plan for moving the Scala backend from
its current local-syntax-only behavior to real Isabelle/PIDE
integration through the
[`scala-isabelle`](https://github.com/dominique-unruh/scala-isabelle)
library. It is intentionally a **placeholder**: the milestones listed
below describe upcoming work, not what the backend does today.

## Current state

- The backend exposes a `PideBridge` trait (see
  `backend/src/main/scala/dev/isabelle/vscode/server/PideBridge.scala`).
- The only bridge wired into `Main.scala` is `LocalSyntaxPideBridge`,
  which produces command spans from local syntax and reports
  `proofState`/`sledgehammer` as `status: "unavailable"`.
- A second bridge, `ScalaIsabellePideBridge`, exists as a **scaffold**.
  It depends on `de.unruh:scala-isabelle:0.4.5` so the seam compiles,
  but it does not start an Isabelle process. `documentResult` delegates
  to the supplied fallback bridge; `proofState` and `sledgehammer`
  mirror the fallback's response shape and override `message` with an
  honest scaffold-specific text.
- `ScalaIsabellePideBridge` is **not** wired into `Main.scala` by
  default. There is no opt-in configuration yet.

## Runtime requirements (once live PIDE is wired in)

- Linux or macOS. `scala-isabelle` does not support Windows at runtime.
- Java 11 or newer.
- A local Isabelle installation (Isabelle 2019 or newer) reachable at
  a configured `isabelleHome` path.
- Packaged extension distribution will need to switch the slim
  `backend/dist/isabelle-vscode-server.jar` to a packaging strategy
  that bundles `scala-isabelle` transitives (e.g. `sbt-assembly`, a
  `lib/` directory plus `java -cp`, or a coursier bootstrap launcher),
  because the current `sbt package` task does not include transitive
  dependencies.

## Planned milestones

1. **Configuration plumbing (TypeScript + Scala).** Add VS Code
   settings for the Isabelle home, user directory, and logic session;
   forward them to the backend through the existing JSON-RPC protocol.
2. **Opt-in bridge selection.** Allow the backend to construct a
   `ScalaIsabellePideBridge` instead of the default
   `LocalSyntaxPideBridge` based on configuration, and log a clear
   one-shot message that names the selected bridge.
3. **Process start-up.** Use `scala-isabelle` to launch and supervise
   an Isabelle process from the bridge, transitioning the bridge
   state through `Initializing -> Ready` or
   `Initializing -> Unavailable`.
4. **Document processing.** Replace `documentResult`'s fallback
   delegation with PIDE-derived command spans and a backwards-
   compatible extension of `TheoryDocumentResult` on the TypeScript
   side.
5. **Proof state.** Replace the stubbed `proofState` response with
   live PIDE goals and context.
6. **Sledgehammer.** Replace the stubbed `sledgehammer` response with
   real proof search.

Each milestone is expected to land as its own PR with a clear honest
disclaimer about what is and is not wired yet, matching the
conservative-foundation style the rest of the repository follows.
