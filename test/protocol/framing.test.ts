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
});
