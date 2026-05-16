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
  - `Isabelle: Resynchronize Open Theories`
  - `Isabelle: Refresh Proof State`
  - `Isabelle: Run Sledgehammer`
  - `Isabelle: Cancel Sledgehammer`
  - `Isabelle: Insert Sledgehammer Proof`
  - `Isabelle: Create Checked Repair Request`
  - `Isabelle: Preview Repair Patch`
  - `Isabelle: Check Current Workspace for Repair`
- `Content-Length` framed JSON-RPC-style protocol with request IDs and a protocol version.
- Backend process manager with stderr routed to the Isabelle PIDE output channel.
- Scala backend skeleton with `server/health`, `isabelle/version`, and placeholder `session/discover`.
- Conservative ROOT/ROOTS parser and workspace discovery for local sessions.
- Explorer-side **Isabelle Sessions** tree with session, imported-session, theory, and document-file entries.
- Active session persistence through `isabelle.session.active`.
- Isabelle CLI build runner for the active session with streamed output, cancellation, and Problems diagnostics for common source-location formats.
- Document synchronization bridge for opening, updating, and closing Isabelle theory documents through the Scala backend.
- Scala backend document state with conservative command-span extraction as a placeholder for future PIDE spans.
- Local semantic-rendering foundation with Isabelle command/declaration/symbol semantic tokens and basic command/symbol hovers.
- Explorer-side **Isabelle Proof State** panel that follows the active theory cursor and renders structured placeholder proof-state data through the backend protocol.
- Explorer-side **Isabelle Sledgehammer** panel and commands with typed run/cancel protocol messages, current-command context, guarded proof insertion for future suggestions, and a backend boundary that explicitly reports proof search as unavailable until Isabelle/PIDE integration exists.
- Conservative checked repair loop foundation that captures local diagnostics/proof context, previews unified-diff proposals without applying edits, and reruns the existing Isabelle build command over current workspace contents.
- Unit tests for protocol framing, request correlation, ROOT parsing, workspace session discovery, build command generation, diagnostic parsing, semantic tokenization, repair request capture, and patch preview safety.

This milestone does **not** implement PIDE document processing, live proof state, semantic markup, live Sledgehammer proof search, minimization, automatic proof insertion from real suggestions, or automatic AI repair yet. Those require the Scala backend to integrate with Isabelle/PIDE internals rather than only invoking the Isabelle CLI or exposing safe placeholders. The checked repair loop is local-only: it does not call external AI services and does not apply proposed edits automatically.

## Checked repair workflow

The checked repair commands provide a conservative local foundation for future proof-repair tooling:

1. Run `Isabelle: Create Checked Repair Request` from an Isabelle theory. The extension captures the active document URI/path/version, cursor position, VS Code diagnostics, and the current proof-state response if the backend can provide one. It opens an untitled Markdown request that you can review and save manually.
2. Save a proposed repair as a unified diff, then run `Isabelle: Preview Repair Patch`. The extension reads the patch locally, rejects unsafe shapes such as added/deleted files, renames, binary diffs, absolute paths, path traversal, unsupported newline markers, dirty target documents, and mismatched context, then opens readonly VS Code diff previews.
3. If you trust a preview, apply the edit manually. The extension intentionally never writes patch contents for you.
4. Run `Isabelle: Check Current Workspace for Repair`. This reruns the existing active-session build over the current workspace files. It does **not** validate a readonly preview unless you have manually applied those edits first.

Repair requests may include source excerpts, diagnostics, and proof-state details. Review them before sharing outside your workspace.

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
7. Sledgehammer workflow surface: typed run/cancel boundary and guarded proof insertion; PIDE-backed proof search and minimization remain future work.
8. Theory graph and proof-engineering tools.
9. Checked AI repair loop that only reports success after Isabelle verifies the patch.

Motto: VS Code for UI, Isabelle/Scala for semantics, Isabelle/ML for truth.
