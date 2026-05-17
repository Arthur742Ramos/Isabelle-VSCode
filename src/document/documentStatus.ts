import { CommandSpan, ProtocolPosition, ProtocolRange } from "../protocol/messages";
import { findCommandSpanAtOrBefore } from "./commandSpans";

export const DOCUMENT_STATUS_SOURCE = "local-command-spans";
export const DOCUMENT_STATUS_SOURCE_LABEL = "Local command spans (syntax-only)";
export const DOCUMENT_STATUS_DISCLAIMER =
  "Local syntax-only status from synchronized command spans; not PIDE diagnostics, proof checking, or Isabelle processing.";

type CommandStatus = CommandSpan["status"];

export interface DocumentStatusCommand {
  id: string;
  label: string;
  kind: string;
  name?: string;
  status: CommandStatus;
  range: ProtocolRange;
}

export interface DocumentStatusSummary {
  uri: string;
  version: number;
  source: typeof DOCUMENT_STATUS_SOURCE;
  sourceLabel: typeof DOCUMENT_STATUS_SOURCE_LABEL;
  disclaimer: typeof DOCUMENT_STATUS_DISCLAIMER;
  diagnostics: {
    published: false;
    source: "none";
    reason: string;
  };
  commandCount: number;
  statusCounts: Record<CommandStatus, number>;
  currentCommand?: DocumentStatusCommand;
}

export interface BuildDocumentStatusParams {
  uri: string;
  version: number;
  spans: CommandSpan[];
  position?: ProtocolPosition;
}

const COMMAND_STATUSES: CommandStatus[] = ["pending", "running", "finished", "failed", "unknown"];
const DIAGNOSTIC_REASON = "This local status surface does not publish Isabelle diagnostics.";

export function buildDocumentStatusSummary(params: BuildDocumentStatusParams): DocumentStatusSummary {
  const current = params.position
    ? findCommandSpanAtOrBefore(params.spans, params.position)
    : undefined;

  return {
    uri: params.uri,
    version: params.version,
    source: DOCUMENT_STATUS_SOURCE,
    sourceLabel: DOCUMENT_STATUS_SOURCE_LABEL,
    disclaimer: DOCUMENT_STATUS_DISCLAIMER,
    diagnostics: {
      published: false,
      source: "none",
      reason: DIAGNOSTIC_REASON
    },
    commandCount: params.spans.length,
    statusCounts: countStatuses(params.spans),
    currentCommand: current ? statusCommand(current) : undefined
  };
}

export function formatDocumentStatusBarText(summary: DocumentStatusSummary): string {
  if (summary.currentCommand) {
    return `$(symbol-method) Isabelle local: ${summary.currentCommand.kind} ${summary.currentCommand.status}`;
  }

  return `$(symbol-method) Isabelle local: ${summary.commandCount} ${pluralize(summary.commandCount, "span")}`;
}

export function formatDocumentStatusTooltip(summary: DocumentStatusSummary): string {
  const lines = [
    summary.sourceLabel,
    summary.disclaimer,
    `Commands: ${summary.commandCount}`,
    `Statuses: ${formatStatusCounts(summary.statusCounts)}`,
    `Diagnostics: ${summary.diagnostics.reason}`
  ];

  if (summary.currentCommand) {
    lines.splice(3, 0, `Current command: ${summary.currentCommand.label} (${summary.currentCommand.status})`);
  }

  return lines.join("\n");
}

export function formatDocumentStatusDetails(summary: DocumentStatusSummary): string {
  const lines = [
    "Isabelle local document status",
    `URI: ${summary.uri}`,
    `Version: ${summary.version}`,
    `Source: ${summary.sourceLabel}`,
    `Scope: ${summary.disclaimer}`,
    `Command spans: ${summary.commandCount}`,
    `Status counts: ${formatStatusCounts(summary.statusCounts)}`,
    `Diagnostics: ${summary.diagnostics.reason}`
  ];

  if (summary.currentCommand) {
    lines.push(
      `Current command: ${summary.currentCommand.label}`,
      `Current local status: ${summary.currentCommand.status}`,
      `Current range: ${formatRange(summary.currentCommand.range)}`
    );
  } else {
    lines.push("Current command: none");
  }

  return lines.join("\n");
}

function countStatuses(spans: CommandSpan[]): Record<CommandStatus, number> {
  const counts = Object.fromEntries(COMMAND_STATUSES.map((status) => [status, 0])) as Record<CommandStatus, number>;

  for (const span of spans) {
    counts[span.status]++;
  }

  return counts;
}

function statusCommand(span: CommandSpan): DocumentStatusCommand {
  return {
    id: span.id,
    label: `${span.kind}${span.name ? ` ${span.name}` : ""}`,
    kind: span.kind,
    name: span.name,
    status: span.status,
    range: span.range
  };
}

function formatStatusCounts(counts: Record<CommandStatus, number>): string {
  return COMMAND_STATUSES
    .filter((status) => counts[status] > 0)
    .map((status) => `${status} ${counts[status]}`)
    .join(", ") || "none";
}

function formatRange(range: ProtocolRange): string {
  return `${range.start.line + 1}:${range.start.character + 1}-${range.end.line + 1}:${range.end.character + 1}`;
}

function pluralize(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}
