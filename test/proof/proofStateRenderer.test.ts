import { describe, expect, it } from "vitest";
import {
  formatProofStateFreshness,
  renderProofStateHtml
} from "../../src/proof/proofStateRenderer";

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

  it("renders the PIDE view with parsed Isabelle XML content and an auto-update banner", () => {
    const html = renderProofStateHtml(undefined, {
      outputNodes: [
        {
          kind: "information",
          children: [
            { kind: "text", text: "Goal: " },
            { kind: "sendback", text: "by auto" }
          ]
        }
      ],
      autoUpdate: true,
      lastOutputReceivedAtMs: 1_000,
      nowMs: 1_000
    });

    expect(html).toContain("Live proof state from <code>isabelle vscode_server</code>");
    expect(html).toContain("auto-update on");
    expect(html).toContain("Latest PIDE state received just now.");
    expect(html).not.toContain("auto-update off");
    expect(html).toContain('class="pide-sledgehammer-message pide-sledgehammer-information"');
    expect(html).toContain('data-pide-sendback="by auto"');
    // PIDE view replaces the legacy Raw section entirely.
    expect(html).not.toContain("No raw proof state available yet");
  });

  it("flips the auto-update banner when the server reports auto_update=false", () => {
    const html = renderProofStateHtml(undefined, {
      outputNodes: [],
      autoUpdate: false,
      nowMs: 1_000
    });
    expect(html).toContain("auto-update off");
    expect(html).not.toContain("auto-update on");
  });

  it("shows a 'waiting' placeholder when the PIDE view has no output yet", () => {
    const html = renderProofStateHtml(undefined, {
      outputNodes: [],
      autoUpdate: true,
      nowMs: 1_000
    });
    expect(html).toContain("Waiting for isabelle vscode_server");
    expect(html).toContain("No PIDE proof-state snapshot has arrived yet.");
  });

  it("surfaces the PIDE status caption and error sections when supplied", () => {
    const html = renderProofStateHtml(undefined, {
      outputNodes: [],
      autoUpdate: true,
      nowMs: 1_000,
      status: "Initialising PIDE state panel...",
      errorMessage: "PIDE/state_init failed: boom"
    });
    expect(html).toContain("Initialising PIDE state panel...");
    expect(html).toContain("<h3>Error</h3>");
    expect(html).toContain("PIDE/state_init failed: boom");
  });

  it("escapes error messages and status captions to keep the webview safe", () => {
    const html = renderProofStateHtml(undefined, {
      outputNodes: [],
      autoUpdate: false,
      nowMs: 1_000,
      status: "broken <state>",
      errorMessage: "<script>alert(1)</script>"
    });
    expect(html).not.toMatch(/<script/);
    expect(html).toContain("broken &lt;state&gt;");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("does not include the legacy Raw section when in PIDE view mode", () => {
    // Even if a stale ProofStateResult is in lastState, the PIDE view
    // takes over and the local Raw/Context/Goals sections must not
    // render — otherwise users see two competing stories.
    const html = renderProofStateHtml(
      {
        uri: "file:///A.thy",
        version: 1,
        status: "ready",
        context: [{ kind: "fact", name: "f", value: "x = y" }],
        goals: [{ index: 1, text: "P x" }],
        raw: "leftover raw"
      },
      {
        outputNodes: [{ kind: "text", text: "live" }],
        autoUpdate: true,
        lastOutputReceivedAtMs: 1_000,
        nowMs: 1_000
      }
    );
    expect(html).not.toContain("leftover raw");
    expect(html).not.toContain("<h3>Context</h3>");
    expect(html).not.toContain("<h3>Goals</h3>");
    expect(html).toContain('class="pide-sledgehammer-text"');
  });

  it("renders the secondary Dynamic output section when dynamicOutputNodes are supplied", () => {
    const html = renderProofStateHtml(undefined, {
      outputNodes: [{ kind: "text", text: "main" }],
      autoUpdate: true,
      lastOutputReceivedAtMs: 1_000,
      nowMs: 1_000,
      dynamicOutputNodes: [
        {
          kind: "warning",
          children: [{ kind: "text", text: "caret hover note" }]
        }
      ]
    });
    expect(html).toContain("Dynamic output (caret-driven)");
    expect(html).toContain('class="pide-sledgehammer-message pide-sledgehammer-warning"');
    expect(html).toContain("caret hover note");
  });

  it("omits the Dynamic output section when the snapshot is empty or undefined", () => {
    const noSnapshot = renderProofStateHtml(undefined, {
      outputNodes: [],
      autoUpdate: true,
      nowMs: 1_000
    });
    expect(noSnapshot).not.toContain("Dynamic output (caret-driven)");

    const emptySnapshot = renderProofStateHtml(undefined, {
      outputNodes: [],
      autoUpdate: true,
      nowMs: 1_000,
      dynamicOutputNodes: []
    });
    expect(emptySnapshot).not.toContain("Dynamic output (caret-driven)");
  });

  it("marks the PIDE view as refresh-pending when the latest request is newer than the output", () => {
    const freshness = formatProofStateFreshness({
      lastOutputReceivedAtMs: 1_000,
      refreshRequestedAtMs: 5_000,
      nowMs: 6_500,
      staleAfterMs: 10_000
    });
    expect(freshness.tone).toBe("warning");
    expect(freshness.message).toContain("Refresh pending for 1s");
    expect(freshness.message).toContain("5s ago");
  });

  it("marks old PIDE snapshots as warning-level freshness", () => {
    const freshness = formatProofStateFreshness({
      lastOutputReceivedAtMs: 1_000,
      nowMs: 12_000,
      staleAfterMs: 10_000
    });
    expect(freshness).toEqual({
      tone: "warning",
      message: "Latest PIDE state received 11s ago; re-anchor if this no longer matches the cursor."
    });
  });
});
