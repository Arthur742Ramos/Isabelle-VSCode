import { EventEmitter } from "events";
import { describe, expect, it } from "vitest";
import { BackendClient } from "../../src/backend/BackendClient";
import { BackendTransport } from "../../src/backend/BackendTransport";
import { encodeMessage } from "../../src/protocol/framing";
import { VersionResult } from "../../src/protocol/messages";

class FakeTransport implements BackendTransport {
  public readonly sent: Buffer[] = [];
  private readonly events = new EventEmitter();

  public send(frame: Buffer): void {
    this.sent.push(frame);
  }

  public emitData(message: unknown): void {
    this.events.emit("data", encodeMessage(message));
  }

  public emitRaw(chunk: Buffer): void {
    this.events.emit("data", chunk);
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
    this.events.removeAllListeners();
  }
}

describe("BackendClient", () => {
  it("correlates responses by request id", async () => {
    const transport = new FakeTransport();
    const client = new BackendClient(transport, { requestTimeoutMs: 1000 });

    const result = client.request<VersionResult>("isabelle/version", {
      isabelleExecutablePath: "isabelle"
    });

    transport.emitData({
      jsonrpc: "2.0",
      id: "1",
      result: {
        executablePath: "isabelle",
        version: "Isabelle2025",
        raw: "Isabelle2025"
      }
    });

    await expect(result).resolves.toEqual({
      executablePath: "isabelle",
      version: "Isabelle2025",
      raw: "Isabelle2025"
    });
  });

  it("rejects protocol errors", async () => {
    const transport = new FakeTransport();
    const client = new BackendClient(transport, { requestTimeoutMs: 1000 });
    const result = client.request("isabelle/version");

    transport.emitData({
      jsonrpc: "2.0",
      id: "1",
      error: {
        code: -32000,
        message: "Isabelle not found"
      }
    });

    await expect(result).rejects.toThrow("Isabelle not found");
  });

  it("rejects responses without result or error", async () => {
    const transport = new FakeTransport();
    const client = new BackendClient(transport, { requestTimeoutMs: 1000 });
    const result = client.request("server/health");

    transport.emitData({
      jsonrpc: "2.0",
      id: "1"
    });

    await expect(result).rejects.toThrow("without result or error");
  });

  it("fails pending requests cleanly when a malformed frame arrives", async () => {
    const transport = new FakeTransport();
    const client = new BackendClient(transport, { requestTimeoutMs: 1000 });
    const result = client.request("server/health");

    // A frame whose body is not valid JSON must not throw out of the data
    // listener; it should reject the in-flight request instead of hanging.
    expect(() => transport.emitRaw(Buffer.from("Content-Length: 2\r\n\r\n{x", "ascii"))).not.toThrow();

    await expect(result).rejects.toThrow();
  });
});
