/**
 * Pure logic + thin VS Code wiring for the
 * `Isabelle: Show PIDE Backend Status` command.
 *
 * The command dispatches `isabelle/pideVersion` against the Scala
 * backend, threads the user's currently-configured
 * `isabelle.executablePath` through as a parameter, and renders the
 * resulting {@link PideVersionResult} as a single info-message
 * summary plus an `Open backend logs` action when something failed.
 *
 * The formatter is `vscode`-free so vitest can cover every branch.
 * Production wiring lives in {@link registerShowPideBackendStatusCommand};
 * tests cover only {@link formatPideBackendStatus}.
 */

import {
  PideVersionResult,
  PideVersionReason
} from "../protocol/messages";

/**
 * Map a backend {@link PideVersionReason} to the matching user-facing
 * remediation hint. Falls back to a generic line for unknown codes so
 * a future backend extension does not crash the UI.
 */
function reasonHint(reason: PideVersionReason | undefined): string | undefined {
  switch (reason) {
    case "home-not-found":
      return "Set `ISABELLE_HOME` or configure `isabelle.executablePath`, then reload the window so the backend re-resolves the install.";
    case "isabelle-jar-missing":
      return "The resolved Isabelle install is missing `lib/classes/isabelle.jar`. Re-install Isabelle from https://isabelle.in.tum.de/.";
    case "scala-runtime-missing":
      return "The Isabelle install does not contain a `contrib/scala-*` runtime with both Scala 3 and Scala 2.13 jars. Re-install Isabelle to restore the bundled Scala runtime.";
    case "class-load-failed":
      return "The classpath built but `isabelle.Isabelle_System` could not be loaded — likely a corrupted Isabelle install or a Scala version mismatch.";
    case "module-init-failed":
      return "Isabelle classes load but the Scala 3 module initializer failed. Open the backend logs for the full stack trace.";
    case undefined:
      return undefined;
    default:
      return undefined;
  }
}

export type PideBackendStatusSeverity = "info" | "warning";

export interface FormattedPideBackendStatus {
  readonly title: string;
  readonly detail: string;
  readonly severity: PideBackendStatusSeverity;
}

/**
 * Render a {@link PideVersionResult} as a human-readable summary. The
 * shape matches what the VS Code info/warning toast API expects: a
 * short `title` plus a longer `detail`.
 *
 * - When `bridge === "pide-enabled"`, the title surfaces the resolved
 *   Isabelle version and the detail describes which phases of the PIDE
 *   integration are wired up. Severity is `info`.
 * - When unavailable, the title summarises the failure, the detail
 *   includes the backend-supplied message AND a remediation hint
 *   derived from the {@link PideVersionReason} code. Severity is
 *   `warning`.
 */
export function formatPideBackendStatus(
  result: PideVersionResult
): FormattedPideBackendStatus {
  if (result.bridge === "pide-enabled") {
    const home = result.isabelleHome
      ? ` at ${result.isabelleHome}`
      : "";
    return {
      title: `Isabelle/PIDE bridge ready: ${result.version}${home}.`,
      detail: result.message,
      severity: "info"
    };
  }

  const hint = reasonHint(result.reason);
  const detailParts: string[] = [result.message];
  if (hint) {
    detailParts.push(hint);
  }
  return {
    title: "Isabelle/PIDE bridge unavailable.",
    detail: detailParts.join(" "),
    severity: "warning"
  };
}
