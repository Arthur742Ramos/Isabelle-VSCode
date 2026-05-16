import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import { EventEmitter } from "events";
import { BackendTransport } from "./BackendTransport";

export interface ProcessTransportOptions {
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export class ProcessTransport implements BackendTransport {
  private readonly process: ChildProcessWithoutNullStreams;
  private readonly events = new EventEmitter();

  public constructor(options: ProcessTransportOptions) {
    this.process = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: "pipe",
      windowsHide: true
    });

    this.process.stdout.on("data", (chunk: Buffer) => this.events.emit("data", chunk));
    this.process.stderr.on("data", (chunk: Buffer) => this.events.emit("stderr", chunk));
    this.process.on("error", (error) => this.events.emit("error", error));
    this.process.on("close", (code, signal) => this.events.emit("close", code, signal));
  }

  public onStderr(listener: (chunk: Buffer) => void): () => void {
    this.events.on("stderr", listener);
    return () => this.events.off("stderr", listener);
  }

  public send(frame: Buffer): void {
    this.process.stdin.write(frame);
  }

  public onData(listener: (chunk: Buffer) => void): () => void {
    this.events.on("data", listener);
    return () => this.events.off("data", listener);
  }

  public onError(listener: (error: Error) => void): () => void {
    this.events.on("error", listener);
    return () => this.events.off("error", listener);
  }

  public onClose(listener: (code: number | null, signal: NodeJS.Signals | null) => void): () => void {
    this.events.on("close", listener);
    return () => this.events.off("close", listener);
  }

  public dispose(): void {
    if (!this.process.killed) {
      this.process.kill();
    }
    this.events.removeAllListeners();
  }
}
