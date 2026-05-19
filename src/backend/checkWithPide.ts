import * as vscode from "vscode";
import { BackendClient } from "./BackendClient";
import {
  CancelWarmupResult,
  CheckWithPideParams,
  CheckWithPideResult
} from "../protocol/messages";

/**
 * Phase 2a thin wrapper around `document/checkWithPide`. Wraps the
 * call with a notification-level progress UI so the first-call PIDE
 * warmup (5-30 s typical) is visible AND cancellable. The cancel
 * button dispatches `pide/cancelWarmup` to the backend, which sets
 * an atomic flag the bootstrap loop checks at safe boundaries. Once
 * the session is warm, subsequent calls bypass the warmup entirely
 * and the progress notification resolves in well under a second.
 *
 * `pide/cancelWarmup` is **best-effort** in 2a: if the backend has
 * already entered PolyML's `start_session` JNI call (which blocks),
 * the cancel signal is honored on return, not mid-call. Full
 * structured cancellation of `use_theories` arrives in Phase 2b.
 */
export async function runCheckWithPideUx(
  client: BackendClient,
  params: CheckWithPideParams,
  options: { theoryDisplayName: string; sessionDisplayName: string }
): Promise<CheckWithPideResult> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      cancellable: true,
      title: `Isabelle: checking ${options.theoryDisplayName} via PIDE (session ${options.sessionDisplayName})`
    },
    async (progress, token) => {
      progress.report({ message: "warming up Headless session (first call may take 5-30 seconds)" });
      const cancelSubscription = token.onCancellationRequested(() => {
        // Phase 2b polish: surface a transient status-bar message so
        // the user understands why their next PIDE operation will be
        // slow (the cancel tore down the cached Session, so the next
        // request will pay another ~20 s of bootstrap). 25 s window
        // generously covers the expected re-bootstrap latency on the
        // dev machine.
        vscode.window.setStatusBarMessage(
          "Isabelle: PIDE session cancelled; will rebuild on next request (~20 s)...",
          25_000
        );
        void client
          .request<CancelWarmupResult, Record<string, never>>("pide/cancelWarmup", {})
          .catch(() => undefined);
      });
      try {
        return await client.request<CheckWithPideResult, CheckWithPideParams>(
          "document/checkWithPide",
          params
        );
      } finally {
        cancelSubscription.dispose();
      }
    }
  );
}
