const HEADER_SEPARATOR = Buffer.from("\r\n\r\n", "ascii");
const CONTENT_LENGTH = /^Content-Length:\s*(\d+)$/i;

export class ProtocolFrameError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ProtocolFrameError";
  }
}

export function encodeMessage(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii");
  return Buffer.concat([header, body]);
}

export class ContentLengthMessageReader {
  private buffer = Buffer.alloc(0);

  /**
   * Discard any buffered bytes. Used after an unrecoverable frame error so the
   * desynchronized stream prefix is dropped instead of being re-parsed (and
   * re-thrown) on every subsequent chunk, which would also grow the buffer
   * without bound.
   */
  public reset(): void {
    this.buffer = Buffer.alloc(0);
  }

  public push(chunk: Buffer): unknown[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const messages: unknown[] = [];

    while (true) {
      const headerEnd = this.buffer.indexOf(HEADER_SEPARATOR);
      if (headerEnd === -1) {
        break;
      }

      const headerText = this.buffer.subarray(0, headerEnd).toString("ascii");
      const contentLength = parseContentLength(headerText);
      const bodyStart = headerEnd + HEADER_SEPARATOR.length;
      const frameEnd = bodyStart + contentLength;

      if (this.buffer.length < frameEnd) {
        break;
      }

      const body = this.buffer.subarray(bodyStart, frameEnd).toString("utf8");
      messages.push(JSON.parse(body) as unknown);
      this.buffer = this.buffer.subarray(frameEnd);
    }

    return messages;
  }
}

function parseContentLength(headerText: string): number {
  for (const line of headerText.split(/\r\n/)) {
    const match = CONTENT_LENGTH.exec(line.trim());
    if (match) {
      return Number(match[1]);
    }
  }

  throw new ProtocolFrameError("Protocol frame is missing a Content-Length header.");
}
