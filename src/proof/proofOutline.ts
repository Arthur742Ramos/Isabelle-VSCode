import { CommandSpan, ProtocolPosition } from "../protocol/messages";
import {
  isDeclarationCommand,
  isProofStatementCommand,
  isProofStepCommand,
  isProofTerminalCommand,
  isTheoryStructureCommand
} from "../semantic/isabelleSyntax";
import { containsPosition, startsAfter, startsBeforeOrAt } from "../document/commandSpans";

export interface ProofOutlineNode {
  id: string;
  label: string;
  detail: string;
  span: CommandSpan;
  children: ProofOutlineNode[];
}

export type ProofActionKind = "refreshProofState" | "buildActiveSession" | "insertSorry" | "insertOops";

export interface ProofAction {
  kind: ProofActionKind;
  label: string;
  description: string;
  commandText?: string;
}

export function buildProofOutline(spans: CommandSpan[]): ProofOutlineNode[] {
  const roots: ProofOutlineNode[] = [];
  let activeStatement: ProofOutlineNode | undefined;

  for (const span of spans) {
    const node = outlineNode(span);
    if (isProofStatementCommand(span.kind)) {
      roots.push(node);
      activeStatement = node;
      continue;
    }

    if ((isProofStepCommand(span.kind) || isProofTerminalCommand(span.kind)) && activeStatement) {
      activeStatement.children.push(node);
      if (isProofTerminalCommand(span.kind)) {
        activeStatement = undefined;
      }
      continue;
    }

    roots.push(node);
    if (isTheoryStructureCommand(span.kind) || isDeclarationCommand(span.kind)) {
      activeStatement = undefined;
    }
  }

  return roots;
}

export function flattenProofOutline(nodes: ProofOutlineNode[]): ProofOutlineNode[] {
  return nodes.flatMap((node) => [node, ...flattenProofOutline(node.children)]);
}

export function findCommandSpanAtOrBefore(
  spans: CommandSpan[],
  position: ProtocolPosition
): CommandSpan | undefined {
  return spans.find((span) => containsPosition(span, position))
    ?? findLast(spans, (span) => startsBeforeOrAt(span.range.start, position));
}

export function nextCommandSpan(spans: CommandSpan[], position: ProtocolPosition): CommandSpan | undefined {
  return spans.find((span) => startsAfter(span.range.start, position));
}

export function previousCommandSpan(spans: CommandSpan[], position: ProtocolPosition): CommandSpan | undefined {
  const current = findCommandSpanAtOrBefore(spans, position);
  if (current) {
    const index = spans.findIndex((span) => span.id === current.id);
    return index > 0 ? spans[index - 1] : undefined;
  }

  return findLast(spans, (span) => startsBeforeOrAt(span.range.start, position));
}

export function findCommandSpanById(spans: CommandSpan[], id: string): CommandSpan | undefined {
  return spans.find((span) => span.id === id);
}

export function proofActionsForCommand(span: CommandSpan | undefined, activeSessionName?: string): ProofAction[] {
  const actions: ProofAction[] = [
    {
      kind: "refreshProofState",
      label: "Refresh Proof State",
      description: "Ask the backend for the current placeholder proof state."
    },
    {
      kind: "buildActiveSession",
      label: activeSessionName ? `Build Active Session (${activeSessionName})` : "Build Active Session",
      description: activeSessionName
        ? "Run the Isabelle CLI build for the selected session."
        : "Select or infer an Isabelle session, then run the CLI build."
    }
  ];

  if (span && supportsProofInsertion(span.kind)) {
    actions.push(
      {
        kind: "insertSorry",
        label: "Insert `sorry` on Next Line",
        description: "Explicitly admit the current proof obligation; Isabelle still needs to verify the file.",
        commandText: "sorry"
      },
      {
        kind: "insertOops",
        label: "Insert `oops` on Next Line",
        description: "Explicitly abandon the current proof attempt.",
        commandText: "oops"
      }
    );
  }

  return actions;
}

export function supportsProofInsertion(kind: string): boolean {
  return isProofStatementCommand(kind) || isProofStepCommand(kind);
}

function outlineNode(span: CommandSpan): ProofOutlineNode {
  return {
    id: span.id,
    label: `${span.kind}${span.name ? ` ${span.name}` : ""}`,
    detail: `${span.range.start.line + 1}:${span.range.start.character + 1}`,
    span,
    children: []
  };
}

function findLast<T>(items: T[], predicate: (item: T) => boolean): T | undefined {
  for (let index = items.length - 1; index >= 0; index--) {
    if (predicate(items[index])) {
      return items[index];
    }
  }
  return undefined;
}
