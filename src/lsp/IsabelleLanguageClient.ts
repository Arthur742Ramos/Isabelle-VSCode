import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import * as vscode from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  RevealOutputChannelOn,
  ServerOptions,
  State,
  TransportKind
} from "vscode-languageclient/node";
import { buildLanguageServerCommand } from "./languageServerArgs";
import { IsabelleLanguageServerState, IsabelleLanguageServerStatus } from "./lspTypes";

const REACH_CHECK_TIMEOUT_MS = 10_000;
const REACH_CHECK_KILL_GRACE_MS = 1_000;
const LSP_STOP_TIMEOUT_MS = 5_000;
const MAX_REACH_CHECK_BUFFER = 64 * 1024;

/**
 * Lifecycle owner for Isabelle's bundled `isabelle vscode_server` language
 * server. The client is opt-in: nothing happens until {@link start} is called.
 *
 * Concurrency model:
 *   - `start`, `stop`, and `restart` enqueue onto a single promise chain so
 *     they execute sequentially.
 *   - Each public call bumps a `generation` counter. Queued operations bail
 *     out without touching state if their captured generation is no longer the
 *     latest, so a rapid `enable -> disable -> enable` cycle leaves at most
 *     one live language client.
 *   - `stop` eagerly kills any in-flight reach-check child so the queued
 *     `doStop` runs quickly instead of waiting on the spawned `isabelle
 *     version` call.
 *   - `dispose` is synchronous (best effort); `shutdown` is awaitable and
 *     should be awaited from `deactivate`.
 */
export class IsabelleLanguageClient implements vscode.Disposable {
  private state: IsabelleLanguageServerState = "disabled";
  private commandLine?: string;
  private isabelleVersion?: string;
  private lastError?: string;
  private lastStartedAt?: string;
  private lastStoppedAt?: string;

  private generation = 0;
  private opQueue: Promise<void> = Promise.resolve();
  private disposed = false;

  private currentClient: LanguageClient | undefined;
  private currentClientStateListener: vscode.Disposable | undefined;
  private reachCheckChild: ChildProcessWithoutNullStreams | undefined;

  private readonly lspOutput: vscode.OutputChannel;
  private readonly lspTraceOutput: vscode.OutputChannel;
  private readonly onStatusChangeEmitter = new vscode.EventEmitter<IsabelleLanguageServerStatus>();

  public readonly onStatusChange = this.onStatusChangeEmitter.event;

  public constructor(
    private readonly output: vscode.OutputChannel,
    private readonly getExecutablePath: () => string
  ) {
    this.lspOutput = vscode.window.createOutputChannel("Isabelle Language Server");
    this.lspTraceOutput = vscode.window.createOutputChannel("Isabelle Language Server Trace");
  }

  public getStatus(): IsabelleLanguageServerStatus {
    return {
      state: this.state,
      commandLine: this.commandLine,
      isabelleVersion: this.isabelleVersion,
      lastError: this.lastError,
      lastStartedAt: this.lastStartedAt,
      lastStoppedAt: this.lastStoppedAt
    };
  }

  public start(): Promise<void> {
    if (this.disposed) {
      return Promise.resolve();
    }
    const myGen = ++this.generation;
    return this.enqueue(() => this.doStart(myGen));
  }

  public stop(): Promise<void> {
    const myGen = ++this.generation;
    // Eagerly cancel any in-flight reach-check so a queued doStart bails
    // promptly instead of waiting for the 10 s reach-check timeout.
    this.cancelReachCheck();
    return this.enqueue(() => this.doStop(myGen));
  }

  public restart(): Promise<void> {
    if (this.disposed) {
      return Promise.resolve();
    }
    const stopGen = ++this.generation;
    this.cancelReachCheck();
    return this.enqueue(async () => {
      await this.doStop(stopGen);
      if (this.disposed) {
        return;
      }
      const startGen = ++this.generation;
      await this.doStart(startGen);
    });
  }

  /**
   * Awaitable shutdown. Call from `deactivate` and `await` the result so VS
   * Code does not unload the extension while the language server child is
   * still alive.
   */
  public async shutdown(): Promise<void> {
    this.disposed = true;
    const myGen = ++this.generation;
    this.cancelReachCheck();
    try {
      await this.enqueue(() => this.doStop(myGen));
    } catch (error) {
      this.output.appendLine(
        `Isabelle language server: error during shutdown: ${errorMessage(error)}`
      );
    }
    this.currentClientStateListener?.dispose();
    this.currentClientStateListener = undefined;
    this.onStatusChangeEmitter.dispose();
    this.lspOutput.dispose();
    this.lspTraceOutput.dispose();
  }

  /**
   * Synchronous best-effort dispose. Schedules an async shutdown but does
   * not wait. Prefer {@link shutdown} from `deactivate`.
   */
  public dispose(): void {
    if (this.disposed) {
      return;
    }
    void this.shutdown();
  }

  private enqueue(op: () => Promise<void>): Promise<void> {
    const next = this.opQueue.then(op, op);
    this.opQueue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  private async doStart(myGen: number): Promise<void> {
    if (this.disposed) {
      return;
    }
    // Superseded before we even started running.
    if (myGen !== this.generation) {
      return;
    }
    if (this.state === "running" || this.state === "starting") {
      return;
    }

    this.transition({
      state: "starting",
      lastError: undefined
    });

    const config = vscode.workspace.getConfiguration("isabelle");
    const executablePath = this.getExecutablePath();
    const rawExtraArgs = config.get<unknown>("languageServer.extraArgs", []);
    const extraArgs = Array.isArray(rawExtraArgs)
      ? rawExtraArgs.filter((value): value is string => typeof value === "string")
      : [];
    const logVerbose = config.get<boolean>("languageServer.logVerbose", false);

    const cmd = buildLanguageServerCommand(executablePath, extraArgs);
    this.commandLine = formatCommandLine(cmd.command, cmd.args);

    this.output.appendLine(`Isabelle language server: verifying reachability (${executablePath} version)`);

    let version: string;
    try {
      version = await this.runReachCheck(executablePath);
    } catch (error) {
      if (this.disposed || myGen !== this.generation) {
        // Superseded by a newer operation; let it determine state.
        return;
      }
      const message = errorMessage(error);
      this.output.appendLine(`Isabelle language server: reach-check failed: ${message}`);
      this.transition({
        state: "failed",
        lastError: message,
        lastStoppedAt: nowIso()
      });
      return;
    }

    if (this.disposed || myGen !== this.generation) {
      return;
    }

    this.isabelleVersion = version;
    this.output.appendLine(`Isabelle language server: reachable (${version || "no version line reported"})`);

    let client: LanguageClient | undefined;
    try {
      const serverOptions: ServerOptions = {
        command: cmd.command,
        args: cmd.args,
        transport: TransportKind.stdio
      };

      const clientOptions: LanguageClientOptions = {
        documentSelector: [{ scheme: "file", language: "isabelle" }],
        outputChannel: this.lspOutput,
        revealOutputChannelOn: RevealOutputChannelOn.Never,
        ...(logVerbose ? { traceOutputChannel: this.lspTraceOutput } : {})
      };

      client = new LanguageClient(
        "isabelle.languageServer",
        "Isabelle Language Server",
        serverOptions,
        clientOptions
      );

      this.output.appendLine(`Isabelle language server: starting (${this.commandLine})`);
      await client.start();
    } catch (error) {
      if (client) {
        try {
          await client.stop(LSP_STOP_TIMEOUT_MS);
        } catch {
          // best effort
        }
      }
      if (this.disposed || myGen !== this.generation) {
        return;
      }
      const message = errorMessage(error);
      this.output.appendLine(`Isabelle language server: failed to start: ${message}`);
      this.transition({
        state: "failed",
        lastError: message,
        lastStoppedAt: nowIso()
      });
      return;
    }

    if (this.disposed || myGen !== this.generation) {
      // Superseded mid-start; tear the client down rather than leaving it live.
      try {
        await client.stop(LSP_STOP_TIMEOUT_MS);
      } catch {
        // best effort
      }
      return;
    }

    this.currentClient = client;
    this.attachClientStateListener(client);
    this.output.appendLine("Isabelle language server: running");
    this.transition({
      state: "running",
      lastError: undefined,
      lastStartedAt: nowIso()
    });
  }

  private async doStop(myGen: number): Promise<void> {
    if (this.state === "disabled" && !this.currentClient) {
      return;
    }

    const client = this.currentClient;
    this.currentClient = undefined;
    this.currentClientStateListener?.dispose();
    this.currentClientStateListener = undefined;

    if (client) {
      this.transition({ state: "stopping" });
      this.output.appendLine("Isabelle language server: stopping");
      try {
        await client.stop(LSP_STOP_TIMEOUT_MS);
      } catch (error) {
        this.output.appendLine(
          `Isabelle language server: error while stopping: ${errorMessage(error)}`
        );
      }
    }

    // We deliberately do not bail on (myGen !== this.generation) here: stop
    // is the cleanup leg of a restart, and the next operation in the queue
    // (a doStart) is allowed to transition the state forward.
    void myGen;

    this.isabelleVersion = undefined;
    this.transition({
      state: "disabled",
      lastError: undefined,
      lastStoppedAt: nowIso()
    });
  }

  private attachClientStateListener(client: LanguageClient): void {
    this.currentClientStateListener?.dispose();
    this.currentClientStateListener = client.onDidChangeState((event) => {
      if (this.currentClient !== client) {
        return;
      }
      if (event.newState === State.Stopped && this.state === "running") {
        this.output.appendLine(
          "Isabelle language server: stopped unexpectedly (the child process exited)."
        );
        this.currentClient = undefined;
        this.currentClientStateListener?.dispose();
        this.currentClientStateListener = undefined;
        this.transition({
          state: "failed",
          lastError: "Isabelle language server stopped unexpectedly.",
          lastStoppedAt: nowIso()
        });
      }
    });
  }

  private cancelReachCheck(): void {
    const child = this.reachCheckChild;
    if (!child) {
      return;
    }
    this.reachCheckChild = undefined;
    try {
      child.kill("SIGTERM");
    } catch {
      // best effort
    }
  }

  private runReachCheck(executablePath: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(executablePath, ["version"], {
          stdio: "pipe",
          windowsHide: true
        });
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }

      this.reachCheckChild = child;

      let stdout = "";
      let stderr = "";
      let settled = false;

      const cleanup = (): void => {
        if (this.reachCheckChild === child) {
          this.reachCheckChild = undefined;
        }
        clearTimeout(timeoutHandle);
      };

      const settleOnce = (fn: () => void): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        fn();
      };

      const timeoutHandle = setTimeout(() => {
        settleOnce(() => {
          try {
            child.kill("SIGTERM");
          } catch {
            // best effort
          }
          const killFallback = setTimeout(() => {
            try {
              child.kill("SIGKILL");
            } catch {
              // best effort
            }
          }, REACH_CHECK_KILL_GRACE_MS);
          killFallback.unref?.();
          reject(
            new Error(
              `Timed out after ${REACH_CHECK_TIMEOUT_MS} ms waiting for '${executablePath} version'.`
            )
          );
        });
      }, REACH_CHECK_TIMEOUT_MS);
      timeoutHandle.unref?.();

      child.stdout.on("data", (chunk: Buffer) => {
        if (stdout.length < MAX_REACH_CHECK_BUFFER) {
          stdout += chunk.toString("utf8");
          if (stdout.length > MAX_REACH_CHECK_BUFFER) {
            stdout = stdout.slice(0, MAX_REACH_CHECK_BUFFER);
          }
        }
      });

      child.stderr.on("data", (chunk: Buffer) => {
        if (stderr.length < MAX_REACH_CHECK_BUFFER) {
          stderr += chunk.toString("utf8");
          if (stderr.length > MAX_REACH_CHECK_BUFFER) {
            stderr = stderr.slice(0, MAX_REACH_CHECK_BUFFER);
          }
        }
      });

      child.on("error", (error: NodeJS.ErrnoException) => {
        settleOnce(() => {
          reject(
            new Error(
              `Unable to spawn '${executablePath}': ${error.message}${
                error.code ? ` (${error.code})` : ""
              }`
            )
          );
        });
      });

      child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
        settleOnce(() => {
          if (code === 0) {
            const firstLine = stdout
              .split(/\r?\n/)
              .map((line) => line.trim())
              .find((line) => line.length > 0);
            resolve(firstLine ?? "");
          } else {
            const detail = (stderr.trim() || stdout.trim() || "").slice(0, 512);
            const exitDescription = signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`;
            reject(
              new Error(
                `'${executablePath} version' failed (${exitDescription})${detail ? `: ${detail}` : ""}.`
              )
            );
          }
        });
      });
    });
  }

  private transition(update: Partial<IsabelleLanguageServerStatus> & {
    state: IsabelleLanguageServerState;
  }): void {
    this.state = update.state;
    if ("lastError" in update) {
      this.lastError = update.lastError;
    }
    if ("lastStartedAt" in update) {
      this.lastStartedAt = update.lastStartedAt;
    }
    if ("lastStoppedAt" in update) {
      this.lastStoppedAt = update.lastStoppedAt;
    }
    if ("commandLine" in update) {
      this.commandLine = update.commandLine;
    }
    if ("isabelleVersion" in update) {
      this.isabelleVersion = update.isabelleVersion;
    }
    this.onStatusChangeEmitter.fire(this.getStatus());
  }
}

function formatCommandLine(command: string, args: readonly string[]): string {
  const parts = [command, ...args].map((part) => (/[\s"]/.test(part) ? `"${part.replace(/"/g, '\\"')}"` : part));
  return parts.join(" ").trim();
}

function nowIso(): string {
  return new Date().toISOString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
