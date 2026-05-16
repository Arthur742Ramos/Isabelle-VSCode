import * as vscode from "vscode";
import { DocumentSyncService } from "../document/DocumentSyncService";
import { ProtocolRange } from "../protocol/messages";
import { findDeclarationByName, wordAt } from "./definitions";

export class IsabelleDefinitionProvider implements vscode.DefinitionProvider {
  public constructor(private readonly documentSyncService: DocumentSyncService) {}

  public provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.ProviderResult<vscode.Definition> {
    const line = document.lineAt(position.line).text;
    const word = wordAt(line, position.character);
    if (!word) {
      return undefined;
    }

    const declaration = findDeclarationByName(
      word.word,
      this.documentSyncService.getCommandSpans(document),
      { line: position.line, character: position.character }
    );
    if (!declaration) {
      return undefined;
    }

    return new vscode.Location(document.uri, toVscodeRange(declaration.span.range));
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
