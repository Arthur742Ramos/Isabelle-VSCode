import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { BackendManager } from "../backend/BackendManager";
import { ProofStateParams, ProofStateResult } from "../protocol/messages";
import {
  RepairAiProviderRegistry,
  RepairAiRequest,
  runRepairAi
} from "./repairAiProvider";
import { buildRepairRequestMarkdown, RepairDiagnosticSnapshot, RepairRequestSnapshot } from "./repairRequest";
import { RepairPreviewProvider } from "./RepairPreviewProvider";
import { applyUnifiedDiffPatch, parseUnifiedDiff, RepairPatchError } from "./unifiedDiff";
import {
  buildRepairVerificationPlanMarkdown,
  RepairVerificationContext,
  RepairVerificationPatchSummary
} from "./verificationPlan";

export type RepairVerificationContextProvider = () => Promise<RepairVerificationContext | undefined>;

export class RepairService {
  public constructor(
    private readonly backendManager: BackendManager,
    private readonly output: vscode.OutputChannel,
    private readonly previewProvider: RepairPreviewProvider,
    private readonly createVerificationContext?: RepairVerificationContextProvider,
    private readonly aiProviderRegistry?: RepairAiProviderRegistry
  ) {}

  public async createRepairRequest(): Promise<void> {
    const captured = await this.captureRepairRequest();
    if (!captured) {
      return;
    }
    const document = await vscode.workspace.openTextDocument({
      content: captured.markdown,
      language: "markdown"
    });
    await vscode.window.showTextDocument(document, { preview: false });
    vscode.window.showInformationMessage("Created a local checked repair request. No external AI service was called.");
  }

  /**
   * Copy the same checked-repair-request markdown bundle to the user's
   * clipboard so they can paste it into any AI tool they trust. Strictly
   * local — no provider is involved.
   */
  public async copyRepairRequestToClipboard(): Promise<void> {
    const captured = await this.captureRepairRequest();
    if (!captured) {
      return;
    }
    await vscode.env.clipboard.writeText(captured.markdown);
    vscode.window.showInformationMessage(
      "Copied the checked repair request to the clipboard. No external service was called."
    );
  }

  /**
   * Delegate the captured repair request to the user-configured AI
   * provider, then route the returned unified diff through the
   * existing version-validated preview command. Guarded by the
   * acknowledged-sharing policy gate in `repairAiSettings.ts`.
   *
   * Refuses cleanly with a descriptive warning if no provider is
   * configured, the user has not acknowledged the sharing policy,
   * or the registry has no provider matching the configured id.
   */
  public async requestAiRepairSuggestion(): Promise<void> {
    if (!this.aiProviderRegistry) {
      vscode.window.showWarningMessage(
        "AI repair seam is not wired into this build of the extension."
      );
      return;
    }
    const captured = await this.captureRepairRequest();
    if (!captured) {
      return;
    }
    const result = await runRepairAi(
      this.aiProviderRegistry,
      vscode.workspace.getConfiguration("isabelle"),
      {
        requestMarkdown: captured.markdown,
        documentUri: captured.snapshot.documentUri,
        documentVersion: captured.snapshot.documentVersion,
        capturedAt: captured.snapshot.capturedAt
      },
      {
        authorizeRequest: ({ providerDisplayName, request }) =>
          this.confirmAiRepairRequest(providerDisplayName, request)
      }
    );
    if (!result.ok) {
      this.output.appendLine(`AI repair refused: ${result.reason}`);
      vscode.window.showWarningMessage(`AI repair refused: ${result.reason}`);
      return;
    }

    // Write the proposed patch into a temp file so the existing
    // `previewRepairPatch` command can validate + open it. The user
    // still has to confirm via the standard preview workflow before
    // any edit is applied — there is no auto-apply path.
    try {
      const tmpDir = await fs.promises.mkdtemp(path.join(require("os").tmpdir(), "isabelle-ai-repair-"));
      const patchPath = path.join(tmpDir, "proposed.patch");
      await fs.promises.writeFile(patchPath, result.patchText, "utf8");
      this.output.appendLine(`AI repair: provider returned a patch (${result.patchText.length} bytes); saved to ${patchPath}.`);
      const patchUri = vscode.Uri.file(patchPath);
      const document = await vscode.workspace.openTextDocument(patchUri);
      await vscode.window.showTextDocument(document, { preview: false });
      vscode.window.showInformationMessage(
        "AI repair provider returned a patch. Review it, then run `Isabelle: Preview Repair Patch` to validate and preview before applying."
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.output.appendLine(`AI repair: failed to stage patch: ${message}`);
      vscode.window.showErrorMessage(`AI repair: failed to stage patch: ${message}`);
    }
  }

  private async confirmAiRepairRequest(
    providerDisplayName: string,
    request: RepairAiRequest
  ): Promise<boolean> {
    const reviewAction = "Review Request";
    const sendAction = "Send Request";
    const cancelAction = "Cancel";
    const firstChoice = await vscode.window.showWarningMessage(
      `AI repair provider "${providerDisplayName}" will receive the full checked-repair request (${request.requestMarkdown.length} bytes). Review it before sending.`,
      { modal: true },
      reviewAction,
      cancelAction
    );
    if (firstChoice !== reviewAction) {
      return false;
    }

    const document = await vscode.workspace.openTextDocument(
      this.createAiRepairReviewUri(request)
    );
    await vscode.window.showTextDocument(document, { preview: false });

    const finalChoice = await vscode.window.showWarningMessage(
      `Send the reviewed checked-repair request to "${providerDisplayName}" now?`,
      { modal: true },
      sendAction,
      cancelAction
    );
    return finalChoice === sendAction;
  }

  private createAiRepairReviewUri(request: RepairAiRequest): vscode.Uri {
    const targetUri = vscode.Uri.parse(request.documentUri);
    const reviewTargetUri = targetUri.with({
      path: `${targetUri.path}.checked-repair-request.md`
    });
    return this.previewProvider.createPreviewUri(reviewTargetUri, request.requestMarkdown);
  }

  private async captureRepairRequest(): Promise<{ snapshot: RepairRequestSnapshot; markdown: string } | undefined> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isTheoryDocument(editor.document)) {
      vscode.window.showWarningMessage("Open an Isabelle theory before creating a checked repair request.");
      return undefined;
    }
    const proofState = await this.captureProofState(editor);
    const snapshot: RepairRequestSnapshot = {
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
    };
    return {
      snapshot,
      markdown: buildRepairRequestMarkdown(snapshot)
    };
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
      const patchSummaries: RepairVerificationPatchSummary[] = patches.map((patch) => ({
        relativePath: patch.relativePath,
        hunkCount: patch.hunks.length
      }));
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

      await this.openVerificationPlan(workspaceFolder, patchUris[0], patchSummaries);

      vscode.window.showInformationMessage(
        `Opened readonly repair preview and verification plan for ${patches.length} file(s). No edits were applied.`
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

  private async openVerificationPlan(
    workspaceFolder: vscode.WorkspaceFolder,
    patchUri: vscode.Uri,
    patches: RepairVerificationPatchSummary[]
  ): Promise<void> {
    const verification = this.createVerificationContext
      ? await this.createVerificationContext()
      : undefined;
    const markdown = buildRepairVerificationPlanMarkdown({
      capturedAt: new Date().toISOString(),
      workspaceFolder: workspaceFolder.uri.fsPath,
      patchPath: patchUri.fsPath,
      patches,
      verification
    });

    const document = await vscode.workspace.openTextDocument({
      content: markdown,
      language: "markdown"
    });
    await vscode.window.showTextDocument(document, { preview: false, viewColumn: vscode.ViewColumn.Beside });
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
