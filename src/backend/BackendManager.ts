import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { BackendClient } from "./BackendClient";
import { ProcessTransport } from "./ProcessTransport";

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

  const bundledJar = path.join(context.extensionPath, "backend", "target", "scala-2.13", "isabelle-vscode-server.jar");
  if (fs.existsSync(bundledJar)) {
    return {
      command: "java",
      args: ["-jar", bundledJar, ...configuredArgs],
      cwd
    };
  }

  return {
    command: "isabelle-vscode-server",
    args: configuredArgs,
    cwd
  };
}
