import { describe, expect, it } from "vitest";
import { renderSledgehammerHtml } from "../../src/sledgehammer/sledgehammerRenderer";

describe("renderSledgehammerHtml", () => {
  it("renders an empty Sledgehammer prompt", () => {
    const html = renderSledgehammerHtml(undefined);

    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("Isabelle: Run Sledgehammer");
    expect(html).toContain("live proof search still requires Isabelle/PIDE backend integration");
    expect(html).not.toContain("Recent runs");
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

  it("omits the Recent runs section when history is empty", () => {
    const html = renderSledgehammerHtml(
      {
        requestId: "sledgehammer-1",
        uri: "file:///A.thy",
        status: "completed",
        suggestions: [],
        raw: "done"
      },
      []
    );

    expect(html).not.toContain("Recent runs");
  });

  it("renders a Recent runs section for history entries with escaping", () => {
    const html = renderSledgehammerHtml(
      {
        requestId: "sledgehammer-2",
        uri: "file:///A.thy",
        status: "completed",
        suggestions: [],
        raw: "done"
      },
      [
        {
          requestId: "sledgehammer-2",
          uri: "file:///A.thy",
          status: "completed",
          suggestionCount: 2,
          commandSummary: "lemma <foo>",
          message: "found 2 proofs",
          startedAt: "2026-05-01T12:00:00.000Z",
          finishedAt: "2026-05-01T12:00:05.000Z"
        },
        {
          requestId: "sledgehammer-1",
          uri: "file:///A.thy",
          status: "cancelled",
          suggestionCount: 0,
          message: "user cancelled",
          startedAt: "2026-05-01T11:59:00.000Z"
        }
      ]
    );

    expect(html).toContain("Recent runs");
    expect(html).toContain("2026-05-01T12:00:00.000Z");
    expect(html).toContain("lemma &lt;foo&gt;");
    expect(html).toContain("2 suggestions");
    expect(html).toContain("found 2 proofs");
    expect(html).toContain("cancelled");
    expect(html).toContain("user cancelled");
    expect(html).toContain("PIDE-backed proof search remains future work");
  });

  it("renders the LSP-mode 'Prover output' section when outputNodes are supplied", () => {
    // When the panel is in LSP mode, the renderer prefers the parsed
    // PIDE output tree over the plain-text 'raw' field for the
    // bottom panel section. The 'raw' field is still surfaced as a
    // small status caption above the parsed output.
    const html = renderSledgehammerHtml(
      {
        requestId: "sledgehammer-lsp-1",
        uri: "file:///A.thy",
        status: "running",
        suggestions: [],
        raw: "Sledgehammering ..."
      },
      [],
      [
        {
          kind: "information",
          children: [
            { kind: "text", text: "Try this: " },
            { kind: "sendback", text: "by auto" }
          ]
        }
      ]
    );

    expect(html).toContain("Prover output");
    expect(html).not.toContain("Backend boundary");
    expect(html).toContain('class="pide-sledgehammer-message pide-sledgehammer-information"');
    expect(html).toContain('class="pide-sledgehammer-text"');
    expect(html).toContain('data-pide-sendback="by auto"');
    // Status caption still surfaces the upstream status string.
    expect(html).toContain("Sledgehammering ...");
  });

  it("falls back to the 'Backend boundary' section when outputNodes is empty", () => {
    const html = renderSledgehammerHtml(
      {
        requestId: "sledgehammer-1",
        uri: "file:///A.thy",
        status: "completed",
        suggestions: [],
        raw: "done"
      },
      [],
      []
    );

    expect(html).toContain("Backend boundary");
    expect(html).not.toContain("Prover output");
  });
});
