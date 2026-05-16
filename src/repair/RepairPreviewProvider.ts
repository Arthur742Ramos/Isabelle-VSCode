import { createHash } from "crypto";
import * as vscode from "vscode";

export const REPAIR_PREVIEW_SCHEME = "isabelle-repair-preview";

export class RepairPreviewProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly contents = new Map<string, string>();

  public provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) ?? "Repair preview content is no longer available.";
  }

  public createPreviewUri(targetUri: vscode.Uri, content: string): vscode.Uri {
    const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);
    const previewUri = vscode.Uri.from({
      scheme: REPAIR_PREVIEW_SCHEME,
      path: targetUri.path,
      query: hash
    });
    this.contents.set(previewUri.toString(), content);
    return previewUri;
  }

  public dispose(): void {
    this.contents.clear();
  }
}
