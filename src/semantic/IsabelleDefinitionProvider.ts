import * as vscode from "vscode";
import { TextDecoder } from "util";
import { DocumentSyncService } from "../document/DocumentSyncService";
import { extractCommandSpans } from "../document/commandSpans";
import { ProtocolRange } from "../protocol/messages";
import { SessionService } from "../session/SessionService";
import { extractImportLinks } from "./documentLinks";
import {
  DefinitionLookupDocument,
  DefinitionLookupResult,
  findDeclarationByName,
  findDefinitionByName,
  hasDeclarationByName,
  wordAt
} from "./definitions";

const textDecoder = new TextDecoder("utf-8");

export class IsabelleDefinitionProvider implements vscode.DefinitionProvider {
  public constructor(
    private readonly documentSyncService: DocumentSyncService,
    private readonly sessionService: SessionService,
    private readonly output: vscode.OutputChannel
  ) {}

  public async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.Definition | undefined> {
    const line = document.lineAt(position.line).text;
    const word = wordAt(line, position.character);
    if (!word) {
      return undefined;
    }

    const sourceSpans = this.documentSyncService.getCommandSpans(document);
    const declaration = findDeclarationByName(
      word.word,
      sourceSpans,
      { line: position.line, character: position.character }
    );
    if (declaration) {
      return new vscode.Location(document.uri, toVscodeRange(declaration.span.range));
    }

    if (hasDeclarationByName(word.word, sourceSpans) || token.isCancellationRequested) {
      return undefined;
    }

    const source: DefinitionLookupDocument = {
      uri: document.uri.toString(),
      spans: sourceSpans,
      position: { line: position.line, character: position.character }
    };
    const importedDocuments = await this.readImportedDefinitions(document, token);
    if (token.isCancellationRequested) {
      return undefined;
    }

    const importedDeclaration = findDefinitionByName(word.word, source, importedDocuments);
    return importedDeclaration ? toLocation(importedDeclaration) : undefined;
  }

  private async readImportedDefinitions(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): Promise<DefinitionLookupDocument[]> {
    const imports = uniqueImportTargetPaths(
      extractImportLinks(document.getText(), document.uri.fsPath, this.sessionService.getSessions())
    );
    const documents: DefinitionLookupDocument[] = [];

    for (const targetPath of imports) {
      if (token.isCancellationRequested) {
        return documents;
      }

      const uri = vscode.Uri.file(targetPath);
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        if (token.isCancellationRequested) {
          return documents;
        }
        const text = textDecoder.decode(bytes);
        documents.push({
          uri: uri.toString(),
          spans: extractCommandSpans(uri.toString(), text, 0)
        });
      } catch (error) {
        this.output.appendLine(`Definition lookup skipped imported theory ${uri.fsPath}: ${formatError(error)}`);
      }
    }

    return documents;
  }
}

function toLocation(declaration: DefinitionLookupResult): vscode.Location {
  return new vscode.Location(vscode.Uri.parse(declaration.uri), toVscodeRange(declaration.span.range));
}

function toVscodeRange(range: ProtocolRange): vscode.Range {
  return new vscode.Range(
    range.start.line,
    range.start.character,
    range.end.line,
    range.end.character
  );
}

function uniqueImportTargetPaths(imports: Array<{ targetPath: string }>): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();

  for (const imported of imports) {
    const key = process.platform === "win32" ? imported.targetPath.toLowerCase() : imported.targetPath;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    paths.push(imported.targetPath);
  }

  return paths;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
