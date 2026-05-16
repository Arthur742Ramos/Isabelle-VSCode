import { describe, expect, it } from "vitest";
import { renderSledgehammerHtml } from "../../src/sledgehammer/sledgehammerRenderer";

describe("renderSledgehammerHtml", () => {
  it("renders an empty Sledgehammer prompt", () => {
    const html = renderSledgehammerHtml(undefined);

    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("Isabelle: Run Sledgehammer");
    expect(html).toContain("live proof search still requires Isabelle/PIDE backend integration");
  });

  it("escapes unavailable backend details", () => {
    const html = renderSledgehammerHtml({
      requestId: "sledgehammer-1",
      uri: "file:///A.thy",
      version: 1,
      status: "unavailable",
      command: {
        id: "c1",
        kind: "lemma",
        name: "unsafe_<name>",
        status: "pending",
        range: {
          start: { line: 0, character: 0 },
          end: { line: 1, character: 0 }
        }
      },
      suggestions: [],
      raw: "requires <PIDE>",
      message: "placeholder <boundary>"
    });

    expect(html).toContain("sledgehammer-1");
    expect(html).toContain("lemma unsafe_&lt;name&gt;");
    expect(html).toContain("placeholder &lt;boundary&gt;");
    expect(html).toContain("requires &lt;PIDE&gt;");
  });

  it("renders escaped proof suggestions", () => {
    const html = renderSledgehammerHtml({
      requestId: "sledgehammer-2",
      uri: "file:///A.thy",
      status: "completed",
      suggestions: [
        {
          label: "metis <proof>",
          method: "metis",
          description: "uses <facts>",
          proofText: "by <metis>"
        }
      ],
      raw: "done"
    });

    expect(html).toContain("metis &lt;proof&gt;");
    expect(html).toContain("uses &lt;facts&gt;");
    expect(html).toContain("by &lt;metis&gt;");
  });
});
