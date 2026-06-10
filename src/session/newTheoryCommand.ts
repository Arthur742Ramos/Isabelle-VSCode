import * as path from "path";
import * as vscode from "vscode";
import {
  buildTheoryFileContent,
  isValidTheoryName,
  sanitizeTheoryName,
  theoryFileName
} from "./newTheory";

/**
 * `Isabelle: New Theory File` — prompt for a theory name, then scaffold a
 * correctly-named `<Name>.thy` (Isabelle requires the theory name to equal the
 * file base name) with a `theory … imports Main begin … end` header, and open
 * it with the cursor in the body.
 */
export async function createNewTheoryFile(output: vscode.OutputChannel): Promise<void> {
  const targetDir = resolveTargetDirectory();
  if (!targetDir) {
    vscode.window.showWarningMessage("Open a folder or an Isabelle theory before creating a new theory file.");
    return;
  }

  const suggestion = sanitizeTheoryName(activeBaseName() ?? "Scratch") ?? "Scratch";
  const name = await vscode.window.showInputBox({
    title: "New Isabelle Theory",
    prompt: "Theory name (it becomes the file name, as Isabelle requires).",
    value: suggestion,
    validateInput: (value) => {
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        return "Enter a theory name.";
      }
      if (!isValidTheoryName(trimmed)) {
        return "A theory name must start with a letter and contain only letters, digits, underscores, or primes.";
      }
      return undefined;
    }
  });
  if (name === undefined) {
    return;
  }

  const theoryName = name.trim();
  const fileUri = vscode.Uri.joinPath(targetDir, theoryFileName(theoryName));

  if (await fileExists(fileUri)) {
    const choice = await vscode.window.showWarningMessage(
      `${theoryFileName(theoryName)} already exists. Open it instead?`,
      "Open Existing",
      "Cancel"
    );
    if (choice === "Open Existing") {
      await openTheory(fileUri);
    }
    return;
  }

  try {
    const content = buildTheoryFileContent({ name: theoryName });
    await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, "utf8"));
    await openTheory(fileUri, content);
    output.appendLine(`Created new theory: ${displayPath(fileUri)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    output.appendLine(`Failed to create theory ${displayPath(fileUri)}: ${message}`);
    vscode.window.showErrorMessage(`Could not create theory file: ${message}`);
  }
}

/** Open the theory and place the cursor on the blank body line (line 3). */
async function openTheory(fileUri: vscode.Uri, content?: string): Promise<void> {
  const document = await vscode.workspace.openTextDocument(fileUri);
  const editor = await vscode.window.showTextDocument(document);
  if (content !== undefined) {
    // The blank line between `begin` and `end` is line index 3 in the template.
    const bodyLine = Math.min(3, document.lineCount - 1);
    const position = new vscode.Position(bodyLine, 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position));
  }
}

function resolveTargetDirectory(): vscode.Uri | undefined {
  const activeUri = vscode.window.activeTextEditor?.document.uri;
  // Use the active document's folder for any real (saved) resource — works for
  // both `file:` and remote schemes (`vscode-remote:` under Remote-SSH/WSL/dev
  // containers). URIs always use POSIX-style `/` separators in `.path`.
  if (activeUri && activeUri.scheme !== "untitled") {
    return activeUri.with({ path: path.posix.dirname(activeUri.path) });
  }
  return vscode.workspace.workspaceFolders?.[0]?.uri;
}

function activeBaseName(): string | undefined {
  const activeUri = vscode.window.activeTextEditor?.document.uri;
  if (!activeUri || activeUri.scheme === "untitled") {
    return undefined;
  }
  const base = path.posix.basename(activeUri.path).replace(/\.thy$/i, "");
  return base.length > 0 ? base : undefined;
}

/** A human-readable path for logs: filesystem path for `file:`, URI otherwise. */
function displayPath(uri: vscode.Uri): string {
  return uri.scheme === "file" ? uri.fsPath : uri.toString();
}

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}
