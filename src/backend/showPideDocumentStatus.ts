import { CheckWithPideResult, CheckWithPideReason } from "../protocol/messages";

/**
 * Pure formatter for `Isabelle: Show PIDE Document Status` results.
 * Maps a {@link CheckWithPideResult} into a short title + detailed
 * body plus a severity hint so the VS Code wiring can decide which
 * toast / notification to surface.
 *
 * Kept vscode-free so vitest can pin every branch.
 */
export type PideDocumentStatusSeverity = "info" | "warning" | "error";

export interface FormattedPideDocumentStatus {
  readonly title: string;
  readonly detail: string;
  readonly severity: PideDocumentStatusSeverity;
}

function reasonHint(reason: CheckWithPideReason | undefined): string | undefined {
  switch (reason) {
    case "text-missing":
      return "Open the theory file in the editor before running this command.";
    case "session-not-selected":
      return "Run `Isabelle: Select Active Session` to pick a session, or set `isabelle.session.active`.";
    case "home-not-found":
      return "Configure `isabelle.executablePath` or set `ISABELLE_HOME`, then reload the window to restart the backend.";
    case "isabelle-jar-missing":
      return "The resolved Isabelle install is incomplete (missing `lib/classes/isabelle.jar`). Re-install Isabelle.";
    case "scala-runtime-missing":
      return "The resolved Isabelle install lacks the bundled Scala 3 runtime under `contrib/scala-*/lib/`. Re-install Isabelle.";
    case "warmup-cancelled":
      return "Cancellation honored; the next attempt will re-warm a fresh session.";
    case "environment-init":
      return "Isabelle's `isabelle.setup.Environment.init` failed (often because the bundled Cygwin / bash subprocess could not run). Check the backend output channel for the full error.";
    case "options-init":
    case "resources-make":
    case "start-session":
      return "Isabelle classes loaded but the headless session bootstrap failed. Check the backend output channel for the underlying error.";
    case undefined:
      return undefined;
    default:
      return undefined;
  }
}

export function formatPideDocumentStatus(result: CheckWithPideResult): FormattedPideDocumentStatus {
  switch (result.status) {
    case "pide-ok": {
      const nodes = result.nodeCount ?? 0;
      const elapsed = result.elapsedMs ?? 0;
      return {
        title: `Isabelle/PIDE check OK: ${result.theoryName} (${nodes} node${nodes === 1 ? "" : "s"}, ${elapsed} ms)`,
        detail: result.message,
        severity: "info"
      };
    }

    case "pide-errors": {
      const errs = result.errorCount ?? 0;
      const sample = (result.errorMessages ?? []).slice(0, 5).join("\n");
      return {
        title: `Isabelle/PIDE found ${errs} error${errs === 1 ? "" : "s"} in ${result.theoryName}`,
        detail: sample || result.message,
        severity: "error"
      };
    }

    case "pide-cancelled":
      return {
        title: "Isabelle/PIDE check cancelled.",
        detail: result.message,
        severity: "warning"
      };

    case "pide-unavailable": {
      const hint = reasonHint(result.reason);
      const detail = hint ? `${result.message} ${hint}` : result.message;
      return {
        title: "Isabelle/PIDE bridge unavailable for this document.",
        detail,
        severity: "warning"
      };
    }

    case "pide-failed": {
      const hint = reasonHint(result.reason);
      const detail = hint ? `${result.message} ${hint}` : result.message;
      return {
        title: `Isabelle/PIDE submission failed: ${result.theoryName}`,
        detail,
        severity: "error"
      };
    }

    default:
      // Future-proofing: unknown status code from a newer backend.
      return {
        title: `Isabelle/PIDE returned an unrecognised status (${(result as { status?: unknown }).status ?? "unknown"}).`,
        detail: result.message,
        severity: "warning"
      };
  }
}

/**
 * Format the error-message list returned by the backend so the
 * output channel renders it cleanly. Returns at most `limit` lines
 * plus a "+N more" tail.
 */
export function formatErrorMessages(messages: ReadonlyArray<string>, limit: number = 10): string {
  if (messages.length === 0) {
    return "(none)";
  }
  const sample = messages.slice(0, limit);
  const overflow = messages.length - sample.length;
  const head = sample.map((m, idx) => `  [${idx + 1}] ${m}`).join("\n");
  return overflow > 0 ? `${head}\n  ... and ${overflow} more` : head;
}
