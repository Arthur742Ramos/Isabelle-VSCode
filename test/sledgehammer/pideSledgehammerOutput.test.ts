import { describe, expect, it } from "vitest";
import {
  PideOutputNode,
  collectSendbackTexts,
  parsePideSledgehammerOutput,
  renderPideOutputHtml
} from "../../src/sledgehammer/pideSledgehammerOutput";

// The fixtures below are derived from the live probe in
// docs/sledgehammer_lsp_research.md plus typical shapes produced by
// Isabelle's pretty printer. They are deliberately small so each
// assertion explains a single parser contract.

describe("parsePideSledgehammerOutput", () => {
  it("returns an empty list for the empty string", () => {
    expect(parsePideSledgehammerOutput("")).toEqual([]);
  });

  it("wraps a plain text run in a single text node", () => {
    expect(parsePideSledgehammerOutput("Hello world")).toEqual([
      { kind: "text", text: "Hello world" }
    ]);
  });

  it("decodes the standard XML named entities (amp, lt, gt, quot, apos)", () => {
    expect(
      parsePideSledgehammerOutput("a &amp; b &lt; c &gt; d &quot;e&quot; &apos;f&apos;")
    ).toEqual([{ kind: "text", text: 'a & b < c > d "e" \'f\'' }]);
  });

  it("decodes numeric and hex entities", () => {
    expect(parsePideSledgehammerOutput("hi &#65;&#x42; world")).toEqual([
      { kind: "text", text: "hi AB world" }
    ]);
  });

  it("preserves unknown named entities verbatim", () => {
    expect(parsePideSledgehammerOutput("&nope; &amp;")).toEqual([
      { kind: "text", text: "&nope; &" }
    ]);
  });

  it("captures the live-probe error_message shape", () => {
    // Verbatim payload observed in
    // docs/sledgehammer_lsp_research.md ("Findings → Custom notifications").
    const nodes = parsePideSledgehammerOutput(
      "<error_message>Unknown proof context</error_message>"
    );
    expect(nodes).toEqual([
      { kind: "error", children: [{ kind: "text", text: "Unknown proof context" }] }
    ]);
  });

  it("captures warning_message and information_message symmetrically", () => {
    const warn = parsePideSledgehammerOutput(
      "<warning_message>Stale theory</warning_message>"
    );
    expect(warn).toEqual([
      { kind: "warning", children: [{ kind: "text", text: "Stale theory" }] }
    ]);

    const info = parsePideSledgehammerOutput(
      "<information_message>Try this</information_message>"
    );
    expect(info).toEqual([
      { kind: "information", children: [{ kind: "text", text: "Try this" }] }
    ]);
  });

  it("captures a bare sendback element as a leaf node", () => {
    const nodes = parsePideSledgehammerOutput("<sendback>by auto</sendback>");
    expect(nodes).toEqual([{ kind: "sendback", text: "by auto" }]);
  });

  it("emits sendback as a child of its enclosing information_message", () => {
    const nodes = parsePideSledgehammerOutput(
      "<information_message>Try this: <sendback>by auto</sendback></information_message>"
    );
    expect(nodes).toEqual([
      {
        kind: "information",
        children: [
          { kind: "text", text: "Try this: " },
          { kind: "sendback", text: "by auto" }
        ]
      }
    ]);
  });

  it("treats unknown opening and closing tags as transparent passthrough", () => {
    // <block>, <keyword>, <entity>, <class>, … are Isabelle pretty-printer
    // / syntactic markup that should not break structure or visible text.
    const nodes = parsePideSledgehammerOutput(
      "<block><keyword>by</keyword> <entity>auto</entity></block>"
    );
    expect(nodes).toEqual([{ kind: "text", text: "by auto" }]);
  });

  it("translates the self-closing <break/> tag to a single space", () => {
    expect(
      parsePideSledgehammerOutput("Try<break/>this<break/>now")
    ).toEqual([{ kind: "text", text: "Try this now" }]);
  });

  it("ignores other self-closing tags without producing text or frames", () => {
    expect(parsePideSledgehammerOutput("a<sep/>b")).toEqual([
      { kind: "text", text: "ab" }
    ]);
  });

  it("flattens nested sendback inside a sendback to plain text", () => {
    // Sendback is a leaf: a defensive flattening rule keeps the click
    // target a single proof string even if upstream nests markup.
    const nodes = parsePideSledgehammerOutput(
      "<sendback>by <sendback>auto</sendback></sendback>"
    );
    expect(nodes).toEqual([{ kind: "sendback", text: "by auto" }]);
  });

  it("flattens nested message kinds inside a sendback to plain text", () => {
    const nodes = parsePideSledgehammerOutput(
      "<sendback>oops <error_message>nested</error_message> done</sendback>"
    );
    expect(nodes).toEqual([{ kind: "sendback", text: "oops nested done" }]);
  });

  it("flushes text adjacent to a message frame into the parent before opening", () => {
    const nodes = parsePideSledgehammerOutput(
      "before <error_message>boom</error_message> after"
    );
    expect(nodes).toEqual([
      { kind: "text", text: "before " },
      { kind: "error", children: [{ kind: "text", text: "boom" }] },
      { kind: "text", text: " after" }
    ]);
  });

  it("handles two adjacent top-level messages in document order", () => {
    const nodes = parsePideSledgehammerOutput(
      "<information_message>Found:</information_message><sendback>by auto</sendback>"
    );
    expect(nodes).toEqual([
      { kind: "information", children: [{ kind: "text", text: "Found:" }] },
      { kind: "sendback", text: "by auto" }
    ]);
  });

  it("drops unmatched closing tags for known kinds without losing surrounding text", () => {
    const nodes = parsePideSledgehammerOutput(
      "alpha</error_message>beta</sendback>gamma"
    );
    expect(nodes).toEqual([{ kind: "text", text: "alphabetagamma" }]);
  });

  it("flushes an unterminated message frame so partial input still renders", () => {
    const nodes = parsePideSledgehammerOutput(
      "<information_message>partial input no close"
    );
    expect(nodes).toEqual([
      {
        kind: "information",
        children: [{ kind: "text", text: "partial input no close" }]
      }
    ]);
  });

  it("treats a truncated opening (no closing '>') as plain text", () => {
    const nodes = parsePideSledgehammerOutput("ok then <information_message broken");
    expect(nodes).toEqual([
      { kind: "text", text: "ok then <information_message broken" }
    ]);
  });

  it("preserves quoted '>' inside attribute values when finding the tag end", () => {
    // The findTagEnd helper must skip '>' that occur inside attribute
    // quotes; otherwise it would cut the tag short and treat the rest
    // as text. Isabelle attributes rarely include literal '>' but the
    // parser should not corrupt the surrounding structure if they do.
    const nodes = parsePideSledgehammerOutput(
      '<information_message data="a > b">payload</information_message>'
    );
    expect(nodes).toEqual([
      { kind: "information", children: [{ kind: "text", text: "payload" }] }
    ]);
  });

  it("renders a literal '<>' as text rather than a frame", () => {
    expect(parsePideSledgehammerOutput("a<>b")).toEqual([
      { kind: "text", text: "a<>b" }
    ]);
  });

  it("keeps closing tags inside unrelated sendback frames text-only", () => {
    // Nested-message close inside sendback should drop silently and let
    // the surrounding text flow through unchanged.
    const nodes = parsePideSledgehammerOutput(
      "<sendback>by auto</error_message></sendback>"
    );
    expect(nodes).toEqual([{ kind: "sendback", text: "by auto" }]);
  });
});

describe("collectSendbackTexts", () => {
  it("returns no entries when there are no sendback nodes", () => {
    const nodes = parsePideSledgehammerOutput(
      "<information_message>nothing here</information_message>"
    );
    expect(collectSendbackTexts(nodes)).toEqual([]);
  });

  it("collects sendback proof strings in document order, trimmed", () => {
    const nodes = parsePideSledgehammerOutput(
      "<information_message>Try one of: <sendback>by auto</sendback>, " +
        "<sendback> by blast </sendback></information_message>"
    );
    expect(collectSendbackTexts(nodes)).toEqual(["by auto", "by blast"]);
  });

  it("drops whitespace-only sendback entries", () => {
    const nodes: readonly PideOutputNode[] = [
      { kind: "sendback", text: "   \n  " },
      { kind: "sendback", text: " by auto " }
    ];
    expect(collectSendbackTexts(nodes)).toEqual(["by auto"]);
  });

  it("walks nested message frames to collect deeply nested sendbacks", () => {
    const nodes = parsePideSledgehammerOutput(
      "<information_message>" +
        "<warning_message>be careful: <sendback>by auto</sendback></warning_message>" +
        "</information_message>"
    );
    expect(collectSendbackTexts(nodes)).toEqual(["by auto"]);
  });
});

describe("renderPideOutputHtml", () => {
  it("returns the empty string for no nodes", () => {
    expect(renderPideOutputHtml([])).toBe("");
  });

  it("renders a text node as an escaped span with the text class", () => {
    const html = renderPideOutputHtml([{ kind: "text", text: "<a> & 'b'" }]);
    expect(html).toBe(
      '<span class="pide-sledgehammer-text">&lt;a&gt; &amp; &#39;b&#39;</span>'
    );
  });

  it("renders a sendback as an escaped <code> carrying data-pide-sendback", () => {
    const html = renderPideOutputHtml([{ kind: "sendback", text: 'by "auto"' }]);
    expect(html).toBe(
      '<code class="pide-sledgehammer-sendback" data-pide-sendback="by &quot;auto&quot;">by &quot;auto&quot;</code>'
    );
  });

  it("renders each message kind with the matching CSS class", () => {
    const html = renderPideOutputHtml([
      { kind: "error", children: [{ kind: "text", text: "boom" }] },
      { kind: "warning", children: [{ kind: "text", text: "caveat" }] },
      { kind: "information", children: [{ kind: "text", text: "note" }] }
    ]);
    expect(html).toBe(
      '<div class="pide-sledgehammer-message pide-sledgehammer-error">' +
        '<span class="pide-sledgehammer-text">boom</span></div>' +
        '<div class="pide-sledgehammer-message pide-sledgehammer-warning">' +
        '<span class="pide-sledgehammer-text">caveat</span></div>' +
        '<div class="pide-sledgehammer-message pide-sledgehammer-information">' +
        '<span class="pide-sledgehammer-text">note</span></div>'
    );
  });

  it("strips unknown elements and never emits an executable <script> tag", () => {
    // Belt-and-braces guard: even pathological inputs must not break out
    // of the webview-safe HTML envelope. Unknown opening/closing tags
    // (including hostile ones like <script>) are transparent — their
    // markup is stripped but their visible text content is preserved
    // and escaped through the renderer.
    const nodes = parsePideSledgehammerOutput(
      "<information_message>danger: <script>alert(1)</script> and " +
        "<sendback>by &quot;auto&quot;</sendback></information_message>"
    );
    const html = renderPideOutputHtml(nodes);
    expect(html).not.toMatch(/<script/);
    expect(html).not.toMatch(/<\/script/);
    expect(html).toContain(
      '<span class="pide-sledgehammer-text">danger: alert(1) and </span>'
    );
    expect(html).toContain('data-pide-sendback="by &quot;auto&quot;"');
  });

  it("escapes raw '<', '&', and quote characters that survive parsing as text", () => {
    // A second guard that exercises the escapeHtml call path directly,
    // independent of how the parser handles unknown markup. Any text
    // that does reach the renderer must be fully escaped before being
    // placed inside an HTML attribute or element body.
    const html = renderPideOutputHtml([
      { kind: "sendback", text: '<img onerror="x">' },
      { kind: "text", text: "5 < 10 & 7 > 3" }
    ]);
    expect(html).not.toMatch(/<img/);
    expect(html).toContain(
      'data-pide-sendback="&lt;img onerror=&quot;x&quot;&gt;"'
    );
    expect(html).toContain(
      '<span class="pide-sledgehammer-text">5 &lt; 10 &amp; 7 &gt; 3</span>'
    );
  });
});
