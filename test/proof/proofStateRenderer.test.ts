import { describe, expect, it } from "vitest";
import { renderProofStateHtml } from "../../src/proof/proofStateRenderer";

describe("renderProofStateHtml", () => {
  it("renders an empty proof-state prompt", () => {
    const html = renderProofStateHtml(undefined);
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("Open an Isabelle theory");
  });

  it("escapes structured proof-state content", () => {
    const html = renderProofStateHtml({
      uri: "file:///A.thy",
      version: 1,
      status: "unavailable",
      command: {
        id: "c1",
        kind: "lemma",
        name: "x_less_y",
        status: "pending",
        range: {
          start: { line: 0, character: 0 },
          end: { line: 1, character: 0 }
        }
      },
      context: [
        {
          kind: "assumption",
          name: "h",
          value: "x < y"
        }
      ],
      goals: [
        {
          index: 1,
          text: "x < z"
        }
      ],
      raw: "raw <state>",
      message: "placeholder"
    });

    expect(html).toContain("lemma x_less_y");
    expect(html).toContain("x &lt; y");
    expect(html).toContain("raw &lt;state&gt;");
  });
});
