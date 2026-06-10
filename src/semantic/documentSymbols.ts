import { CommandSpan, ProtocolRange } from "../protocol/messages";
import { getCommandInfo, IsabelleCommandCategory } from "./isabelleSyntax";

export type IsabelleSymbolKind =
  | "namespace"
  | "module"
  | "class"
  | "interface"
  | "enum"
  | "struct"
  | "method"
  | "function"
  | "field"
  | "variable"
  | "string";

export interface IsabelleDocumentSymbol {
  name: string;
  detail: string;
  kind: IsabelleSymbolKind;
  range: ProtocolRange;
  selectionRange: ProtocolRange;
  children: IsabelleDocumentSymbol[];
}

const NAMED_FALLBACKS = new Map<string, string>([
  ["section", "section"],
  ["subsection", "subsection"],
  ["subsubsection", "subsubsection"],
  ["text", "text"],
  ["theory", "theory"],
  ["begin", "begin"],
  ["end", "end"],
  ["proof", "proof"],
  ["by", "by"],
  ["done", "done"],
  ["sorry", "sorry"],
  ["oops", "oops"],
  ["qed", "qed"],
  ["show", "show"]
]);

// Document-heading commands and their nesting level (smaller = outer), so the
// outline can nest a section's declarations beneath it. Mirrors the folding
// provider's heading hierarchy.
const HEADING_LEVELS = new Map<string, number>([
  ["chapter", 1],
  ["section", 2],
  ["subsection", 3],
  ["subsubsection", 4],
  ["paragraph", 5],
  ["subparagraph", 6]
]);

export function extractIsabelleDocumentSymbols(spans: CommandSpan[]): IsabelleDocumentSymbol[] {
  const roots: MutableSymbol[] = [];
  // Stack of open headings, shallowest first, each entry carrying its level so
  // a new heading can close the equal-or-deeper ones it supersedes.
  const headingStack: Array<{ level: number; symbol: MutableSymbol }> = [];
  let activeParent: MutableSymbol | undefined;

  // Append a freshly-created top-level symbol either under the deepest open
  // heading or, when there is none, at the document root.
  const placeTopLevel = (symbol: MutableSymbol): void => {
    const enclosing = headingStack[headingStack.length - 1]?.symbol;
    if (enclosing) {
      enclosing.children.push(symbol);
      enclosing.range = mergeRanges(enclosing.range, symbol.range);
    } else {
      roots.push(symbol);
    }
  };

  for (const span of spans) {
    const info = getCommandInfo(span.kind);
    if (!info) {
      continue;
    }

    const headingLevel = HEADING_LEVELS.get(span.kind);
    if (headingLevel !== undefined) {
      // A heading closes every open heading at its level or deeper.
      while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= headingLevel) {
        headingStack.pop();
      }
      activeParent = undefined;
      const symbol = createSymbol(span, info.category);
      if (symbol) {
        placeTopLevel(symbol);
        headingStack.push({ level: headingLevel, symbol });
      }
      continue;
    }

    if (isTopLevelSymbol(info.category)) {
      // Structural theory keywords (`theory`, `begin`, `end`) are not part of a
      // section — they bracket the whole theory body — so they reset the heading
      // hierarchy and sit at the document root, never nested under a heading.
      const isStructuralKeyword = span.kind === "theory" || span.kind === "begin" || span.kind === "end";
      const symbol = createSymbol(span, info.category);
      if (!symbol) {
        activeParent = undefined;
        continue;
      }
      if (isStructuralKeyword) {
        headingStack.length = 0;
        roots.push(symbol);
        activeParent = undefined;
        continue;
      }
      placeTopLevel(symbol);
      activeParent = symbol;
      continue;
    }

    if (activeParent && isProofSymbol(info.category)) {
      const child = createSymbol(span, info.category);
      if (child) {
        activeParent.children.push(child);
        activeParent.range = mergeRanges(activeParent.range, child.range);
        propagateRangeToHeadings(headingStack, child.range);
      }
    }
  }

  return roots.map(toPublicSymbol);
}

/** Extend every open heading's range to include a newly-added descendant. */
function propagateRangeToHeadings(
  headingStack: Array<{ level: number; symbol: MutableSymbol }>,
  range: ProtocolRange
): void {
  for (const entry of headingStack) {
    entry.symbol.range = mergeRanges(entry.symbol.range, range);
  }
}

function createSymbol(span: CommandSpan, category: IsabelleCommandCategory): MutableSymbol | undefined {
  const name = symbolName(span);
  if (!name) {
    return undefined;
  }

  return {
    name,
    detail: span.kind,
    kind: symbolKind(span.kind, category),
    range: span.range,
    selectionRange: span.range,
    children: []
  };
}

function symbolName(span: CommandSpan): string | undefined {
  if (span.name) {
    return span.name;
  }
  return NAMED_FALLBACKS.get(span.kind);
}

function symbolKind(commandKind: string, category: IsabelleCommandCategory): IsabelleSymbolKind {
  if (commandKind === "theory") {
    return "module";
  }
  if (commandKind === "section" || commandKind === "subsection" || commandKind === "subsubsection") {
    return "namespace";
  }
  if (commandKind === "locale" || commandKind === "context" || commandKind === "class" || commandKind === "instantiation") {
    // Locales and type classes group operations + assumptions, like a class.
    return "class";
  }
  if (commandKind === "datatype" || commandKind === "codatatype") {
    // Sum types with named constructors map most naturally onto an enum.
    return "enum";
  }
  if (commandKind === "record") {
    // A product type with named fields is a struct.
    return "struct";
  }
  if (commandKind === "typedef" || commandKind === "typedecl" || commandKind === "type_synonym") {
    // Abstract / alias type introductions surface as an interface.
    return "interface";
  }
  if (category === "statement") {
    return "method";
  }
  if (category === "proof") {
    return "field";
  }
  if (category === "declaration") {
    return "function";
  }
  if (category === "theory") {
    return "namespace";
  }
  return "variable";
}

function isTopLevelSymbol(category: IsabelleCommandCategory): boolean {
  return category === "theory" || category === "declaration" || category === "statement" || category === "context";
}

function isProofSymbol(category: IsabelleCommandCategory): boolean {
  return category === "proof" || category === "proofTerminal";
}

function mergeRanges(left: ProtocolRange, right: ProtocolRange): ProtocolRange {
  return {
    start: left.start,
    end: positionAfter(left.end, right.end) ? left.end : right.end
  };
}

function positionAfter(left: ProtocolRange["end"], right: ProtocolRange["end"]): boolean {
  return left.line > right.line || (left.line === right.line && left.character >= right.character);
}

interface MutableSymbol extends IsabelleDocumentSymbol {}

function toPublicSymbol(symbol: MutableSymbol): IsabelleDocumentSymbol {
  return {
    ...symbol,
    children: symbol.children.map(toPublicSymbol)
  };
}
