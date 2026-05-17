# PIDE integration plan

This document is a living plan for completing milestones 4 (PIDE document
connection), 5 (semantic markup with entity metadata), and 7 (Sledgehammer)
of the [repository roadmap](../README.md#roadmap) by relaying Isabelle's own
bundled language server — `isabelle vscode_server`, shipped inside the
Isabelle distribution under `src/Tools/VSCode/server` — through the standard
Language Server Protocol from this VS Code extension. It records the chosen
architecture, the runtime prerequisites, the configuration surface the
extension intends to expose, the capability roll-out plan, and the honest
limits of the approach. It is meant to be readable in roughly ten minutes by
someone who already understands the existing extension and Scala backend.

Today the extension is intentionally a set of conservative local foundations
(local syntax highlighting, command-span extraction, document-status
surface, theory outline, theory graph, sledgehammer workflow boundary,
checked repair preview) sitting on top of a Scala backend with a
[`PideBridge`](../backend/src/main/scala/dev/isabelle/vscode/server/PideBridge.scala)
seam whose only implementation is the local-syntax fallback. Real PIDE
behaviour — live document processing, Isabelle-published diagnostics,
entity-level hovers and definitions, structured proof state, Sledgehammer
proof search — does not exist on `main`. The plan in this document is to add
real PIDE behaviour by running Isabelle's own `isabelle vscode_server` as a
child LSP process of the extension. The TypeScript scaffolding for that
client is planned work; at the time of writing it is not present on `main`
and there is no open GitHub pull request for it yet. Everything below that
describes the LSP client's settings, commands, or behaviour therefore
documents intended behaviour, not shipped behaviour.

## Architecture

The chosen architecture keeps today's Scala backend exactly where it is, and
adds the Isabelle-bundled language server as an additive, opt-in second
path. A mental model of what the extension is intended to look like once the
LSP relay lands:

```mermaid
flowchart TD
    ext["VS Code extension (TypeScript)"]

    subgraph current["Current path (always on, ships today)"]
        backend["Scala backend<br/>(custom JSON-RPC over Content-Length)"]
        store["DocumentStore"]
        bridge["PideBridge<br/>(LocalSyntaxPideBridge default)"]
    end

    subgraph planned["Planned path (opt-in, not on main yet)"]
        lsp["vscode-languageclient"]
        server["child process:<br/>isabelle vscode_server (stdio LSP)"]
        pide["Isabelle/PIDE engine<br/>(Pure + HOL session, etc.)"]
    end

    ext --> backend
    backend --> store
    store --> bridge

    ext -.->|"isabelle.languageServer.enabled = true"| lsp
    lsp --> server
    server --> pide
```

> The dashed edge is the planned, opt-in LSP relay. It is not implemented on
> `main` at the time of writing. The solid path through the Scala backend is
> the path the extension uses today and will continue to use even when the
> LSP relay is enabled.

The Scala backend remains the home of session discovery, ROOT/ROOTS
parsing, the Isabelle CLI build runner, the document-synchronization
protocol, command-span extraction, document-status summaries, the proof-state
boundary, the Sledgehammer workflow boundary, and any future bridge-driven
semantics. The `PideBridge` seam introduced in PR #13
([`backend/src/main/scala/dev/isabelle/vscode/server/PideBridge.scala`](../backend/src/main/scala/dev/isabelle/vscode/server/PideBridge.scala))
is preserved as the integration point for future Scala-side PIDE work that
does not naturally fit into LSP requests.

The planned LSP relay is an additive, opt-in path. When enabled, the
extension would spawn `isabelle vscode_server` as a child process and route
LSP-standard features (diagnostics, hover, definition, completion, document
symbols) through VS Code's standard surfaces using
[`vscode-languageclient`](https://www.npmjs.com/package/vscode-languageclient).
Because LSP is the transport, those features land on the same VS Code UI
that any other language server uses (the Problems panel, the hover popover,
F12 navigation, the outline view, the completion list).

Why this approach:

- **Cross-platform by default.** `isabelle vscode_server` is part of the
  official Isabelle distribution, so it is expected to work anywhere the
  `isabelle` command itself runs — Linux, macOS, and Windows wherever the
  user's Isabelle install runs there.
- **Leverages official Isabelle infrastructure.** The PIDE wiring inside
  `isabelle vscode_server` is maintained by the Isabelle developers
  themselves and tracks the real PIDE engine. Reusing it avoids
  reimplementing PIDE inside the Scala backend.
- **Additive, not destructive.** The existing local foundations (theory
  outline, command-span decorations, conservative document-status surface,
  checked repair previews) keep working unchanged for users who do not
  enable the LSP relay, and continue to work alongside it for users who do.
- **No protocol churn.** The custom Content-Length JSON-RPC protocol between
  the extension and the Scala backend does not change; the new path is a
  separate LSP connection.

## Runtime prerequisites

The LSP relay design assumes the following runtime environment. None of
these requirements is enforced by code on `main` today; they describe what
the planned LSP-client work is expected to need.

- A working Isabelle installation reachable through the existing
  `isabelle.executablePath` setting (default: `isabelle` on `PATH`). The
  `isabelle vscode_server` tool must be present in that installation; this
  has shipped as part of the official Isabelle distribution for several
  recent major releases, but the exact minimum supported Isabelle version
  should be verified against upstream Isabelle release notes before the LSP
  client lands.
- No additional Linux- or macOS-only restriction. Isabelle's official
  Windows distribution bundles a Cygwin layer, so `isabelle vscode_server`
  is expected to work on Windows wherever the configured `isabelle` command
  works there. Concrete Windows verification is a follow-up task in the
  capability roll-out plan below.
- Java is already required by Isabelle itself; the extension does not add a
  separate Java dependency from the LSP-client side.
- The extension's own runtime requirement (Node.js for the extension host,
  VS Code `^1.90.0` as declared in
  [`package.json`](../package.json#L26-L28)) is unchanged.

## Configuration surface

The following settings, commands, and UI surface describe the planned
configuration shape of the LSP-client work. **None of these settings,
commands, or UI elements exist on `main` at the time of writing**, and no
GitHub pull request for the LSP client has been opened yet. Names and
defaults may change before implementation. This section documents the
intended shape so reviewers of the eventual LSP-client PR have something
concrete to push back against.

Planned settings (added under the existing `Isabelle PIDE` configuration
block):

- `isabelle.languageServer.enabled` — boolean, default `false`. Master
  switch. The default-off behaviour means installing or upgrading the
  extension does not change behaviour for existing users until they
  explicitly opt in.
- `isabelle.languageServer.extraArgs` — array of strings, default `[]`.
  Extra command-line arguments appended to the `isabelle vscode_server`
  invocation, for users who need to pass Isabelle-specific flags (for
  example session selection or logging options) that the extension does not
  surface directly.
- `isabelle.languageServer.logVerbose` — boolean, default `false`. When
  true, the extension is intended to log the LSP traffic it relays to and
  from `isabelle vscode_server` in its existing `Isabelle PIDE` output
  channel, for diagnosing connection issues.

Planned commands (registered alongside the existing `Isabelle:` command
family):

- `Isabelle: Start Language Server` — starts the `isabelle vscode_server`
  child process and connects the LSP client.
- `Isabelle: Stop Language Server` — stops the LSP client and the child
  process.
- `Isabelle: Restart Language Server` — convenience for stop-then-start,
  useful after editing settings or recovering from an unhealthy state.
- `Isabelle: Show Language Server Status` — opens a human-readable summary
  of the current LSP connection state, the Isabelle executable in use, and
  any recent connection errors.

Planned UI:

- A status-bar item that reflects the current LSP connection state
  (disabled, starting, running, errored, stopped) and offers click-through
  to the status command above.

## Capability roll-out plan

Each checkbox below is concrete: it names the LSP request or notification
involved, the file or module that will own the integration, and the
validation that will demonstrate the capability works end-to-end. None of
these items are done today.

```
- [ ] Milestone 4 (PIDE document connection)
  - [ ] Forward textDocument/didOpen, textDocument/didChange, and
        textDocument/didClose for `.thy` documents from the extension to
        isabelle vscode_server, alongside the existing custom
        document/openTheory|update|close traffic to the Scala backend. Owned
        by the planned IsabelleLanguageClient module. Validated by opening,
        editing, and closing a theory while the LSP is enabled and observing
        the round-trip in the LSP trace.
  - [ ] Surface PublishDiagnostics notifications from isabelle vscode_server
        through VS Code's Diagnostics collection, alongside (not replacing)
        the existing CLI-build diagnostics produced by
        `src/build/diagnostics.ts`. By design the two sources are owned by
        distinct `vscode.DiagnosticCollection` instances:
        `BuildService` owns the collection named
        `"isabelle-build"` (constant `BUILD_DIAGNOSTIC_COLLECTION_NAME`) and
        tags each diagnostic with `source = "isabelle build"` (constant
        `BUILD_DIAGNOSTIC_SOURCE`); the Isabelle LSP client uses a separate
        collection assigned by VS Code via `vscode-languageclient`, so the
        two never overwrite one another for the same file. The structural
        coexistence — distinct collection names plus the no-collision
        guard rails — is pinned by `test/lsp/diagnosticsCoexistence.test.ts`.
        End-to-end verification (introducing a deliberate Isabelle error in
        a synchronized theory and observing both the LSP diagnostic and the
        CLI-build diagnostic in the Problems panel) still requires a live
        VS Code session against an Isabelle install and remains a Tier-2
        manual-testing follow-up; this checkbox stays unchecked until that
        live verification is recorded.
  - [ ] Reflect server-driven document status in the existing
        `CommandSpanDecorationsService` gutter so that, when the LSP is
        active, the "local-only pending" status is replaced by an
        Isabelle-published status. The local fallback in
        `src/document/CommandSpanDecorations.ts` and the
        `DocumentStatusService` summary must keep working when the LSP is
        off. Validated by toggling `isabelle.languageServer.enabled` and
        observing the decoration source change.

- [ ] Milestone 5 (Semantic markup with entity metadata)
  - [ ] Route textDocument/hover through LSP for PIDE-driven entity
        descriptions. The existing local hover provider in
        `src/semantic/IsabelleHoverProvider.ts` remains registered and acts
        as a fallback when the LSP is off or returns no hover. Validated by
        hovering an imported constant defined in another theory and
        observing an Isabelle-sourced hover.
  - [ ] Route textDocument/definition through LSP for cross-file go-to-
        definition of non-local declarations. The existing local definition
        provider in `src/semantic/IsabelleDefinitionProvider.ts` keeps
        handling in-file declarations as a fallback. Validated by F12 on a
        symbol declared in a theory imported by the active file.
  - [ ] Route textDocument/documentSymbol through LSP and merge the result
        with the existing local theory outline in
        `src/semantic/TheoryOutlineTreeProvider.ts`. The merge policy
        (LSP-wins versus union) must be decided as part of this work.
        Validated by comparing the outline of a non-trivial theory with the
        LSP on and off.
  - [ ] Route textDocument/completion through LSP and wire its CompletionItem
        results into VS Code's completion UI. Validated by typing a partial
        identifier and observing PIDE-sourced completion candidates.

- [ ] Milestone 7 (Sledgehammer)
  - [ ] Research: determine whether `isabelle vscode_server` exposes
        Sledgehammer suggestions as LSP custom requests, as a code-action
        contribution, or only through its own built-in command palette.
        Capture the upstream surface in a follow-up update to this
        document.
  - [ ] Implement: once the upstream Sledgehammer surface is confirmed,
        bridge `src/sledgehammer/SledgehammerPanel.ts` to the correct LSP
        request and replace the current "unavailable" placeholder from
        `LocalSyntaxPideBridge.sledgehammer` for users who have the LSP
        enabled. Users without the LSP keep the existing typed boundary.
  - [ ] Implement proof-minimization wiring (the second half of milestone
        7), driven by the same upstream Sledgehammer surface.
```

## Honest limits

- The LSP relay is opt-in. Default extension behaviour does not change.
  Users who never set `isabelle.languageServer.enabled` to `true` keep
  exactly the conservative-local-foundations experience the extension ships
  today.
- The Scala backend and the `PideBridge` seam remain the extension's
  repository-specific semantic boundary for session discovery,
  command-span extraction, the custom JSON-RPC contract used by
  `DocumentSyncService`, the document-status surface, the proof-state
  boundary, the Sledgehammer workflow boundary, and any future
  non-LSP-shaped PIDE work. The planned LSP client may provide
  editor-facing PIDE services where `isabelle vscode_server` exposes them,
  but it does not replace the backend protocol and it does not remove or
  subsume the `PideBridge` seam.
- Some `isabelle vscode_server` features rely on Isabelle-specific LSP
  extensions whose exact request shapes can change between Isabelle major
  releases. The extension is expected to pin its compatibility to specific
  Isabelle major versions and to surface incompatibilities through the
  planned language-server status-bar item rather than failing silently.
- The extension does not vendor Isabelle. Users must install Isabelle
  themselves and either keep `isabelle` on `PATH` or set
  `isabelle.executablePath`. The same is true today for the existing CLI
  build runner.
- Nothing in this document is implemented on `main` at the time of
  writing. The configuration surface, commands, and capability checklist
  items above describe intended behaviour for the planned LSP-client work.

## References

- Isabelle distribution VS Code source (upstream `isabelle vscode_server`
  implementation):
  <https://isabelle.in.tum.de/repos/isabelle/file/Isabelle2024/src/Tools/VSCode>
- Microsoft Language Server Protocol specification:
  <https://microsoft.github.io/language-server-protocol>
- `vscode-languageclient` npm package (the planned LSP client dependency):
  <https://www.npmjs.com/package/vscode-languageclient>
- Microsoft Language Server Extension Guide:
  <https://code.visualstudio.com/api/language-extensions/language-server-extension-guide>
- This repository's PIDE bridge seam:
  [`backend/src/main/scala/dev/isabelle/vscode/server/PideBridge.scala`](../backend/src/main/scala/dev/isabelle/vscode/server/PideBridge.scala)
- Planned file (not present on `main` yet): `src/lsp/IsabelleLanguageClient.ts`
  will own the `vscode-languageclient` instance and the spawn/lifecycle
  management for `isabelle vscode_server`.
