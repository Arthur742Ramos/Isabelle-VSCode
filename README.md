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

The current foundation establishes the extension/backend boundary and keeps future PIDE work explicit instead of pretending it already exists.

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
  - `Isabelle: Show Document Status`
  - `Isabelle: Refresh Proof Outline`
  - `Isabelle: Refresh Proof State`
  - `Isabelle: Go to Next Command`
  - `Isabelle: Go to Previous Command`
  - `Isabelle: Reveal Current Command`
  - `Isabelle: Proof Actions`
  - `Isabelle: Run Sledgehammer`
  - `Isabelle: Cancel Sledgehammer`
  - `Isabelle: Insert Sledgehammer Proof`
  - `Isabelle: Create Checked Repair Request`
  - `Isabelle: Preview Repair Patch`
  - `Isabelle: Check Current Workspace for Repair`
  - `Isabelle: Refresh Theory Graph`
- `Content-Length` framed JSON-RPC-style protocol with request IDs and a protocol version.
- Backend process manager with stderr routed to the Isabelle PIDE output channel.
- Scala backend skeleton with `server/health`, `isabelle/version`, and backend-backed `session/discover`.
- Conservative ROOT/ROOTS parser and workspace discovery for local sessions, available through the Scala backend with TypeScript local fallback if backend startup fails.
- Explorer-side **Isabelle Sessions** tree with session, imported-session, theory, and document-file entries.
- Active session persistence through `isabelle.session.active`.
- Isabelle CLI build runner for the active session with streamed output, cancellation, and Problems diagnostics for common source-location formats.
- Document synchronization bridge for opening, updating, and closing Isabelle theory documents through the Scala backend.
- Scala backend document state with conservative command-span extraction as a placeholder for future PIDE spans.
- Status-bar document status surface that summarizes synchronized/local command spans and the current command with an explicit local syntax-only label; it does not publish Isabelle diagnostics.
- Local semantic-rendering foundation with Isabelle command/declaration/symbol semantic tokens, basic command/symbol hovers, document symbols, local import links, and in-file go-to-definition for locally parsed declarations.
- Explorer-side **Isabelle Proof State** panel that follows the active theory cursor and renders structured placeholder proof-state data through the backend protocol.
- Explorer-side **Isabelle Proof Outline** view that follows the active theory and groups command spans with proof steps.
- Command navigation helpers for moving to the next/previous Isabelle command and revealing the current command span.
- Conservative proof action palette for refreshing the proof-state panel, building the active session, or explicitly inserting `sorry`/`oops` without claiming verification.
- Explorer-side **Isabelle Sledgehammer** panel and commands with typed run/cancel protocol messages, current-command context, guarded proof insertion for future suggestions, and a backend boundary that explicitly reports proof search as unavailable until Isabelle/PIDE integration exists.
- Conservative checked repair loop foundation that captures local diagnostics/proof context, previews unified-diff proposals without applying edits, and reruns the existing Isabelle build command over current workspace contents.
- Explorer-side **Isabelle Theory Graph** tree that builds a conservative dependency graph from discovered ROOT sessions plus parsed theory import headers.
- Unit tests for protocol framing, request correlation, ROOT parsing, workspace session discovery, theory graph construction, build command generation, diagnostic parsing, semantic tokenization, repair request capture, patch preview safety, command-span extraction, document status summaries, and proof-outline helpers.

The theory graph, proof outline, document status surface, document symbols, local import links, and in-file definition navigation are local foundations that refresh from session discovery, `.thy` headers, synchronized command spans, and local syntax extraction; they are not live PIDE dependency, diagnostics, or semantic markup yet. This milestone does **not** implement PIDE document processing, live proof checking, PIDE semantic markup/entity metadata, live Sledgehammer proof search, minimization, automatic proof insertion from real suggestions, or automatic AI repair yet. Those require the Scala backend to integrate with Isabelle/PIDE internals rather than only invoking the Isabelle CLI or exposing safe placeholders. The proof actions are conservative affordances and the checked repair loop is local-only: they do not call external AI services, claim verification, or apply proposed edits automatically.

## Checked repair workflow

The checked repair commands provide a conservative local foundation for future proof-repair tooling:

1. Run `Isabelle: Create Checked Repair Request` from an Isabelle theory. The extension captures the active document URI/path/version, cursor position, VS Code diagnostics, and the current proof-state response if the backend can provide one. It opens an untitled Markdown request that you can review and save manually.
2. Save a proposed repair as a unified diff, then run `Isabelle: Preview Repair Patch`. The extension reads the patch locally, rejects unsafe shapes such as added/deleted files, renames, binary diffs, absolute paths, path traversal, unsupported newline markers, dirty target documents, and mismatched context, then opens readonly VS Code diff previews plus a local Markdown verification plan with active-session build details when available.
3. If you trust a preview, apply the edit manually. The extension intentionally never writes patch contents for you.
4. Run `Isabelle: Check Current Workspace for Repair` or the exact build command shown in the verification plan. This reruns the existing active-session build over the current workspace files. It does **not** validate a readonly preview unless you have manually applied those edits first, and the extension does not report a repair as checked until that Isabelle build succeeds.

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

Validate the VS Code extension package contents after compiling, testing, and packaging the bundled Scala backend jar:

```powershell
npm run package:validate
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

For a packaged extension, `npm run package:validate` builds and includes `backend/dist/isabelle-vscode-server.jar`. You can still override `isabelle.backend.command` to use another backend launcher or place an `isabelle-vscode-server` launcher on `PATH`. The extension runs as a workspace extension so the backend starts near the workspace files in remote or container development.

## Roadmap

The high-level roadmap is:

1. Skeleton: extension activation, backend launch, health/version protocol.
2. Session discovery: ROOT/ROOTS/AFP discovery, active session selection, theory tree.
3. Build integration: `isabelle build`, streamed output, clickable diagnostics.
4. PIDE document connection: live edits, local command spans, and a local status surface exist; PIDE status updates and diagnostics remain future work.
5. Semantic markup: local hovers, navigation, semantic tokens, and document symbols exist; PIDE entity metadata remains future work.
6. Proof state panel: cursor-aware structured goals/context.
7. Sledgehammer workflow surface: typed run/cancel boundary and guarded proof insertion; PIDE-backed proof search and minimization remain future work.
8. Theory graph and proof-engineering tools.
9. Checked AI repair loop that only reports success after Isabelle verifies the patch.

Motto: VS Code for UI, Isabelle/Scala for semantics, Isabelle/ML for truth.
