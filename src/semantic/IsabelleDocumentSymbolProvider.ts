import * as vscode from "vscode";
import { DocumentSyncService } from "../document/DocumentSyncService";
import { ProtocolRange } from "../protocol/messages";
import {
  extractIsabelleDocumentSymbols,
  IsabelleDocumentSymbol,
  IsabelleSymbolKind
} from "./documentSymbols";

export class IsabelleDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
  public constructor(private readonly documentSyncService: DocumentSyncService) {}

  public provideDocumentSymbols(document: vscode.TextDocument): vscode.ProviderResult<vscode.DocumentSymbol[]> {
    return extractIsabelleDocumentSymbols(this.documentSyncService.getCommandSpans(document)).map(toVscodeSymbol);
  }
}

function toVscodeSymbol(symbol: IsabelleDocumentSymbol): vscode.DocumentSymbol {
  const documentSymbol = new vscode.DocumentSymbol(
    symbol.name,
    symbol.detail,
    toVscodeSymbolKind(symbol.kind),
    toVscodeRange(symbol.range),
    toVscodeRange(symbol.selectionRange)
  );
  documentSymbol.children = symbol.children.map(toVscodeSymbol);
  return documentSymbol;
}

function toVscodeSymbolKind(kind: IsabelleSymbolKind): vscode.SymbolKind {
  switch (kind) {
    case "module":
      return vscode.SymbolKind.Module;
    case "class":
      return vscode.SymbolKind.Class;
    case "method":
      return vscode.SymbolKind.Method;
    case "function":
      return vscode.SymbolKind.Function;
    case "field":
      return vscode.SymbolKind.Field;
    case "variable":
      return vscode.SymbolKind.Variable;
    case "string":
      return vscode.SymbolKind.String;
    case "namespace":
    default:
      return vscode.SymbolKind.Namespace;
  }
}

function toVscodeRange(range: ProtocolRange): vscode.Range {
  return new vscode.Range(
    range.start.line,
    range.start.character,
    range.end.line,
    range.end.character
  );
}
