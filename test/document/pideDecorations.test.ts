import { describe, expect, it } from "vitest";
import {
  groupDecorationEntriesByKnownType,
  knownPideDecorationTypes,
  parsePideDecorationPayload,
  planDecorationRequests,
  resolvePideDecorationStyle
} from "../../src/document/pideDecorations";

describe("parsePideDecorationPayload", () => {
  it("parses a well-formed payload with one entry and one range", () => {
    const parsed = parsePideDecorationPayload({
      uri: "file:///abs/path/Foo.thy",
      entries: [
        {
          type: "text_keyword1",
          content: [{ range: [0, 0, 0, 6] }]
        }
      ]
    });
    expect(parsed).toBeDefined();
    expect(parsed?.uri).toBe("file:///abs/path/Foo.thy");
    expect(parsed?.entries).toHaveLength(1);
    expect(parsed?.entries[0].type).toBe("text_keyword1");
    expect(parsed?.entries[0].content).toHaveLength(1);
    expect(parsed?.entries[0].content[0].range).toEqual({
      start: { line: 0, character: 0 },
      end: { line: 0, character: 6 }
    });
    expect(parsed?.entries[0].content[0].hoverMessages).toEqual([]);
  });

  it("rejects payloads with non-string uri", () => {
    expect(parsePideDecorationPayload({ uri: 42, entries: [] })).toBeUndefined();
  });

  it("rejects payloads with empty uri", () => {
    expect(parsePideDecorationPayload({ uri: "", entries: [] })).toBeUndefined();
  });

  it("rejects payloads where entries is not an array", () => {
    expect(parsePideDecorationPayload({ uri: "file:///a", entries: "nope" })).toBeUndefined();
  });

  it("rejects non-object payloads", () => {
    expect(parsePideDecorationPayload(null)).toBeUndefined();
    expect(parsePideDecorationPayload("string")).toBeUndefined();
    expect(parsePideDecorationPayload(42)).toBeUndefined();
  });

  it("drops malformed entries but keeps well-formed ones", () => {
    const parsed = parsePideDecorationPayload({
      uri: "file:///a",
      entries: [
        { type: "", content: [] }, // empty type
        { type: "text_main" }, // missing content
        { type: "text_main", content: "nope" }, // wrong content type
        { type: "text_keyword1", content: [{ range: [0, 0, 0, 4] }] },
        null,
        "string"
      ]
    });
    expect(parsed?.entries).toHaveLength(1);
    expect(parsed?.entries[0].type).toBe("text_keyword1");
  });

  it("drops malformed ranges within an entry", () => {
    const parsed = parsePideDecorationPayload({
      uri: "file:///a",
      entries: [
        {
          type: "text_main",
          content: [
            { range: [0, 0, 0, 5] },
            { range: [-1, 0, 0, 5] }, // negative
            { range: [0, 0, 0] }, // too short
            { range: "nope" }, // wrong type
            { range: [Number.NaN, 0, 0, 5] }, // NaN
            { range: [2, 0, 1, 0] }, // end before start (line)
            { range: [1, 5, 1, 3] }, // end before start (same line)
            { range: [1, 0, 1, 0] } // empty range, accepted
          ]
        }
      ]
    });
    expect(parsed?.entries[0].content).toHaveLength(2);
    expect(parsed?.entries[0].content[0].range).toEqual({
      start: { line: 0, character: 0 },
      end: { line: 0, character: 5 }
    });
    expect(parsed?.entries[0].content[1].range).toEqual({
      start: { line: 1, character: 0 },
      end: { line: 1, character: 0 }
    });
  });

  it("parses a single hover_message MarkedString", () => {
    const parsed = parsePideDecorationPayload({
      uri: "file:///a",
      entries: [
        {
          type: "text_main",
          content: [
            {
              range: [0, 0, 0, 4],
              hover_message: { language: "isabelle", value: "nat" }
            }
          ]
        }
      ]
    });
    expect(parsed?.entries[0].content[0].hoverMessages).toEqual([
      { language: "isabelle", value: "nat" }
    ]);
  });

  it("parses an array of hover_message MarkedStrings", () => {
    const parsed = parsePideDecorationPayload({
      uri: "file:///a",
      entries: [
        {
          type: "text_main",
          content: [
            {
              range: [0, 0, 0, 4],
              hover_message: [
                { language: "isabelle", value: "nat" },
                { language: "plaintext", value: "the natural numbers" }
              ]
            }
          ]
        }
      ]
    });
    expect(parsed?.entries[0].content[0].hoverMessages).toHaveLength(2);
    expect(parsed?.entries[0].content[0].hoverMessages[0]).toEqual({
      language: "isabelle",
      value: "nat"
    });
  });

  it("treats missing or null hover_message as empty", () => {
    const parsed = parsePideDecorationPayload({
      uri: "file:///a",
      entries: [
        {
          type: "text_main",
          content: [
            { range: [0, 0, 0, 4] },
            { range: [1, 0, 1, 4], hover_message: null }
          ]
        }
      ]
    });
    expect(parsed?.entries[0].content[0].hoverMessages).toEqual([]);
    expect(parsed?.entries[0].content[1].hoverMessages).toEqual([]);
  });

  it("accepts a plain-string hover_message as plaintext (LSP MarkedString string form)", () => {
    const parsed = parsePideDecorationPayload({
      uri: "file:///a",
      entries: [
        {
          type: "text_main",
          content: [
            { range: [0, 0, 0, 4], hover_message: "just a string" }
          ]
        }
      ]
    });
    expect(parsed?.entries[0].content[0].hoverMessages).toEqual([
      { language: "plaintext", value: "just a string" }
    ]);
  });

  it("rejects ranges with non-integer (fractional) numbers", () => {
    const parsed = parsePideDecorationPayload({
      uri: "file:///a",
      entries: [
        {
          type: "text_main",
          content: [
            { range: [0, 0, 0, 5] },
            { range: [0.5, 0, 0, 5] }, // fractional line
            { range: [0, 0, 0, 5.7] } // fractional char
          ]
        }
      ]
    });
    expect(parsed?.entries[0].content).toHaveLength(1);
  });

  it("drops malformed MarkedString entries inside an array hover_message", () => {
    const parsed = parsePideDecorationPayload({
      uri: "file:///a",
      entries: [
        {
          type: "text_main",
          content: [
            {
              range: [0, 0, 0, 4],
              hover_message: [
                { language: "isabelle", value: "ok" },
                { language: 42, value: "bad" },
                null,
                { value: "missing language" }
              ]
            }
          ]
        }
      ]
    });
    expect(parsed?.entries[0].content[0].hoverMessages).toHaveLength(1);
    expect(parsed?.entries[0].content[0].hoverMessages[0].value).toBe("ok");
  });
});

describe("resolvePideDecorationStyle", () => {
  it("resolves all advertised known types to a style", () => {
    for (const type of knownPideDecorationTypes()) {
      const style = resolvePideDecorationStyle(type);
      expect(style, `expected ${type} to resolve`).toBeDefined();
      expect(style?.themeColorId.length).toBeGreaterThan(0);
    }
  });

  it("returns undefined for unknown types so caller can decide", () => {
    expect(resolvePideDecorationStyle("text_made_up")).toBeUndefined();
    expect(resolvePideDecorationStyle("")).toBeUndefined();
    expect(resolvePideDecorationStyle("not_text_prefixed")).toBeUndefined();
  });

  it("pins the canonical Rendering.Color.Value mapping", () => {
    // These pins guard against accidental rename or removal of entries
    // that users actively see — changing one is a user-visible regression
    // and should be deliberate.
    expect(resolvePideDecorationStyle("text_bad")?.presentation).toBe("underline");
    expect(resolvePideDecorationStyle("text_bad")?.kind).toBe("error");
    expect(resolvePideDecorationStyle("text_legacy")?.presentation).toBe("underline");
    expect(resolvePideDecorationStyle("text_legacy")?.kind).toBe("deprecated");
    expect(resolvePideDecorationStyle("text_keyword1")?.kind).toBe("keyword");
    expect(resolvePideDecorationStyle("text_main")?.kind).toBe("variable");
    expect(resolvePideDecorationStyle("text_intensify")?.presentation).toBe("border");
  });

  it("advertises a reasonably comprehensive coverage of Rendering.Color values", () => {
    // Sanity check: we should map at least the high-frequency semantic
    // categories so users don't see a "mostly unstyled" overlay.
    const known = new Set(knownPideDecorationTypes());
    for (const required of [
      "text_main",
      "text_keyword1",
      "text_keyword2",
      "text_keyword3",
      "text_quasi_keyword",
      "text_operator",
      "text_tfree",
      "text_tvar",
      "text_free",
      "text_bound",
      "text_var",
      "text_inner_numeral",
      "text_inner_quoted",
      "text_bad",
      "text_legacy"
    ]) {
      expect(known, `missing ${required} mapping`).toContain(required);
    }
  });
});

describe("groupDecorationEntriesByKnownType", () => {
  it("returns empty map for empty entries", () => {
    const groups = groupDecorationEntriesByKnownType([]);
    expect(groups.size).toBe(0);
  });

  it("groups entries by their type and preserves content order within a type", () => {
    const r = (s: number, e: number) => ({
      start: { line: 0, character: s },
      end: { line: 0, character: e }
    });
    const groups = groupDecorationEntriesByKnownType([
      {
        type: "text_keyword1",
        content: [
          { range: r(0, 5), hoverMessages: [] },
          { range: r(10, 15), hoverMessages: [] }
        ]
      },
      {
        type: "text_main",
        content: [{ range: r(20, 25), hoverMessages: [] }]
      },
      {
        type: "text_keyword1",
        content: [{ range: r(30, 35), hoverMessages: [] }]
      }
    ]);
    expect(Array.from(groups.keys()).sort()).toEqual(["text_keyword1", "text_main"]);
    const keyword1 = groups.get("text_keyword1");
    expect(keyword1?.map((c) => c.range.start.character)).toEqual([0, 10, 30]);
  });

  it("silently drops entries whose type does not resolve to a known style", () => {
    const r = (s: number, e: number) => ({
      start: { line: 0, character: s },
      end: { line: 0, character: e }
    });
    const groups = groupDecorationEntriesByKnownType([
      { type: "text_made_up", content: [{ range: r(0, 5), hoverMessages: [] }] },
      { type: "text_main", content: [{ range: r(10, 20), hoverMessages: [] }] }
    ]);
    expect(Array.from(groups.keys())).toEqual(["text_main"]);
  });

  it("preserves hover messages on each grouped content entry", () => {
    const r = (s: number, e: number) => ({
      start: { line: 0, character: s },
      end: { line: 0, character: e }
    });
    const groups = groupDecorationEntriesByKnownType([
      {
        type: "text_main",
        content: [
          {
            range: r(0, 5),
            hoverMessages: [{ language: "isabelle", value: "?" }]
          }
        ]
      }
    ]);
    const items = groups.get("text_main");
    expect(items?.[0].hoverMessages).toEqual([{ language: "isabelle", value: "?" }]);
  });
});

describe("planDecorationRequests", () => {
  it("returns empty plan + empty memo when LSP is not running", () => {
    for (const state of [undefined, "disabled", "starting", "stopping", "failed"] as const) {
      const plan = planDecorationRequests(["file:///a"], new Set(["file:///a"]), state);
      expect(plan.toRequest).toEqual([]);
      expect(plan.nextRequested.size).toBe(0);
    }
  });

  it("requests every visible URI that is not yet in the memo", () => {
    const plan = planDecorationRequests(
      ["file:///a", "file:///b", "file:///c"],
      new Set(["file:///b"]),
      "running"
    );
    expect([...plan.toRequest].sort()).toEqual(["file:///a", "file:///c"]);
    expect([...plan.nextRequested].sort()).toEqual(["file:///a", "file:///b", "file:///c"]);
  });

  it("evicts memo entries for URIs that are no longer visible", () => {
    const plan = planDecorationRequests(
      ["file:///a"],
      new Set(["file:///a", "file:///b", "file:///c"]),
      "running"
    );
    expect(plan.toRequest).toEqual([]);
    expect([...plan.nextRequested]).toEqual(["file:///a"]);
  });

  it("treats no visible URIs as a no-op that clears the memo", () => {
    const plan = planDecorationRequests([], new Set(["file:///a"]), "running");
    expect(plan.toRequest).toEqual([]);
    expect(plan.nextRequested.size).toBe(0);
  });

  it("deduplicates a visible URI provided more than once", () => {
    const plan = planDecorationRequests(
      ["file:///a", "file:///a"],
      new Set<string>(),
      "running"
    );
    expect(plan.toRequest).toEqual(["file:///a"]);
    expect([...plan.nextRequested]).toEqual(["file:///a"]);
  });
});
