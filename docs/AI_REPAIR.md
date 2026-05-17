# AI repair seam

This document describes the optional AI-repair seam introduced in
PR #44 (Milestone 9 in the [roadmap](../README.md#roadmap)) and the
safety contract it sits behind.

## TL;DR

- The extension does **not** ship with any default AI provider that calls a third-party network service.
- A built-in **"manual paste-back" provider** ships under the id `manual-paste-back`. It satisfies the provider contract without making any network call: it copies the request to the clipboard and waits for you to point at a `.patch` file containing the AI's response. See [Built-in `manual-paste-back` provider](#built-in-manual-paste-back-provider) below.
- The new commands `Isabelle: Copy Checked Repair Request to Clipboard` and `Isabelle: Request AI Repair Suggestion` are additive — the original `Isabelle: Create Checked Repair Request` workflow is unchanged and still strictly local.
- Even when a provider is selected, the request command refuses to call it until you have explicitly set `isabelle.repair.aiAcknowledgedSharing` to `true`. The acknowledgement applies whether the network call is made by the extension or by you in another tool.

## Built-in `manual-paste-back` provider

To use it:

1. Set `"isabelle.repair.aiProvider": "manual-paste-back"`.
2. Set `"isabelle.repair.aiAcknowledgedSharing": true`. The acknowledgement is still required because you ARE sharing the captured request with whatever AI tool you paste it into — the extension just isn't transmitting it.
3. Run `Isabelle: Request AI Repair Suggestion (Experimental)`. The provider:
   - Copies the same request bundle the clipboard command produces to your clipboard.
   - Shows a prompt naming the document URI, version, and captured timestamp so you can confirm which run the patch will correspond to.
   - When you click **Open patch file...**, opens a file picker scoped to `.patch` / `.diff`.
   - Reads the chosen file and returns it through the existing preview pipeline — the patch is still validated by `Isabelle: Preview Repair Patch` before any edit is applied.

The provider returns a typed failure (with a descriptive reason) if you dismiss the prompt, cancel the picker, the file is missing or empty, or the clipboard write fails. Aborts (e.g. via the coordinator timeout) are honoured at every step.

## Two new commands

| Command | What it does | Network calls? |
| --- | --- | --- |
| `Isabelle: Copy Checked Repair Request to Clipboard` | Builds the same Markdown bundle that `Create Checked Repair Request` produces and puts it on the clipboard so you can paste it into any AI tool you already trust. | **None.** |
| `Isabelle: Request AI Repair Suggestion (Experimental)` | Delegates the bundle to the AI provider you have registered + selected, then writes the returned unified diff to a temp file and opens it. You then run the existing `Isabelle: Preview Repair Patch` command to validate it before applying anything. | **Only if** the gate below passes. |

Both commands honour the existing `RepairRequestSnapshot` shape
(URI, version, cursor, diagnostics, optional proof state) so any
provider receives the same content the local Markdown bundle
includes. Review this content before exposing it externally; it
may include source code and proof details.

## The safety gate

Two settings combine to gate any AI provider call:

| Setting | Type | Default | Meaning |
| --- | --- | --- | --- |
| `isabelle.repair.aiProvider` | string | `""` | Id of the registered provider to delegate to. Empty means "none". |
| `isabelle.repair.aiAcknowledgedSharing` | boolean | `false` | Explicit acknowledgement that the configured provider will receive the full repair request, which may include source code, diagnostics, and proof state. |

`Isabelle: Request AI Repair Suggestion` refuses unless **all** of
the following are true:

1. `isabelle.repair.aiProvider` is non-empty.
2. `isabelle.repair.aiAcknowledgedSharing` is `true`.
3. A provider with the configured id is registered in the running
   extension.

Any refusal surfaces as a VS Code warning with a descriptive
reason; the seam never silently drops a request.

The gate logic is pure (`src/repair/repairAiSettings.ts`
`decideRepairAiGate`) and covered by a dedicated vitest suite so
the policy can be verified independently of the rest of the
extension.

## Provider contract

A provider is any object satisfying:

```typescript
interface RepairAiProvider {
  readonly id: string;
  readonly displayName: string;
  generatePatch(
    request: RepairAiRequest,
    abortSignal?: AbortSignal
  ): Promise<RepairAiResult>;
}

interface RepairAiRequest {
  readonly requestMarkdown: string;
  readonly documentUri: string;
  readonly documentVersion: number;
  readonly capturedAt: string;
}

type RepairAiResult =
  | { ok: true; patchText: string; providerRunId?: string }
  | { ok: false; reason: string };
```

Providers should:

- Honour the `abortSignal` when supplied — the coordinator races
  the call against a 60-second default timeout (configurable per
  call) and aborts on timeout.
- Return a typed `{ ok: false, reason }` for expected failure
  modes (rate limits, authentication errors, content policy
  refusals) instead of throwing — throws are caught and wrapped
  into the same shape, but the typed result is clearer for users.
- Return a unified diff string (`patchText`) that the existing
  `Isabelle: Preview Repair Patch` command can validate. The
  existing patch parser is intentionally strict — see
  `src/repair/unifiedDiff.ts` and the `previewRepairPatch`
  validation in `RepairService` — so providers should return
  conservative diffs (no renames, no binary diffs, no absolute
  paths, no path traversal).

A provider registers via the global `RepairAiProviderRegistry`
instance constructed in `extension.ts`. There are two ways to do
this:

1. **From inside this extension** — modify the extension source.
   This is the path the bundled "manual paste-back" provider uses.
2. **From a third-party VS Code extension** — use the extension API
   exposed by `activate()`:

   ```typescript
   import * as vscode from "vscode";

   export async function activate(context: vscode.ExtensionContext) {
     const isabelle = vscode.extensions.getExtension(
       "arthur742ramos.isabelle-pide-vscode"
     );
     if (!isabelle) return;
     const api = await isabelle.activate();
     if (!api || api.version !== "1") return;

     const disposable = api.registerRepairAiProvider({
       id: "my-provider",
       displayName: "My AI Provider",
       async generatePatch(request, signal) {
         // ... call your service ...
         return { ok: true, patchText: unifiedDiffString };
       }
     });
     context.subscriptions.push(disposable);
   }
   ```

   The `api.version` field is the canonical compat tag; it bumps
   whenever the surface changes in a non-additive way. Third-party
   extensions should check it before using any other field.

## Secret storage

Providers that need an API key should pull it from the extension's
`SecretStorage`-backed credential store instead of reading from
workspace settings (which serialise to plain JSON files). Two
mechanisms support this:

1. **`Isabelle: Set AI Repair Provider Secret`** /
   **`Isabelle: Clear AI Repair Provider Secret`** commands let
   users register a secret without provider authors having to
   ship their own UI. The set command prefills the current
   `isabelle.repair.aiProvider` value, prompts for the secret
   with `password: true` (so it never surfaces in clear text),
   and treats an empty value as "delete the existing entry".
2. The extension API exposes the same store via
   `api.getRepairAiSecretStore()`. Provider code can do:

   ```typescript
   const secret = await api.getRepairAiSecretStore().get(provider.id);
   if (!secret) {
     return { ok: false, reason: "No API key configured for this provider." };
   }
   ```

Both paths key under `isabelle.repair.aiSecret.<providerId>` and
the helper rejects ids outside `[A-Za-z0-9._-]` so a hostile
provider id cannot escape the namespace.



- It does not ship a default provider — that would constitute the
  extension calling a third-party service on installation, which
  is exactly the policy this gate exists to prevent.
- It does not store credentials in workspace settings. The bundled
  `RepairAiSecretStore` writes to `vscode.SecretStorage`; providers
  should use it via `api.getRepairAiSecretStore()` rather than
  reading their own settings.
- It does not auto-apply provider-supplied patches. The existing
  preview-then-build-then-verify pipeline is the only path that
  reports a repair as checked.
- It does not bypass the existing patch safety checks (no added /
  deleted files, no renames, no path traversal, document-version
  guard against stale targets, etc.). Any patch the provider
  returns goes through the same `previewRepairPatch` path the
  manual flow uses.

## References

- [`src/api/IsabellePideExtensionApi.ts`](../src/api/IsabellePideExtensionApi.ts)
  — the public `activate()` return surface (v1) that third-party
  extensions register against.
- [`src/repair/repairAiSettings.ts`](../src/repair/repairAiSettings.ts)
  — settings reader + pure gate decision.
- [`src/repair/repairAiProvider.ts`](../src/repair/repairAiProvider.ts)
  — provider registry + timeout-bounded coordinator.
- [`src/repair/RepairService.ts`](../src/repair/RepairService.ts)
  — the two new commands.
- [`src/repair/RepairAiSecretStore.ts`](../src/repair/RepairAiSecretStore.ts)
  — `vscode.SecretStorage`-backed namespaced credential store for
  AI provider keys.
- [`src/repair/ManualPasteBackRepairAiProvider.ts`](../src/repair/ManualPasteBackRepairAiProvider.ts)
  — the built-in "manual paste-back" provider registered on
  activation; no network calls.
- [`src/repair/unifiedDiff.ts`](../src/repair/unifiedDiff.ts) —
  the strict patch parser the preview command applies.
- README "Checked repair workflow" section — describes the
  end-to-end manual flow that AI-suggested patches still route
  through.
