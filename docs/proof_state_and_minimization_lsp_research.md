# PIDE proof-state & Sledgehammer minimization LSP surfaces (research)

This note refreshes the upstream LSP-surface investigation that
[`sledgehammer_lsp_research.md`](sledgehammer_lsp_research.md) began,
and answers two more Milestone 6 / Milestone 7 questions from
[`PIDE_INTEGRATION.md`](PIDE_INTEGRATION.md):

1. **Does `isabelle vscode_server` expose a structured proof-state
   surface over LSP that could replace the local-syntax
   `ProofStatePanel`?**
2. **Does `isabelle vscode_server` expose Sledgehammer minimization
   over LSP that could complete the second half of Milestone 7?**

The probe below is source-only (this workstation cannot reach
`isabelle.in.tum.de` to run a live JSON-RPC dialogue). The source is
the official Isabelle git mirror at
[`isabelle-prover/mirror-isabelle`](https://github.com/isabelle-prover/mirror-isabelle),
read at commit `ce22e9eaee0d486b424c1c2d1ccb66229632cf0d` (current tip
as of this PR). Live verification against an Isabelle 2025-2 install
is captured as a Tier-2 follow-up rather than a precondition for
acting on the findings.

## TL;DR

| Question | Surface | Decision |
| --- | --- | --- |
| **Milestone 6** structured proof state | `PIDE/state_init` request + `PIDE/state_output` notifications (full per-instance lifecycle exists) | **Implementable today over LSP.** Schedule an implementation PR. |
| **Milestone 7** Sledgehammer minimization | No `PIDE/sledgehammer_minimize*` notification exists in `lsp.scala`; only one upstream `Query_Operation("sledgehammer", ...)` is wired into VSCode | **Upstream-blocked at LSP level.** Path forward is either an upstream change or a Scala-backend `PideBridge` implementation. |

The major surprise relative to the original research note is **Milestone 6**:
the upstream LSP already exposes a complete proof-state panel surface
that the extension can drive. This was missed in the original probe
because the original probe was scoped to Sledgehammer.

## Milestone 6 — structured proof state over LSP (UNBLOCKED)

### Surface

The upstream LSP exposes a full per-instance proof-state panel
surface, paired with a separate caret-driven dynamic output surface.
All shapes below are verbatim from `src/Tools/VSCode/src/lsp.scala`
in the upstream mirror.

**Client -> server** (lifecycle):

| Method | Kind | Params | Source |
| --- | --- | --- | --- |
| `PIDE/state_init` | request | none | `lsp.scala:638` |
| `PIDE/state_exit` | notification | `{ id: long }` | `lsp.scala:643` |
| `PIDE/state_locate` | notification | `{ id: long }` | `lsp.scala:644` |
| `PIDE/state_update` | notification | `{ id: long }` | `lsp.scala:645` |
| `PIDE/state_auto_update` | notification | `{ id: long, enabled: boolean }` | `lsp.scala:647` |
| `PIDE/state_set_margin` | notification | `{ id: long, margin: double }` | `lsp.scala:659` |

**Server -> client** (data):

| Method | Kind | Params | Source |
| --- | --- | --- | --- |
| `PIDE/state_init` reply | response | `{ state_id: long }` | `lsp.scala:638-640` |
| `PIDE/state_output` | notification | `{ id: long, content: string, auto_update: boolean, decorations?: ... }` | `lsp.scala:618-628` |
| `PIDE/dynamic_output` | notification | `{ content: string, decorations?: ... }` (no id) | `lsp.scala:599-604` |

`content` in both `state_output` and `dynamic_output` is
`XML.string_of_body(...)` — the **same Isabelle XML markup envelope**
that `PIDE/sledgehammer_output` uses. We can reuse the parser shipped
in PR #32 (`src/sledgehammer/pideSledgehammerOutput.ts`) verbatim.

### Lifecycle (from `state_panel.scala`)

`PIDE/state_init` allocates one `State_Panel` instance on the server.
Each instance:

- gets a fresh `Counter.ID` and runs a `Query_Operation(..., "print_state", ...)`;
- subscribes to `Session.Commands_Changed` (only when `assignment` is
  true) and `Session.Caret_Focus`;
- pushes `PIDE/state_output` every time the print_state operation
  yields fresh output, **without** the client polling — it is
  push-driven.

`PIDE/state_exit` deallocates and tears down the subscription;
`PIDE/state_update` forces a fresh `apply_query`; `PIDE/state_locate`
re-anchors the state panel to the current caret; `PIDE/state_auto_update`
toggles whether commands-changed / caret-focus events drive the
panel; `PIDE/state_set_margin` is a pretty-printer layout hint.

`PIDE/dynamic_output` is the lighter-weight surface: server side is
`Dynamic_Output(server)` (a single instance, no per-client id) which
fires whenever `Commands_Changed` (any) or `Caret_Focus` happens. The
content is the same Isabelle XML markup. There is **no** init/exit
client-side handshake — the server starts emitting from `init()`
called inside `Language_Server.init`.

### Implications for the extension

Concrete recommendations for follow-up PRs. All file paths are
extension-side TypeScript; no changes are required on the Scala
backend or to the custom JSON-RPC protocol.

1. **Branch `ProofStatePanel` between LSP-mode and backend-mode**
   in the same shape `SledgehammerPanel.run()` already branches.
   When `IsabelleLanguageClient.getStatus().state === "running"`,
   send `PIDE/state_init`, capture the response's `state_id`,
   subscribe to `PIDE/state_output` filtered by that id, and render
   the parsed content. When the LSP transitions out of running,
   send `PIDE/state_exit` and fall back to the existing local
   surface. File:
   [`src/proof/ProofStatePanel.ts`](../src/proof/ProofStatePanel.ts).
   Effort: **M**.
2. **Reuse the PIDE XML parser** (`parsePideSledgehammerOutput` +
   `renderPideOutputHtml`) so the rendered state matches the
   sendback/message styling already shipping for Sledgehammer
   output. The parser is content-agnostic; the only adjustment
   needed is renaming the CSS class prefix or factoring out the
   styling to a shared helper. Effort: **S**.
3. **Auto-update toggle** maps cleanly onto the existing
   `PIDE/state_auto_update` notification — wire a settings boolean
   `isabelle.proofState.autoUpdate` (default `true`, matching
   upstream default in `state_panel.scala:80`) and forward it when
   the user toggles it. Effort: **S**.
4. **Optionally also subscribe to `PIDE/dynamic_output`** for a
   secondary "message panel" surface attached to the editor caret,
   independent of the state panel. The local-syntax foundation
   does not currently surface anything analogous, so adding this
   first would be net-new UI. Defer until #1-#3 are landed.
5. **Single-instance contract**: only allocate one `state_id` per
   active editor / panel, not one per LSP-mode dispatch. The
   `Counter.ID` ladder in `state_panel.scala:7` is global and
   counters are not reused after exit; long-lived sessions will
   accumulate ids harmlessly, but the extension should NOT
   re-init on every cursor move. Effort: handled in the same
   PR as #1.

## Milestone 7 — Sledgehammer minimization (STILL BLOCKED)

### Findings

The Sledgehammer surface in `lsp.scala` was scoped exhaustively by
the original research note (`sledgehammer_lsp_research.md`,
"Findings → Custom notifications"). The refresh against current
tip confirms: **no `PIDE/sledgehammer_minimize*` LSP method has
been added.** The current dispatch arms in `language_server.scala`
are:

```scala
case LSP.Sledgehammer_Provers_Request() => sledgehammer.provers()
case LSP.Sledgehammer_Request(args)     => sledgehammer.request(args)
case LSP.Sledgehammer_Cancel()          => sledgehammer.cancel()
case LSP.Sledgehammer_Locate()          => sledgehammer.locate()
case LSP.Sledgehammer_Sendback(text)    => sledgehammer.sendback(text)
```

and the matching `LSP.Sledgehammer_*` objects in `lsp.scala:733-786`
cover only those five. The `vscode_sledgehammer.scala` panel wraps
exactly one `Query_Operation(editor, (), "sledgehammer", ...)` and
exposes no minimize method.

Minimization itself **does** exist at the Isabelle/ML level — it
lives in
[`src/HOL/Tools/Sledgehammer/sledgehammer_prover_minimize.ML`](https://github.com/isabelle-prover/mirror-isabelle/blob/ce22e9eaee0d486b424c1c2d1ccb66229632cf0d/src/HOL/Tools/Sledgehammer/sledgehammer_prover_minimize.ML)
in upstream and is what jEdit's "Sledgehammer Minimize" command
calls under the hood. The Sledgehammer JSON line emitted at the
end of a `Query_Operation` run also includes a minimize hyperlink
the user can click, but **that hyperlink is processed by the
client UI (jEdit) — not exposed as a separate LSP notification.**

### Path forward

Two options for landing Milestone 7's second half:

1. **Upstream change to `isabelle vscode_server`**: add a
   `PIDE/sledgehammer_minimize_request` notification mirroring the
   existing `PIDE/sledgehammer_request` shape, and a matching
   `PIDE/sledgehammer_minimize_output` for the result.
   Out-of-scope for this repo; depends on Isabelle maintainers
   accepting and shipping the change.
2. **Scala-backend implementation via `PideBridge`**: extend
   `backend/src/main/scala/dev/isabelle/vscode/server/PideBridge.scala`
   to expose a `minimizeProof` method that calls into the same
   `Query_Operation` machinery (or invokes `Sledgehammer_Minimize.run`
   directly) when the backend is linked against real Isabelle/PIDE
   jars. The custom JSON-RPC protocol gains a
   `sledgehammer/minimize` method paralleling `sledgehammer/run`,
   and `SledgehammerPanel` learns a third branch that prefers the
   Scala backend over the LSP for minimization.

Option 2 is the only path that does not block on the Isabelle
maintainers' release cadence. It is **much** larger than the other
roadmap items because it requires a working Isabelle PIDE jar link
in the Scala backend — i.e., it crosses the boundary that the
`PideBridge` seam was designed to defer.

### Recommended sequencing

- Land Milestone 6 first (PIDE state panel over LSP) — it's an
  immediate user-visible upgrade for everyone running the LSP
  relay.
- Defer Milestone 7 minimization until the backend's `PideBridge`
  gains a real PIDE implementation. Until then, document the gap
  honestly in `PIDE_INTEGRATION.md` and in the Sledgehammer
  panel's UI as a known limitation rather than promising
  functionality the LSP cannot deliver.

## Negative findings (refresh)

State these explicitly so the project does not waste time later:

- **No new code-action surface for Sledgehammer.** `codeAction`
  routing in `language_server.scala:540-543` runs the generic
  `code_action_request` path which collects `Protocol.sendback_snippets`
  — these are jEdit-style sendback markup in command output, not
  Sledgehammer suggestions. The `sendback_snippets` path produces
  one `CodeAction` per snippet found in command output, which can
  include Sledgehammer's `Try this:` suggestions IF the prover
  has already run and the cursor is inside the command range. It
  is NOT a way to trigger a Sledgehammer run from a code action.
  Distinguishing Sledgehammer sendbacks from other sendbacks is
  not done here.

- **`PIDE/state_init` is a request, not a notification.** Unlike
  the `PIDE/sledgehammer_*` family, it has an `id` and the server
  replies with a `state_id`. Our existing
  `IsabelleLanguageClient.sendNotification` seam is therefore not
  sufficient for Milestone 6; we will also need a
  `sendRequest(method, params): Promise<unknown>` seam. Small
  scope addition.

- **`PIDE/dynamic_output` has no id.** A single global stream
  per language-server child. If we surface it as a panel, the
  panel is implicitly one-per-language-server, not per editor.

- **`auto_update` defaults to true.** `state_panel.scala:82`
  initializes it true and the server runs `auto_update()` from
  `init()`. Our LSP-mode wiring should respect this default.

## References

- Upstream Isabelle VSCode source mirror (commit
  `ce22e9eaee0d486b424c1c2d1ccb66229632cf0d` at PR time):
  <https://github.com/isabelle-prover/mirror-isabelle/tree/ce22e9eaee0d486b424c1c2d1ccb66229632cf0d/src/Tools/VSCode/src>
- `lsp.scala` lines 597-670 — verbatim `PIDE/state_*` and
  `PIDE/dynamic_output` message shapes.
- `state_panel.scala` — per-instance `Query_Operation("print_state", ...)`
  wrapper, auto-update semantics, lifecycle.
- `dynamic_output.scala` — single-instance caret-driven message panel.
- `vscode_sledgehammer.scala` — verbatim Sledgehammer control panel,
  five exposed methods (provers / request / sendback / cancel /
  locate / init / exit). No minimize.
- `language_server.scala` lines 540-561 — full LSP dispatch arms.
- `src/HOL/Tools/Sledgehammer/sledgehammer_prover_minimize.ML` —
  ML-level minimization implementation, not exposed over LSP.
- This repository's prior research:
  [`sledgehammer_lsp_research.md`](sledgehammer_lsp_research.md).
- This repository's Sledgehammer LSP wiring (the pattern Milestone 6
  should mirror):
  [`src/sledgehammer/LspSledgehammerSession.ts`](../src/sledgehammer/LspSledgehammerSession.ts),
  [`src/sledgehammer/SledgehammerPanel.ts`](../src/sledgehammer/SledgehammerPanel.ts).
