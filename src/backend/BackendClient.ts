import { ContentLengthMessageReader, encodeMessage } from "../protocol/framing";
import {
  createRequest,
  isProtocolResponse,
  ProtocolRequestError,
  ServerMethod
} from "../protocol/messages";
import { BackendTransport } from "./BackendTransport";

interface PendingRequest<TResult> {
  resolve: (value: TResult) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

export interface BackendClientOptions {
  requestTimeoutMs: number;
}

export class BackendClient {
  private readonly reader = new ContentLengthMessageReader();
  private readonly pending = new Map<string, PendingRequest<unknown>>();
  private readonly disposables: Array<() => void> = [];
  private nextId = 1;
  private disposed = false;

  public constructor(
    private readonly transport: BackendTransport,
    private readonly options: BackendClientOptions
  ) {
    this.disposables.push(
      transport.onData((chunk) => this.handleData(chunk)),
      transport.onError((error) => this.rejectAll(error)),
      transport.onClose((code, signal) => {
        const detail = signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`;
        this.rejectAll(new Error(`Isabelle backend closed with ${detail}.`));
      })
    );
  }

  public request<TResult, TParams = unknown>(
    method: ServerMethod,
    params?: TParams
  ): Promise<TResult> {
    if (this.disposed) {
      return Promise.reject(new Error("Isabelle backend client has been disposed."));
    }

    const id = String(this.nextId++);
    const request = createRequest(id, method, params);

    return new Promise<TResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${method} response from Isabelle backend.`));
      }, this.options.requestTimeoutMs);

      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer
      });

      try {
        this.transport.send(encodeMessage(request));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    for (const dispose of this.disposables.splice(0)) {
      dispose();
    }
    this.rejectAll(new Error("Isabelle backend client disposed."));
    this.transport.dispose();
  }

  private handleData(chunk: Buffer): void {
    for (const message of this.reader.push(chunk)) {
      if (!isProtocolResponse(message)) {
        this.rejectAll(new Error("Received malformed response from Isabelle backend."));
        return;
      }

      const pending = this.pending.get(message.id);
      if (!pending) {
        continue;
      }

      clearTimeout(pending.timer);
      this.pending.delete(message.id);

      if (message.error) {
        pending.reject(new ProtocolRequestError(message.error));
      } else if (message.result !== undefined) {
        pending.resolve(message.result);
      } else {
        pending.reject(new Error("Received malformed response without result or error from Isabelle backend."));
      }
    }
  }

  private rejectAll(error: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
