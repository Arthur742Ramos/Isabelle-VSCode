import * as vscode from "vscode";
import { IsabelleLanguageClient } from "./IsabelleLanguageClient";
import { IsabelleLanguageServerStatus } from "./lspTypes";

/**
 * Status-bar surface for the optional Isabelle language server. The item
 * lives just to the right of the existing Isabelle session status item
 * (priority 100); a higher priority number renders further left on the
 * left-aligned status bar, so 98 places this one directly to its right.
 *
 * Hidden when the client is disabled to avoid clutter for users who never
 * opt in.
 */
export class LanguageServerStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly subscription: vscode.Disposable;

  public constructor(client: IsabelleLanguageClient) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
    this.item.command = "isabelle.showLanguageServerStatus";
    this.render(client.getStatus());
    this.subscription = client.onStatusChange((status) => this.render(status));
  }

  public dispose(): void {
    this.subscription.dispose();
    this.item.dispose();
  }

  private render(status: IsabelleLanguageServerStatus): void {
    switch (status.state) {
      case "disabled":
        this.item.hide();
        return;
      case "starting":
        this.item.text = "$(loading~spin) Isabelle LSP: starting";
        this.item.tooltip = buildTooltip(status, "Starting Isabelle language server");
        this.item.show();
        return;
      case "running":
        this.item.text = "$(plug) Isabelle LSP: running";
        this.item.tooltip = buildTooltip(status, "Isabelle language server is running");
        this.item.show();
        return;
      case "stopping":
        this.item.text = "$(loading~spin) Isabelle LSP: stopping";
        this.item.tooltip = buildTooltip(status, "Stopping Isabelle language server");
        this.item.show();
        return;
      case "failed":
        this.item.text = "$(error) Isabelle LSP: failed";
        this.item.tooltip = buildTooltip(status, "Isabelle language server failed; click for details");
        this.item.show();
        return;
    }
  }
}

function buildTooltip(status: IsabelleLanguageServerStatus, header: string): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**${header}**\n\n`);
  if (status.commandLine) {
    md.appendMarkdown(`Command: \`${status.commandLine}\`\n\n`);
  }
  if (status.isabelleVersion) {
    md.appendMarkdown(`Isabelle: ${status.isabelleVersion}\n\n`);
  }
  if (status.lastError) {
    md.appendMarkdown(`Last error: ${status.lastError}\n\n`);
  }
  return md;
}
