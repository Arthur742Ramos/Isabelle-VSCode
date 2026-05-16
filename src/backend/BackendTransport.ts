export interface BackendTransport {
  send(frame: Buffer): void;
  onData(listener: (chunk: Buffer) => void): () => void;
  onError(listener: (error: Error) => void): () => void;
  onClose(listener: (code: number | null, signal: NodeJS.Signals | null) => void): () => void;
  dispose(): void;
}
