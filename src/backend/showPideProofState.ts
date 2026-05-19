import { ProofStateWithPideResult, ProofStateWithPideReason } from "../protocol/messages";

/**
 * Pure formatter for the Phase 3a `Isabelle: Show PIDE Proof State
 * at Cursor` command. Maps a {@link ProofStateWithPideResult} into a
 * short title + detailed body so the VS Code wiring can decide which
 * toast / notification to surface.
 *
 * Kept vscode-free so vitest pins every branch.
 */
export type PideProofStateSeverity = "info" | "warning" | "error";

export interface FormattedPideProofState {
  readonly title: string;
  readonly detail: string;
  readonly severity: PideProofStateSeverity;
}

function reasonHint(reason: ProofStateWithPideReason | undefined): string | undefined {
  switch (reason) {
    case "text-missing":
      return "Open the theory file in the editor before running this command.";
    case "session-not-selected":
      return "Run `Isabelle: Select Active Session` first.";
    case "home-not-found":
      return "Configure `isabelle.executablePath` or set `ISABELLE_HOME`.";
    case "isabelle-jar-missing":
    case "scala-runtime-missing":
      return "The resolved Isabelle install is incomplete. Re-install Isabelle.";
    case "warmup-cancelled":
      return "Cancelled; the next call will re-bootstrap.";
    case "submit-failed":
    case "snapshot-missing":
    case "extract-failed":
      return "Open the backend output channel for the full reflective trace.";
    case undefined:
      return undefined;
    default:
      return undefined;
  }
}

export function formatPideProofState(result: ProofStateWithPideResult): FormattedPideProofState {
  if (result.status === "ready") {
    const cmd = result.command?.kind ?? "unknown";
    const goalCount = result.goals?.length ?? 0;
    const fromCache = result.fromCache ? " (from cache)" : "";
    const title = `PIDE proof state${fromCache}: ${result.theoryName ?? "theory"} at ${cmd}`;
    return {
      title,
      detail: result.message ?? `${goalCount} goal(s)`,
      severity: "info"
    };
  }

  const hint = reasonHint(result.reason);
  const detail = hint ? `${result.message ?? ""} ${hint}` : (result.message ?? "");
  return {
    title: "PIDE proof state unavailable",
    detail,
    severity: result.reason === "warmup-cancelled" ? "warning" : "error"
  };
}
