# Sledgehammer LSP surface (research)

This note answers a single Milestone 7 question for [PIDE_INTEGRATION.md](PIDE_INTEGRATION.md):
**does `isabelle vscode_server` expose Sledgehammer suggestions as LSP custom
requests, as a code-action contribution, or only through its own built-in
command palette?** The probe and the upstream source reading below were
done on 2026-05-17 against Isabelle 2025-2.

Short answer: **none of the above three exactly.** Sledgehammer is exposed
as a small set of `PIDE/*` LSP **notifications** (both directions) that are
not advertised in the `initialize` capabilities, are not surfaced as code
actions, and are not registered as workspace commands. Discovering the
surface requires reading upstream Isabelle source; using it requires
treating the channel as a stateful, request-id-less notification stream
tied to the server's most recent caret position.

## Method

Two live probes against the bundled Isabelle 2025-2 language server,
plus a source-reading pass against the matching Isabelle source tree.

Launch command (same form as the extension's
[`buildLanguageServerCommand`](../src/lsp/languageServerArgs.ts)):

```text
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File C:\Tools\bin\isabelle.ps1 vscode_server -n
```

Isabelle version (from `window/logMessage` and `window/showMessage` on
startup): `Welcome to Isabelle/HOL (Isabelle2025-2)`.

Theory text used as the probe target (`Demo.thy`):

```isabelle
theory Demo
  imports Main
begin

lemma demo: "True"
  sorry

end
```

The probe spoke raw `Content-Length`-framed JSON-RPC over the child's
stdio, sent `initialize`, `initialized`, `textDocument/didOpen`,
`textDocument/codeAction` at the `sorry` position (line 5, character 4 in
zero-based LSP coordinates), `PIDE/sledgehammer_provers_request`,
`PIDE/caret_update`, `PIDE/sledgehammer_request`, then `shutdown` /
`exit`. The matching Isabelle source tree is the same release, bundled
under `C:\Tools\Isabelle2025-2\Isabelle2025-2\src\Tools\VSCode\src\`,
specifically [`vscode_sledgehammer.scala`](#references),
[`lsp.scala`](#references), and [`language_server.scala`](#references).

## Findings

### Capabilities advertised at `initialize`

Verbatim `result.capabilities` returned by the server:

```json
{
  "definitionProvider": true,
  "hoverProvider": true,
  "completionProvider": {
    "resolveProvider": false,
    "triggerCharacters": ["%", "<", ".", ">", "-", "=", "|", "~", "[", "]",
      "(", ")", "{", "}", "/", "\\", "&", "!", "?",
      "A", "L", "E", "X", ":", "I", "n", "t", "e", "r", "N", "T", "U",
      "i", "o", "S", "P", "F", "*", "M", "R", "O", "D", "_", "^",
      "z", "w", "h", "f", "u", "v", "s", "x", "g", "B", "C", "G", "H",
      "J", "K", "Q", "V", "W", "Y", "Z", "a", "b", "c", "d", "j", "k",
      "l", "m", "p", "q", "y"]
  },
  "documentHighlightProvider": true,
  "textDocumentSync": 2,
  "codeActionProvider": true
}
```

Notable absences: there is **no `executeCommandProvider`**, **no
`experimental` object**, and **no top-level Sledgehammer-named
capability**. The presence of `codeActionProvider: true` is misleading
in this context (see next finding).

### Code-action probe

`textDocument/codeAction` at the `sorry` position with an empty
`context.diagnostics` returned `[]`. Sledgehammer is therefore **not**
exposed as a code action, despite `codeActionProvider: true` being
advertised. A future code-action probe with non-empty diagnostics would
need synthesized PIDE-published diagnostics to test, but the current
upstream `language_server.scala` dispatch only routes `CodeActionRequest`
to a generic Isabelle-internal handler (line 543) and the Sledgehammer
module is wired separately (see "Custom notifications" below), so a
code-action surface is not expected.

### Custom workspace commands

`executeCommandProvider.commands` is not advertised, so
`workspace/executeCommand` is structurally unavailable for Sledgehammer.
The probe did not attempt any specific command names because none were
exposed.

### Custom notifications (the real Sledgehammer surface)

The Sledgehammer surface is **eight non-standard LSP notifications under
the `PIDE/sledgehammer*` and `PIDE/caret_update` method names**, all
defined in `lsp.scala` (verbatim method strings) and dispatched in
`language_server.scala` (lines 540–561). Every one of them is an LSP
*notification*, not a request — they have a `method` and `params` but
no `id`, and the server never replies to them directly.

Server → client (notifications observed live):

| method | params | source |
| --- | --- | --- |
| `PIDE/sledgehammer_status` | `{ "message": string }` | `lsp.scala:755-758`, emitted from `vscode_sledgehammer.scala:18-26`. Observed values: `"Waiting for evaluation of context ..."`, `"Sledgehammering ..."`, `"Finished"`. |
| `PIDE/sledgehammer_output` | `{ "content": string }` | `lsp.scala:760-763`, emitted from `vscode_sledgehammer.scala:28-31`. `content` is `XML.string_of_body(Pretty.unbreakable(output.messages))` — an Isabelle XML-markup string, not plain text and not arbitrary HTML. |
| `PIDE/sledgehammer_provers_response` | `{ "provers": string }` | `lsp.scala:737-740`. Space-separated prover names. Live response on this install: `"cvc5 verit z3 e spass vampire zipperposition"`. |
| `PIDE/sledgehammer_insert` | `{ "uri": string, "line": int, "character": int, "text": string }` | `lsp.scala:778-786`. Emitted in response to a client `_sendback` and tells the client *where* to insert the proof text. |

Client → server (notifications sent live):

| method | params | source |
| --- | --- | --- |
| `PIDE/sledgehammer_request` | `{ "provers": string, "isar": boolean, "try0": boolean }` | `lsp.scala:742-753`, dispatched at `language_server.scala:558`. **Has no `textDocument`/`position`** — the trigger uses the server's most recent `PIDE/caret_update` state. `provers` is the same space-separated string shape as `_provers_response.provers`. `isar` requests Isar-style structured proofs (`proof ... qed`) instead of one-liners; `try0` controls whether the standard `try0` tactics (`auto`, `blast`, `fast`, `force`, …) are tried before/around the external provers. |
| `PIDE/sledgehammer_provers_request` | none | `lsp.scala:734-735` (defined via `Notification0`). |
| `PIDE/sledgehammer_cancel` | none | `lsp.scala:765`. Best-effort cancellation of the in-flight query operation. |
| `PIDE/sledgehammer_locate` | none | `lsp.scala:767`. Re-anchors the upstream Sledgehammer panel to the current caret; not needed for a basic run flow. |
| `PIDE/sledgehammer_sendback` | `{ "text": string }` | `lsp.scala:769-776`. Client asks the server to compute the matching insertion position for a proof text; server responds with a `PIDE/sledgehammer_insert` notification. |
| `PIDE/caret_update` | `{ "uri": string, "line": int, "character": int, "focus": boolean }` | `lsp.scala:573-580`. **Mandatory precondition** for `_request`. |

End-to-end run captured live:

```text
>> initialize (id=1)
<< window/logMessage "Welcome to Isabelle/HOL (Isabelle2025-2)"
>> initialized
>> textDocument/didOpen Demo.thy
<< window/showMessage "Welcome to Isabelle/HOL (Isabelle2025-2)"
>> PIDE/sledgehammer_provers_request
<< PIDE/sledgehammer_provers_response  { "provers": "cvc5 verit z3 e spass vampire zipperposition" }
>> PIDE/caret_update                   { "uri": ".../Demo.thy", "line": 5, "character": 4, "focus": true }
>> PIDE/sledgehammer_request           { "provers": "cvc5 verit z3 e spass vampire zipperposition", "isar": false, "try0": true }
<< PIDE/sledgehammer_output            { "content": "" }
<< PIDE/sledgehammer_status            { "message": "Waiting for evaluation of context ..." }
<< PIDE/sledgehammer_output            { "content": "<error_message>Unknown proof context</error_message>" }
<< PIDE/sledgehammer_status            { "message": "Finished" }
```

Observed failure mode: `_output.content` came back as
`"<error_message>Unknown proof context</error_message>"`. The message
envelopes themselves are confirmed working, but the prover did not have
a usable goal context at the moment of the trigger. Plausible causes
include the prover session not having finished processing the theory
yet, the caret position not anchoring to a recognized command span at
that snapshot, or a URI/document state mismatch between `didOpen` and
the caret. A follow-up implementation must gate the request on a
quiescent processed state for the active theory rather than just on LSP
client readiness; see Implications below.

### Upstream source pointers

- `src/Tools/VSCode/src/vscode_sledgehammer.scala` — the entire
  Sledgehammer control panel for the language server. Wraps a
  `Query_Operation(server.editor, (), "sledgehammer", consume_status,
  consume_output)` and exposes `provers()`, `request(args)`,
  `sendback(text)`, `cancel()`, `locate()`, `init()`, `exit()`. Status and
  output flow back over `server.channel.write(LSP.Sledgehammer_*)`.
- `src/Tools/VSCode/src/lsp.scala` lines 732–786 — the verbatim
  `PIDE/sledgehammer_*` LSP message shapes. `Notification0` (lines
  49–55) confirms the parameter-less variants are pure notifications.
- `src/Tools/VSCode/src/language_server.scala` lines 540–561 — the
  message dispatcher. Sledgehammer cases are wired into the same
  `handle(json)` that processes the standard LSP methods, so they share
  the server's serial message loop.
- `src/Tools/VSCode/src/component_vscode_extension.scala` lines 142–147
  — Isabelle option keys related to Sledgehammer (`auto_sledgehammer`,
  `sledgehammer_provers`, `sledgehammer_timeout`). These are CLI/option
  configuration, not part of the LSP trigger protocol; relevant only if
  the extension later surfaces them as user settings that the Scala
  backend passes through.

## Implications for the extension

Concrete next-PR recommendations. All file paths are
extension-side TypeScript; no changes are needed on the Scala backend
or to the existing
[`src/protocol/messages.ts`](../src/protocol/messages.ts) JSON-RPC
contract.

1. **Expose LSP notification I/O on `IsabelleLanguageClient`.** Add a
   minimal seam so callers can `sendNotification(method, params)` and
   `onNotification(method, handler)` against the underlying
   `vscode-languageclient` instance. Today
   [`src/lsp/IsabelleLanguageClient.ts`](../src/lsp/IsabelleLanguageClient.ts)
   only owns lifecycle (`start`/`stop`/`restart`/`getStatus`); it does
   not let consumers send custom notifications. Effort: **S**.

2. **Branch the panel between LSP-mode and Scala-backend-mode in
   `SledgehammerPanel.run()`.** When the LSP client status is
   `"running"`, the panel should send a `PIDE/caret_update` for the
   active editor and then a `PIDE/sledgehammer_request`. When the LSP
   is off or `"failed"`, keep the existing
   [`sledgehammer/run`](../src/sledgehammer/SledgehammerPanel.ts#L237-L240)
   path to the Scala backend so users who haven't opted in see no
   regression. Cancellation similarly branches: LSP-mode sends
   `PIDE/sledgehammer_cancel`, backend-mode keeps the existing
   `sledgehammer/cancel` request. File:
   [`src/sledgehammer/SledgehammerPanel.ts`](../src/sledgehammer/SledgehammerPanel.ts).
   Effort: **M**.

3. **Serialize requests and treat new runs as replacing prior output.**
   None of the `PIDE/sledgehammer_*` messages carry a correlation id;
   the upstream `Query_Operation` is itself a single-slot panel
   abstraction. The panel must therefore either disable the Run action
   while a request is in flight (the existing
   [`activeRequestId` guard](../src/sledgehammer/SledgehammerPanel.ts#L40-L44)
   already does this for backend-mode and can be reused for LSP-mode by
   gating on the next `_status: "Finished"` rather than a JSON-RPC
   reply) or treat each new `_request` as implicitly cancelling the
   previous one. Effort: **S** once the branching in (2) lands.

4. **Render `_output.content` correctly.** The payload is an Isabelle
   XML-markup string from `XML.string_of_body(Pretty.unbreakable(...))`.
   Naive HTML escaping plus `<pre>` will display angle brackets as
   text; naive `innerHTML` will misinterpret Isabelle markup elements
   such as `<error_message>...</error_message>` or `<sendback>...`.
   Add a small parser that strips/translates the known Isabelle markup
   elements (sendback links, errors, prover names) into webview-safe
   HTML, then keep the existing
   [`sledgehammerRenderer.ts`](../src/sledgehammer/sledgehammerRenderer.ts)
   escaping for anything outside that allowlist. New file, suggested
   name: `src/sledgehammer/pideSledgehammerOutput.ts`. Effort: **S**.

5. **Wire the two-step insert flow.** The user clicks an inserted
   suggestion in the panel webview → the panel sends
   `PIDE/sledgehammer_sendback` with `{ text: <proof text> }` → the
   server replies with `PIDE/sledgehammer_insert` carrying
   `{ uri, line, character, text }` → the extension applies a workspace
   edit at that LSP position. Client responsibilities:
   - Treat `line`/`character` as **zero-based LSP positions** (UTF-16
     code units, per LSP §3.17 §`Position`), matching VS Code's native
     `Position` constructor.
   - Validate the `uri` matches a currently open editor; fall back to
     `vscode.workspace.openTextDocument` + `showTextDocument` if not.
   - Reject the edit if the document version has changed since
     `_request` (mirror the existing
     [`version` guard in `insertFirstSuggestion`](../src/sledgehammer/SledgehammerPanel.ts#L112-L115)).
   - Apply the edit through `WorkspaceEdit` / `TextEditor.edit`; the
     server does not apply it on the user's behalf.
   File: same `SledgehammerPanel.ts` edit as (2). Effort: **S**.

6. **Cache the configured provers list on LSP start.** Fire
   `PIDE/sledgehammer_provers_request` once after the LSP enters
   `"running"` and remember the response. Surface it as an optional
   advanced setting (`isabelle.sledgehammer.provers`,
   `isabelle.sledgehammer.isar`, `isabelle.sledgehammer.try0`) so users
   can override the defaults per workspace without re-querying. Effort:
   **S**.

7. **Block the implement PR on a quiescence signal for the active
   theory.** Sending `_request` against a non-quiescent prover state
   reproducibly returns `"<error_message>Unknown proof context</error_message>"`
   (see Findings). The follow-up must decide a concrete readiness
   policy: e.g., wait for at least one `textDocument/publishDiagnostics`
   round for the URI, or wait for a configurable post-`didOpen` delay
   with a status indicator. This is the only Implications item with a
   real correctness risk; everything else above is plumbing. Effort:
   **M**, and it is the gating dependency for (2)–(5) producing a
   useful result rather than just "Finished with empty output."

## Negative findings

State these explicitly so the project does not waste time investigating
them later.

- **Sledgehammer is not a code action.** `textDocument/codeAction` at
  `sorry` returns `[]` even though `codeActionProvider: true` is
  advertised. Do not bridge the panel to `CodeActionProvider`.
- **Sledgehammer is not a workspace command.** `executeCommandProvider`
  is not advertised at all. `workspace/executeCommand` is
  structurally unavailable for any Sledgehammer flow.
- **No discovery via `initialize`.** The `PIDE/sledgehammer_*` surface
  is not advertised in `initialize.capabilities` and there is no
  `experimental` object. A follow-up cannot autodetect support by
  inspecting capabilities; it must either pin to a known Isabelle
  release (see [PIDE_INTEGRATION.md](PIDE_INTEGRATION.md#honest-limits))
  or send `PIDE/sledgehammer_provers_request` as a soft probe and treat
  the absence of a response within a short window as "not supported."
- **No request correlation ids.** None of the `PIDE/sledgehammer_*`
  messages carry an `id`. There is no way to correlate a specific
  `_output` notification with a specific prior `_request`; the panel
  must serialize runs or accept that a late `_status: "Finished"` from
  a previous run will close a freshly-started one. The upstream
  `Query_Operation` is single-slot for the same reason.
- **No `PIDE/sledgehammer_*` minimization endpoint was found.** None of
  the `Sledgehammer_*` definitions in `lsp.scala` (lines 732–786) nor
  the dispatch arms in `language_server.scala` (lines 540–561) expose
  proof minimization as a distinct notification or request. A future
  minimization feature should not assume another `PIDE/*` notification
  exists; the second checkbox of Milestone 7 ("proof-minimization
  wiring") needs separate upstream investigation before it can be
  scheduled.

### Troubleshooting notes (observed but non-fatal)

Two log artifacts seen during the live probe that the follow-up PR
should expect but not treat as integration dependencies:

- `*** Session consumer failure: "isabelle.vscode.Dynamic_Output"` plus
  `*** Bad JSON value: isabelle.vscode.LSP$$$Lambda/...` lines on the
  server's stderr after `PIDE/caret_update`. These come from
  [`dynamic_output.scala`](#references) attempting to publish output
  panel state that the basic client never initialized. They do not
  abort the Sledgehammer run and the protocol-level
  `PIDE/sledgehammer_*` traffic remains intact. The extension already
  routes stderr to its `Isabelle Language Server` channel via the
  existing client wiring, so they will be visible but harmless.
- After client `shutdown` the probe received a final pair of
  `PIDE/sledgehammer_output { "content": "" }` /
  `PIDE/sledgehammer_status { "message": "Finished" }` notifications
  before `exit`. Late-arriving notifications during teardown should be
  ignored rather than re-rendered.

## References

- Upstream Isabelle VS Code source (mirror of what the bundled
  Isabelle 2025-2 install ships under
  `src/Tools/VSCode/src/`):
  <https://isabelle.in.tum.de/repos/isabelle/file/tip/src/Tools/VSCode/src>
- `src/Tools/VSCode/src/vscode_sledgehammer.scala` — Sledgehammer
  control panel for the language server, including the
  `Query_Operation("sledgehammer", consume_status, consume_output)`
  wiring and the `provers`, `request`, `sendback`, `cancel`, `locate`,
  `init`, `exit` methods.
- `src/Tools/VSCode/src/lsp.scala` lines 732–786 — verbatim
  `PIDE/sledgehammer_*` LSP message shapes (`Notification0` for the
  parameterless ones, custom `unapply`/`apply` for the parameterized
  ones), plus `PIDE/caret_update` at lines 573–580.
- `src/Tools/VSCode/src/language_server.scala` lines 540–561 —
  message dispatcher arms that wire the LSP traffic into the
  `VSCode_Sledgehammer` instance, plus lines 175 (instantiation), 345
  (`init` after session start), and 374 (`exit` during shutdown).
- `src/Tools/VSCode/src/dynamic_output.scala` — the dynamic output
  panel responsible for the `Session consumer failure` stderr noise
  seen above; not part of the Sledgehammer surface, but observable
  alongside it.
- Language Server Protocol specification, §3.17, particularly
  `Position` (zero-based, UTF-16 code units) and the distinction
  between notifications and requests:
  <https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/>
- This repository's existing extension surfaces affected by the
  follow-up implementation work:
  [`src/sledgehammer/SledgehammerPanel.ts`](../src/sledgehammer/SledgehammerPanel.ts),
  [`src/sledgehammer/sledgehammerRenderer.ts`](../src/sledgehammer/sledgehammerRenderer.ts),
  [`src/lsp/IsabelleLanguageClient.ts`](../src/lsp/IsabelleLanguageClient.ts),
  [`src/lsp/languageServerArgs.ts`](../src/lsp/languageServerArgs.ts),
  [`docs/PIDE_INTEGRATION.md`](PIDE_INTEGRATION.md).
