import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { BackendManager } from "../backend/BackendManager";
import { ProofStateParams, ProofStateResult } from "../protocol/messages";
import { buildRepairRequestMarkdown, RepairDiagnosticSnapshot } from "./repairRequest";
import { RepairPreviewProvider } from "./RepairPreviewProvider";
import { applyUnifiedDiffPatch, parseUnifiedDiff, RepairPatchError } from "./unifiedDiff";

export class RepairService {
  public constructor(
    private readonly backendManager: BackendManager,
    private readonly output: vscode.OutputChannel,
    private readonly previewProvider: RepairPreviewProvider
  ) {}

  public async createRepairRequest(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isTheoryDocument(editor.document)) {
      vscode.window.showWarningMessage("Open an Isabelle theory before creating a checked repair request.");
      return;
    }

    const proofState = await this.captureProofState(editor);
    const markdown = buildRepairRequestMarkdown({
      capturedAt: new Date().toISOString(),
      documentUri: editor.document.uri.toString(),
      documentPath: editor.document.uri.fsPath,
      documentVersion: editor.document.version,
      cursor: {
        line: editor.selection.active.line,
        character: editor.selection.active.character
      },
      diagnostics: vscode.languages.getDiagnostics(editor.document.uri).map(toRepairDiagnostic),
      proofState
    });

    const document = await vscode.workspace.openTextDocument({
      content: markdown,
      language: "markdown"
    });
    await vscode.window.showTextDocument(document, { preview: false });
    vscode.window.showInformationMessage("Created a local checked repair request. No external AI service was called.");
  }

  public async previewRepairPatch(): Promise<void> {
    try {
      const workspaceFolder = this.getPreviewWorkspaceFolder();
      if (!workspaceFolder) {
        vscode.window.showWarningMessage("Open a workspace folder before previewing a repair patch.");
        return;
      }

      const patchUris = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: {
          "Patch files": ["patch", "diff"],
          "All files": ["*"]
        },
        openLabel: "Preview Repair Patch"
      });
      if (!patchUris || patchUris.length === 0) {
        return;
      }

      const patchText = Buffer.from(await vscode.workspace.fs.readFile(patchUris[0])).toString("utf8");
      const patches = parseUnifiedDiff(patchText);
      const workspaceRealPath = await fs.promises.realpath(workspaceFolder.uri.fsPath);

      for (const patch of patches) {
        const targetUri = await this.resolvePatchTarget(workspaceFolder, workspaceRealPath, patch.relativePath);
        this.rejectDirtyDocument(targetUri);
        const originalText = Buffer.from(await vscode.workspace.fs.readFile(targetUri)).toString("utf8");
        const proposedText = applyUnifiedDiffPatch(patch, originalText);
        const previewUri = this.previewProvider.createPreviewUri(targetUri, proposedText);
        await vscode.commands.executeCommand(
          "vscode.diff",
          targetUri,
          previewUri,
          `Repair preview: ${patch.relativePath}`,
          { preview: false }
        );
      }

      vscode.window.showInformationMessage(
        `Opened readonly repair preview for ${patches.length} file(s). No edits were applied.`
      );
    } catch (error) {
      this.showRepairError("Unable to preview repair patch", error);
    }
  }

  public async checkCurrentWorkspaceForRepair(): Promise<void> {
    vscode.window.showInformationMessage(
      "Checking current workspace contents. Repair previews are readonly and are not applied automatically."
    );
    await vscode.commands.executeCommand("isabelle.buildActiveSession");
  }

  private async captureProofState(editor: vscode.TextEditor): Promise<ProofStateResult> {
    try {
      return await this.backendManager.getClient().request<ProofStateResult, ProofStateParams>(
        "proofState/get",
        {
          uri: editor.document.uri.toString(),
          version: editor.document.version,
          position: {
            line: editor.selection.active.line,
            character: editor.selection.active.character
          }
        }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.output.appendLine(`Checked repair proof-state capture failed: ${message}`);
      vscode.window.showWarningMessage("Proof state was unavailable; the repair request includes the error.");
      return {
        uri: editor.document.uri.toString(),
        version: editor.document.version,
        status: "unavailable",
        context: [],
        goals: [],
        raw: "",
        message
      };
    }
  }

  private getPreviewWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
      if (folder) {
        return folder;
      }
    }

    const folders = vscode.workspace.workspaceFolders;
    return folders && folders.length === 1 ? folders[0] : undefined;
  }

  private async resolvePatchTarget(
    workspaceFolder: vscode.WorkspaceFolder,
    workspaceRealPath: string,
    relativePath: string
  ): Promise<vscode.Uri> {
    const targetPath = path.resolve(workspaceFolder.uri.fsPath, ...relativePath.split("/"));
    const targetRealPath = await fs.promises.realpath(targetPath);
    const targetStat = await fs.promises.stat(targetRealPath);
    if (!targetStat.isFile()) {
      throw new RepairPatchError(`Patch target is not a file: ${relativePath}`);
    }

    const relativeToWorkspace = path.relative(workspaceRealPath, targetRealPath);
    if (relativeToWorkspace.startsWith("..") || path.isAbsolute(relativeToWorkspace)) {
      throw new RepairPatchError(`Patch target is outside the workspace: ${relativePath}`);
    }

    return vscode.Uri.file(targetRealPath);
  }

  private rejectDirtyDocument(targetUri: vscode.Uri): void {
    const dirtyDocument = vscode.workspace.textDocuments.find(
      (document) => document.isDirty && document.uri.scheme === "file" && sameFilePath(document.uri.fsPath, targetUri.fsPath)
    );
    if (dirtyDocument) {
      throw new RepairPatchError(`Save or discard unsaved changes before previewing ${targetUri.fsPath}.`);
    }
  }

  private showRepairError(prefix: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.output.appendLine(`${prefix}: ${message}`);
    this.output.show(true);
    vscode.window.showErrorMessage(`${prefix}: ${message}`);
  }
}

function toRepairDiagnostic(diagnostic: vscode.Diagnostic): RepairDiagnosticSnapshot {
  return {
    severity: diagnosticSeverityName(diagnostic.severity),
    source: diagnostic.source,
    message: diagnostic.message,
    range: {
      startLine: diagnostic.range.start.line,
      startCharacter: diagnostic.range.start.character,
      endLine: diagnostic.range.end.line,
      endCharacter: diagnostic.range.end.character
    }
  };
}

function diagnosticSeverityName(severity: vscode.DiagnosticSeverity): RepairDiagnosticSnapshot["severity"] {
  switch (severity) {
    case vscode.DiagnosticSeverity.Warning:
      return "warning";
    case vscode.DiagnosticSeverity.Information:
      return "information";
    case vscode.DiagnosticSeverity.Hint:
      return "hint";
    case vscode.DiagnosticSeverity.Error:
    default:
      return "error";
  }
}

function isTheoryDocument(document: vscode.TextDocument): boolean {
  return document.languageId === "isabelle" || document.uri.fsPath.endsWith(".thy");
}

function sameFilePath(left: string, right: string): boolean {
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}
