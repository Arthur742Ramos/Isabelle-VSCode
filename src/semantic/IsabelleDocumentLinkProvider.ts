import * as vscode from "vscode";
import { SessionService } from "../session/SessionService";
import { extractImportLinks } from "./documentLinks";

export class IsabelleDocumentLinkProvider implements vscode.DocumentLinkProvider {
  public constructor(private readonly sessionService: SessionService) {}

  public provideDocumentLinks(document: vscode.TextDocument): vscode.ProviderResult<vscode.DocumentLink[]> {
    return extractImportLinks(document.getText(), document.uri.fsPath, this.sessionService.getSessions())
      .map((link) => new vscode.DocumentLink(
        new vscode.Range(
          link.range.start.line,
          link.range.start.character,
          link.range.end.line,
          link.range.end.character
        ),
        vscode.Uri.file(link.targetPath)
      ));
  }
}
