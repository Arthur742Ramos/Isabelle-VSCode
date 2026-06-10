import { describe, expect, it } from "vitest";
import { selectionRangesAt } from "../../src/semantic/selectionRanges";

function texts(source: string, offset: number): string[] {
  return selectionRangesAt(source, offset).map((r) => source.slice(r.start, r.end));
}

describe("selectionRangesAt", () => {
  it("returns an empty chain for empty input", () => {
    expect(selectionRangesAt("", 0)).toEqual([]);
  });

  it("grows from an identifier token to its command span to the document", () => {
    const src = ["theory T", "imports Main", "begin", "lemma foo: \"x = y\"", "  by simp", "end"].join("\n");
    const chain = texts(src, src.indexOf("foo"));
    expect(chain[0]).toBe("foo");
    expect(chain[chain.length - 1]).toBe(src); // whole document last
    // strictly growing
    for (let i = 1; i < chain.length; i++) {
      expect(chain[i].length).toBeGreaterThan(chain[i - 1].length);
    }
  });

  it("selects the enclosing quoted term when the cursor is inside a string", () => {
    const src = ["theory T", "imports Main", "begin", "lemma foo: \"x = y\"", "  by simp", "end"].join("\n");
    const chain = texts(src, src.indexOf("x = y"));
    expect(chain[0]).toBe("\"x = y\""); // the quoted term, delimiters included
    expect(chain[chain.length - 1]).toBe(src);
  });

  it("selects the enclosing cartouche when the cursor is inside one", () => {
    const open = "‹";
    const close = "›";
    const src = `theory T\nimports Main\nbegin\ntext ${open}some prose here${close}\nend`;
    const chain = texts(src, src.indexOf("prose"));
    expect(chain[0]).toBe(`${open}some prose here${close}`);
  });

  it("includes the enclosing proof and begin..end block when nested", () => {
    const src = [
      "theory T",
      "imports Main",
      "begin",
      "context fixes n begin",
      "lemma foo: \"P n\"",
      "proof -",
      "  show \"P n\" sorry",
      "qed",
      "end",
      "end"
    ].join("\n");
    const chain = texts(src, src.indexOf("show"));
    expect(chain[0]).toBe("show");
    // a proof..qed level is present
    expect(chain.some((t) => t.startsWith("proof -") && t.includes("qed"))).toBe(true);
    // a context begin..end level is present
    expect(chain.some((t) => t.startsWith("context fixes n begin") && t.trimEnd().endsWith("end"))).toBe(true);
    // document is last
    expect(chain[chain.length - 1]).toBe(src);
  });

  it("produces a strictly nesting chain that always contains the cursor", () => {
    const src = ["theory T", "imports Main", "begin", "definition d where \"d = (0::nat)\"", "end"].join("\n");
    const offset = src.indexOf("d where") ; // on the declared name `d`
    const ranges = selectionRangesAt(src, offset);
    for (let i = 0; i < ranges.length; i++) {
      // each range contains the cursor
      expect(ranges[i].start).toBeLessThanOrEqual(offset);
      expect(ranges[i].end).toBeGreaterThanOrEqual(offset);
      if (i > 0) {
        // each strictly contains the previous
        expect(ranges[i].start).toBeLessThanOrEqual(ranges[i - 1].start);
        expect(ranges[i].end).toBeGreaterThanOrEqual(ranges[i - 1].end);
        expect(ranges[i].end - ranges[i].start).toBeGreaterThan(ranges[i - 1].end - ranges[i - 1].start);
      }
    }
  });

  it("clamps an out-of-range cursor and still returns the document range", () => {
    const src = "theory T imports Main begin end";
    const chain = selectionRangesAt(src, src.length + 50);
    expect(chain.length).toBeGreaterThan(0);
    expect(chain[chain.length - 1]).toEqual({ start: 0, end: src.length });
  });
});
