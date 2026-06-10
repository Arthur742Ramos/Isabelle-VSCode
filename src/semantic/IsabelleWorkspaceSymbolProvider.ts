import * as vscode from "vscode";
import { extractCommandSpans } from "../document/commandSpans";
import { extractTheoryEntities } from "./theoryEntities";
import {
  matchWorkspaceSymbols,
  workspaceSymbolKind,
  WorkspaceSymbolEntity,
  WorkspaceSymbolKind
} from "./workspaceSymbols";

/**
 * Offline workspace-symbol provider (Ctrl-T / "Go to Symbol in Workspace").
 *
 * Indexes the named entities — lemmas, definitions, datatypes, type
 * definitions, type classes, locales, … — of every `.thy` file in the workspace
 * and the currently open editors, using the same local extraction the in-file
 * outline uses, and ranks them against the query via the pure
 * {@link matchWorkspaceSymbols}. No prover or language server required.
 *
 * Open documents are read from the editor buffer (so unsaved edits are
 * reflected); the rest are read from disk. A reasonable cap keeps a huge
 * workspace responsive.
 */
export class IsabelleWorkspaceSymbolProvider implements vscode.WorkspaceSymbolProvider {
  private static readonly MAX_FILES = 2000;
  private capWarningEmitted = false;

  public constructor(private readonly output?: vscode.OutputChannel) {}

  public async provideWorkspaceSymbols(
    query: string,
    token: vscode.CancellationToken
  ): Promise<vscode.SymbolInformation[]> {
    const entities = await this.collectEntities(token);
    if (token.isCancellationRequested) {
      return [];
    }
    return matchWorkspaceSymbols(query, entities).map(toSymbolInformation);
  }

  private async collectEntities(token: vscode.CancellationToken): Promise<WorkspaceSymbolEntity[]> {
    const byUri = new Map<string, WorkspaceSymbolEntity[]>();

    // 1. Open theory documents — buffer content, reflects unsaved edits.
    for (const document of vscode.workspace.textDocuments) {
      if (isTheoryDocument(document)) {
        byUri.set(document.uri.toString(), entitiesOf(document.uri.toString(), document.getText()));
      }
    }

    // 2. Workspace `.thy` files not already covered by an open editor.
    const files = await vscode.workspace.findFiles(
      "**/*.thy",
      "**/{node_modules,.git,.vscode-test}/**",
      IsabelleWorkspaceSymbolProvider.MAX_FILES,
      token
    );
    if (files.length === IsabelleWorkspaceSymbolProvider.MAX_FILES && !this.capWarningEmitted) {
      // findFiles truncates at the cap, so results may be incomplete in a very
      // large workspace. Warn once so users understand why a symbol is missing.
      this.capWarningEmitted = true;
      this.output?.appendLine(
        `Isabelle workspace symbols: reached the ${IsabelleWorkspaceSymbolProvider.MAX_FILES}-file scan cap; ` +
          "results may be incomplete in this workspace."
      );
    }
    for (const file of files) {
      if (token.isCancellationRequested) {
        break;
      }
      const uri = file.toString();
      if (byUri.has(uri)) {
        continue;
      }
      try {
        const bytes = await vscode.workspace.fs.readFile(file);
        byUri.set(uri, entitiesOf(uri, Buffer.from(bytes).toString("utf8")));
      } catch {
        // Unreadable file (permissions, deleted between listing and read) — skip.
      }
    }

    return [...byUri.values()].flat();
  }
}

function entitiesOf(uri: string, text: string): WorkspaceSymbolEntity[] {
  return extractTheoryEntities(extractCommandSpans(uri, text, 0)).map((entity) => ({ ...entity, uri }));
}

function toSymbolInformation(entity: WorkspaceSymbolEntity): vscode.SymbolInformation {
  const range = new vscode.Range(
    entity.range.start.line,
    entity.range.start.character,
    entity.range.end.line,
    entity.range.end.character
  );
  return new vscode.SymbolInformation(
    entity.name,
    toVscodeSymbolKind(workspaceSymbolKind(entity.kind)),
    entity.kind,
    new vscode.Location(vscode.Uri.parse(entity.uri), range)
  );
}

function toVscodeSymbolKind(kind: WorkspaceSymbolKind): vscode.SymbolKind {
  switch (kind) {
    case "method":
      return vscode.SymbolKind.Method;
    case "function":
      return vscode.SymbolKind.Function;
    case "enum":
      return vscode.SymbolKind.Enum;
    case "struct":
      return vscode.SymbolKind.Struct;
    case "interface":
      return vscode.SymbolKind.Interface;
    case "class":
      return vscode.SymbolKind.Class;
    case "namespace":
      return vscode.SymbolKind.Namespace;
    case "module":
      return vscode.SymbolKind.Module;
    case "variable":
    default:
      return vscode.SymbolKind.Variable;
  }
}

function isTheoryDocument(document: vscode.TextDocument): boolean {
  return document.languageId === "isabelle" || document.uri.fsPath.endsWith(".thy");
}
