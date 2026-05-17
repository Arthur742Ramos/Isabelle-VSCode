import { CommandSpan, ProtocolRange } from "../protocol/messages";
import { DocumentCommandStatus } from "./documentStatus";

export const STATUS_DECORATION_KEYS = [
  "pending",
  "running",
  "finished",
  "failed",
  "unknown"
] as const satisfies readonly DocumentCommandStatus[];

const STATUS_DECORATION_KEY_SET: ReadonlySet<string> = new Set(STATUS_DECORATION_KEYS);

export function emptyStatusRangeGroups(): Record<DocumentCommandStatus, ProtocolRange[]> {
  const groups = {
    pending: [],
    running: [],
    finished: [],
    failed: [],
    unknown: []
  } satisfies Record<DocumentCommandStatus, ProtocolRange[]>;

  return groups;
}

export function groupCommandSpanRangesByStatus(
  spans: readonly CommandSpan[]
): Record<DocumentCommandStatus, ProtocolRange[]> {
  const groups = emptyStatusRangeGroups();

  for (const span of spans) {
    const status: string = span.status;
    const key: DocumentCommandStatus = STATUS_DECORATION_KEY_SET.has(status)
      ? (status as DocumentCommandStatus)
      : "unknown";
    groups[key].push(span.range);
  }

  return groups;
}
