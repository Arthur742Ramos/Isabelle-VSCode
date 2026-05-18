import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { BackendClient } from "./BackendClient";
import { ProcessTransport } from "./ProcessTransport";
import { JavaResolveDeps, resolveJavaCommand } from "./resolveJavaCommand";

export class BackendManager implements vscode.Disposable {
  private client: BackendClient | undefined;

  public constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel
  ) {}

  public getClient(): BackendClient {
    if (this.client) {
      return this.client;
    }

    const config = vscode.workspace.getConfiguration("isabelle");
    const launch = resolveBackendLaunch(this.context, config);
    this.output.appendLine(`Starting Isabelle backend: ${launch.command} ${launch.args.join(" ")}`.trim());

    const transport = new ProcessTransport(launch);
    transport.onStderr((chunk) => this.output.append(chunk.toString("utf8")));

    this.client = new BackendClient(transport, {
      requestTimeoutMs: config.get<number>("backend.requestTimeoutMs", 10000)
    });

    return this.client;
  }

  public dispose(): void {
    this.client?.dispose();
    this.client = undefined;
  }
}

interface BackendLaunch {
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Filesystem facade used by {@link resolveJavaCommand} from the production
 * backend-launch path. Exported for tests and for the activation-time
 * prereq probe that wants identical semantics. On Windows we treat a
 * regular file as executable (Windows uses extension-based execution);
 * on POSIX targets we additionally require the `X_OK` access bit.
 */
export const backendJavaResolveDeps: JavaResolveDeps = {
  isExecutableFile(candidate: string): boolean {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(candidate);
    } catch {
      return false;
    }
    if (!stat.isFile()) {
      return false;
    }
    if (process.platform === "win32") {
      return true;
    }
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }
};

function resolveBackendLaunch(
  context: vscode.ExtensionContext,
  config: vscode.WorkspaceConfiguration
): BackendLaunch {
  const configuredCommand = config.get<string>("backend.command", "").trim();
  const configuredArgs = config.get<string[]>("backend.args", []);
  const configuredCwd = config.get<string>("backend.cwd", "").trim();
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const cwd = configuredCwd || workspaceFolder || context.extensionPath;

  if (configuredCommand.length > 0) {
    return {
      command: configuredCommand,
      args: configuredArgs,
      cwd
    };
  }

  const envCommand = process.env.ISABELLE_VSCODE_SERVER;
  if (envCommand && envCommand.trim().length > 0) {
    return {
      command: envCommand,
      args: configuredArgs,
      cwd
    };
  }

  const javaCommand = resolveJavaCommand(context.extensionPath, process.platform, backendJavaResolveDeps);

  const bundledJar = path.join(context.extensionPath, "backend", "dist", "isabelle-vscode-server.jar");
  if (fs.existsSync(bundledJar)) {
    return {
      command: javaCommand,
      args: ["-jar", bundledJar, ...configuredArgs],
      cwd
    };
  }

  const developmentJar = path.join(context.extensionPath, "backend", "target", "scala-2.13", "isabelle-vscode-server.jar");
  if (fs.existsSync(developmentJar)) {
    return {
      command: javaCommand,
      args: ["-jar", developmentJar, ...configuredArgs],
      cwd
    };
  }

  return {
    command: "isabelle-vscode-server",
    args: configuredArgs,
    cwd
  };
}
