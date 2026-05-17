import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import * as vscode from "vscode";
import { DiscoveredSession } from "../protocol/messages";
import { createBuildCommand } from "./buildArgs";
import { resolveDiagnosticPath } from "./diagnosticPaths";
import {
  BUILD_DIAGNOSTIC_COLLECTION_NAME,
  BUILD_DIAGNOSTIC_SOURCE,
  BuildDiagnostic,
  parseBuildDiagnostics
} from "./diagnostics";
import { formatBuildSpawnError } from "./spawnErrors";

export interface RunBuildOptions {
  isabelleExecutablePath: string;
  extraArgs: string[];
}

export class BuildService implements vscode.Disposable {
  private readonly diagnostics: vscode.DiagnosticCollection;
  private activeProcess: ChildProcessWithoutNullStreams | undefined;
  private activeSessionName: string | undefined;

  public constructor(private readonly output: vscode.OutputChannel) {
    this.diagnostics = vscode.languages.createDiagnosticCollection(BUILD_DIAGNOSTIC_COLLECTION_NAME);
  }

  public isRunning(): boolean {
    return this.activeProcess !== undefined;
  }

  public async runBuild(session: DiscoveredSession, options: RunBuildOptions): Promise<number> {
    if (this.activeProcess) {
      throw new Error(`Isabelle build already running for ${this.activeSessionName ?? "another session"}.`);
    }

    const rootDirectories = [session.rootDirectory, session.sessionDirectory];
    const command = createBuildCommand({
      isabelleExecutablePath: options.isabelleExecutablePath,
      sessionName: session.name,
      rootDirectories,
      extraArgs: options.extraArgs
    });

    this.output.show(true);
    this.output.appendLine(`> ${command.command} ${command.args.join(" ")}`);
    this.diagnostics.clear();
    this.activeSessionName = session.name;

    return new Promise<number>((resolve, reject) => {
      const child = spawn(command.command, command.args, {
        cwd: session.sessionDirectory,
        stdio: "pipe",
        windowsHide: true
      });

      this.activeProcess = child;
      let outputText = "";

      child.stdout.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        outputText += text;
        this.output.append(text);
      });

      child.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        outputText += text;
        this.output.append(text);
      });

      child.on("error", (error: NodeJS.ErrnoException) => {
        this.clearActiveProcess(child);
        reject(formatBuildSpawnError(error, command.command));
      });

      child.on("close", (code) => {
        this.clearActiveProcess(child);
        this.publishDiagnostics(parseBuildDiagnostics(outputText), session.sessionDirectory);
        resolve(code ?? -1);
      });
    });
  }

  public cancelBuild(): boolean {
    if (!this.activeProcess) {
      return false;
    }

    const process = this.activeProcess;
    this.output.appendLine(`Cancelling Isabelle build for ${this.activeSessionName ?? "active session"}...`);
    const signalled = process.kill();
    if (signalled) {
      const timer = setTimeout(() => {
        if (this.activeProcess === process) {
          process.kill("SIGKILL");
        }
      }, 5000);
      timer.unref();
    }
    return signalled;
  }

  public dispose(): void {
    this.cancelBuild();
    this.diagnostics.dispose();
  }

  private clearActiveProcess(process: ChildProcessWithoutNullStreams): void {
    if (this.activeProcess === process) {
      this.activeProcess = undefined;
      this.activeSessionName = undefined;
    }
  }

  private publishDiagnostics(diagnostics: BuildDiagnostic[], baseDirectory: string): void {
    const byFile = new Map<string, vscode.Diagnostic[]>();

    for (const diagnostic of diagnostics) {
      const range = new vscode.Range(
        diagnostic.startLine,
        diagnostic.startCharacter,
        diagnostic.endLine,
        diagnostic.endCharacter
      );
      const vscodeDiagnostic = new vscode.Diagnostic(
        range,
        diagnostic.message,
        diagnostic.severity === "warning"
          ? vscode.DiagnosticSeverity.Warning
          : vscode.DiagnosticSeverity.Error
      );
      vscodeDiagnostic.source = BUILD_DIAGNOSTIC_SOURCE;

      const filePath = resolveDiagnosticPath(diagnostic.filePath, baseDirectory);
      const existing = byFile.get(filePath) ?? [];
      existing.push(vscodeDiagnostic);
      byFile.set(filePath, existing);
    }

    for (const [filePath, fileDiagnostics] of byFile) {
      this.diagnostics.set(vscode.Uri.file(filePath), fileDiagnostics);
    }
  }
}
