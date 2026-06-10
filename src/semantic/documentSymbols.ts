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

export function extractIsabelleDocumentSymbols(spans: CommandSpan[]): IsabelleDocumentSymbol[] {
  const roots: MutableSymbol[] = [];
  let activeParent: MutableSymbol | undefined;

  for (const span of spans) {
    const info = getCommandInfo(span.kind);
    if (!info) {
      continue;
    }

    if (isTopLevelSymbol(info.category)) {
      const symbol = createSymbol(span, info.category);
      if (!symbol) {
        activeParent = undefined;
        continue;
      }
      roots.push(symbol);
      activeParent = info.category === "theory" ? undefined : symbol;
      continue;
    }

    if (activeParent && isProofSymbol(info.category)) {
      const child = createSymbol(span, info.category);
      if (child) {
        activeParent.children.push(child);
        activeParent.range = mergeRanges(activeParent.range, child.range);
      }
    }
  }

  return roots.map(toPublicSymbol);
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
