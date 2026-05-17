# AI repair seam

This document describes the optional AI-repair seam introduced in
PR #44 (Milestone 9 in the [roadmap](../README.md#roadmap)) and the
safety contract it sits behind.

## TL;DR

- The extension does **not** ship with any default AI provider.
- The new commands `Isabelle: Copy Checked Repair Request to
  Clipboard` and `Isabelle: Request AI Repair Suggestion` are
  additive — the original `Isabelle: Create Checked Repair Request`
  workflow is unchanged and still strictly local.
- Even when a provider is registered, the request command refuses
  to call it until you have explicitly set
  `isabelle.repair.aiAcknowledgedSharing` to `true`. This is the
  gate the extension uses to make sure no proof context can be
  silently exfiltrated to a third-party service.

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
instance constructed in `extension.ts`. There is currently no
extension-API surface for third-party VS Code extensions to
register against it; that's a follow-up. Today, registering a
provider means modifying the extension source. The seam is
positioned so a future PR (or fork) can add a concrete provider
without changing the existing surface.

## What this seam intentionally does NOT do

- It does not ship a default provider — that would constitute the
  extension calling a third-party service on installation, which
  is exactly the policy this gate exists to prevent.
- It does not store credentials. A future provider that needs an
  API key should fetch it from VS Code's `SecretStorage` so it
  never lands in workspace settings.
- It does not auto-apply provider-supplied patches. The existing
  preview-then-build-then-verify pipeline is the only path that
  reports a repair as checked.
- It does not bypass the existing patch safety checks (no added /
  deleted files, no renames, no path traversal, document-version
  guard against stale targets, etc.). Any patch the provider
  returns goes through the same `previewRepairPatch` path the
  manual flow uses.

## References

- [`src/repair/repairAiSettings.ts`](../src/repair/repairAiSettings.ts)
  — settings reader + pure gate decision.
- [`src/repair/repairAiProvider.ts`](../src/repair/repairAiProvider.ts)
  — provider registry + timeout-bounded coordinator.
- [`src/repair/RepairService.ts`](../src/repair/RepairService.ts)
  — the two new commands.
- [`src/repair/unifiedDiff.ts`](../src/repair/unifiedDiff.ts) —
  the strict patch parser the preview command applies.
- README "Checked repair workflow" section — describes the
  end-to-end manual flow that AI-suggested patches still route
  through.
