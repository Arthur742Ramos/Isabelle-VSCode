import { describe, expect, it } from "vitest";
import { ContentLengthMessageReader, encodeMessage } from "../../src/protocol/framing";

describe("ContentLengthMessageReader", () => {
  it("decodes messages that contain newlines", () => {
    const reader = new ContentLengthMessageReader();
    const frame = encodeMessage({ id: "1", result: "line 1\nline 2" });

    expect(reader.push(frame)).toEqual([{ id: "1", result: "line 1\nline 2" }]);
  });

  it("decodes fragmented frames", () => {
    const reader = new ContentLengthMessageReader();
    const frame = encodeMessage({ id: "2", result: { ok: true } });

    expect(reader.push(frame.subarray(0, 8))).toEqual([]);
    expect(reader.push(frame.subarray(8))).toEqual([{ id: "2", result: { ok: true } }]);
  });

  it("decodes multiple frames from one chunk", () => {
    const reader = new ContentLengthMessageReader();
    const combined = Buffer.concat([
      encodeMessage({ id: "1", result: 1 }),
      encodeMessage({ id: "2", result: 2 })
    ]);

    expect(reader.push(combined)).toEqual([
      { id: "1", result: 1 },
      { id: "2", result: 2 }
    ]);
  });

  it("reset() drops a desynchronized buffer so later valid frames still parse", () => {
    const reader = new ContentLengthMessageReader();

    // A corrupt frame body throws and leaves the bytes buffered.
    expect(() => reader.push(Buffer.from("Content-Length: 2\r\n\r\n{x", "ascii"))).toThrow();
    reader.reset();

    // After reset, a fresh valid frame parses cleanly (no leftover corruption).
    expect(reader.push(encodeMessage({ id: "9", result: "ok" }))).toEqual([{ id: "9", result: "ok" }]);
  });
});
