import { ProofStateResult } from "../protocol/messages";

export type RepairDiagnosticSeverity = "error" | "warning" | "information" | "hint";

export interface RepairDiagnosticSnapshot {
  severity: RepairDiagnosticSeverity;
  message: string;
  source?: string;
  range?: {
    startLine: number;
    startCharacter: number;
    endLine: number;
    endCharacter: number;
  };
}

export interface RepairRequestSnapshot {
  capturedAt: string;
  documentUri: string;
  documentPath: string;
  documentVersion: number;
  cursor: {
    line: number;
    character: number;
  };
  diagnostics: RepairDiagnosticSnapshot[];
  proofState?: ProofStateResult;
}

export function buildRepairRequestMarkdown(snapshot: RepairRequestSnapshot): string {
  return [
    "# Isabelle checked repair request",
    "",
    "This request was generated locally by the Isabelle VS Code extension. No external AI service has been called, and no edits have been applied automatically.",
    "",
    "Review this content before sharing it outside your workspace; diagnostics and proof state may include source code or proof details.",
    "",
    "## Document",
    "",
    `- URI: \`${snapshot.documentUri}\``,
    `- Path: \`${snapshot.documentPath}\``,
    `- Version: ${snapshot.documentVersion}`,
    `- Cursor: ${formatOneBasedPosition(snapshot.cursor.line, snapshot.cursor.character)}`,
    `- Captured at: ${snapshot.capturedAt}`,
    "",
    "## Diagnostics",
    "",
    renderDiagnostics(snapshot.diagnostics),
    "",
    "## Proof context",
    "",
    renderProofState(snapshot.proofState),
    "",
    "## Proposed repair",
    "",
    "Paste or save a proposed unified diff separately, then run `Isabelle: Preview Repair Patch`. The preview command is read-only, rejects unsafe patch shapes, and opens a local verification plan with active-session build details when available.",
    "",
    "After manually applying trusted edits, run `Isabelle: Check Current Workspace for Repair` or the build command listed in the verification plan. Only report success after Isabelle verifies the current workspace contents.",
    ""
  ].join("\n");
}

function renderDiagnostics(diagnostics: RepairDiagnosticSnapshot[]): string {
  if (diagnostics.length === 0) {
    return "No diagnostics were reported for this document.";
  }

  return diagnostics
    .map((diagnostic, index) => {
      const source = diagnostic.source ? ` (${diagnostic.source})` : "";
      const range = diagnostic.range ? ` at ${formatRange(diagnostic.range)}` : "";
      return `${index + 1}. **${diagnostic.severity}**${source}${range}\n\n${fence(diagnostic.message)}`;
    })
    .join("\n\n");
}

function renderProofState(proofState: ProofStateResult | undefined): string {
  if (!proofState) {
    return "Proof state was not captured.";
  }

  const lines = [
    `- Status: ${proofState.status}`,
    proofState.message ? `- Message: ${proofState.message}` : undefined,
    proofState.command
      ? `- Command: \`${proofState.command.kind}${proofState.command.name ? ` ${proofState.command.name}` : ""}\` at ${formatRange({
          startLine: proofState.command.range.start.line,
          startCharacter: proofState.command.range.start.character,
          endLine: proofState.command.range.end.line,
          endCharacter: proofState.command.range.end.character
        })}`
      : "- Command: none reported"
  ].filter((line): line is string => line !== undefined);

  if (proofState.context.length > 0) {
    lines.push("", "### Context", "");
    for (const entry of proofState.context) {
      lines.push(`- ${entry.kind}${entry.name ? ` ${entry.name}` : ""}: \`${entry.value}\``);
    }
  }

  if (proofState.goals.length > 0) {
    lines.push("", "### Goals", "");
    for (const goal of proofState.goals) {
      lines.push(`#### Goal ${goal.index}`, "", fence(goal.text), "");
    }
  }

  if (proofState.raw) {
    lines.push("", "### Raw proof state", "", fence(proofState.raw));
  }

  return lines.join("\n");
}

function formatRange(range: NonNullable<RepairDiagnosticSnapshot["range"]>): string {
  return `${formatOneBasedPosition(range.startLine, range.startCharacter)}-${formatOneBasedPosition(range.endLine, range.endCharacter)}`;
}

function formatOneBasedPosition(line: number, character: number): string {
  return `${line + 1}:${character + 1}`;
}

function fence(value: string): string {
  return `~~~text\n${value.replace(/~~~/g, "~~\\~")}\n~~~`;
}
