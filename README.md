# Isabelle PIDE for VS Code

This repository is becoming a modern Isabelle/PIDE frontend for VS Code. The target architecture is deliberately more than a syntax-highlighting or build-on-save extension:

```text
VS Code Extension (TypeScript)
  -> custom protocol client, commands, panels, decorations
Scala Backend
  -> Isabelle-facing session, PIDE, tool, and build bridge
Isabelle/PIDE
  -> the semantic source of truth
```

The first milestone in this repository establishes the extension/backend boundary and keeps future PIDE work explicit instead of pretending it already exists.

## Current milestone

Implemented foundation:

- VS Code extension scaffold that activates for Isabelle `.thy` files.
- Commands:
  - `Isabelle: Show Version`
  - `Isabelle: Check Backend Health`
  - `Isabelle: Discover Sessions`
  - `Isabelle: Refresh Sessions`
  - `Isabelle: Select Active Session`
  - `Isabelle: Build Active Session`
  - `Isabelle: Cancel Build`
- `Content-Length` framed JSON-RPC-style protocol with request IDs and a protocol version.
- Backend process manager with stderr routed to the Isabelle PIDE output channel.
- Scala backend skeleton with `server/health`, `isabelle/version`, and placeholder `session/discover`.
- Conservative ROOT/ROOTS parser and workspace discovery for local sessions.
- Explorer-side **Isabelle Sessions** tree with session, imported-session, theory, and document-file entries.
- Active session persistence through `isabelle.session.active`.
- Isabelle CLI build runner for the active session with streamed output, cancellation, and Problems diagnostics for common source-location formats.
- Unit tests for protocol framing, request correlation, ROOT parsing, workspace session discovery, build command generation, and diagnostic parsing.

This milestone does **not** implement PIDE document processing, live proof state, semantic markup, or Sledgehammer yet. Those require the Scala backend to integrate with Isabelle/PIDE internals rather than only invoking the Isabelle CLI.

## Development

Install dependencies:

```powershell
npm install
```

Compile and test the extension code:

```powershell
npm run check
```

Compile the Scala backend if `sbt` is available:

```powershell
npm run backend:compile
```

Run the backend during extension development:

```powershell
npm run backend:run
```

Then configure VS Code:

```json
{
  "isabelle.backend.command": "sbt",
  "isabelle.backend.args": [
    "-Dsbt.supershell=false",
    "-Dsbt.log.noformat=true",
    "backend/run"
  ],
  "isabelle.executablePath": "isabelle"
}
```

For a packaged extension, set `isabelle.backend.command` to a built backend launcher or place an `isabelle-vscode-server` launcher on `PATH`.

## Roadmap

The high-level roadmap is:

1. Skeleton: extension activation, backend launch, health/version protocol.
2. Session discovery: ROOT/ROOTS/AFP discovery, active session selection, theory tree.
3. Build integration: `isabelle build`, streamed output, clickable diagnostics.
4. PIDE document connection: live edits, command spans, status updates, diagnostics.
5. Semantic markup: hovers, navigation, semantic tokens, entity metadata.
6. Proof state panel: cursor-aware structured goals/context.
7. Sledgehammer panel: cancellable jobs, proof insertion, minimization.
8. Theory graph and proof-engineering tools.
9. Checked AI repair loop that only reports success after Isabelle verifies the patch.

Motto: VS Code for UI, Isabelle/Scala for semantics, Isabelle/ML for truth.
