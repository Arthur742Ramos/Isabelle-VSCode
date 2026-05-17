import { describe, expect, it } from "vitest";
import {
  PidePreviewSnapshot,
  PidePreviewSubscriber
} from "../../src/api/PidePreviewSubscriber";
import {
  PreviewTheoryActiveEditor,
  PreviewTheoryLspStatusReader,
  PreviewTheoryPanel,
  PreviewTheoryUi,
  previewActiveTheory,
  wirePreviewSnapshotsToPanel,
  wrapPreviewHtml,
  wrapPreviewPlaceholderHtml
} from "../../src/api/previewTheory";
import { IsabelleLanguageServerStatus } from "../../src/lsp/lspTypes";

function makeStatusReader(state: IsabelleLanguageServerStatus["state"]): PreviewTheoryLspStatusReader {
  return { getStatus: () => ({ state }) };
}

interface FakePanel extends PreviewTheoryPanel {
  readonly setContentCalls: { title: string; html: string }[];
  readonly reveals: number[];
}

function makePanel(): FakePanel {
  const setContentCalls: { title: string; html: string }[] = [];
  const reveals: number[] = [];
  return {
    setContentCalls,
    reveals,
    setContent: (title, html) => setContentCalls.push({ title, html }),
    reveal: (column) => reveals.push(column),
    dispose: () => {}
  };
}

interface FakeUi extends PreviewTheoryUi {
  readonly infoMessages: string[];
  readonly warningMessages: string[];
  readonly resolveCalls: { editor: PreviewTheoryActiveEditor; split: boolean }[];
  panel?: FakePanel;
}

function makeFakeUi(
  editor: PreviewTheoryActiveEditor | undefined,
  splitColumn = 2,
  defaultColumn = 1
): FakeUi {
  const infoMessages: string[] = [];
  const warningMessages: string[] = [];
  const resolveCalls: { editor: PreviewTheoryActiveEditor; split: boolean }[] = [];
  let panel: FakePanel | undefined;
  return {
    infoMessages,
    warningMessages,
    resolveCalls,
    get panel() { return panel; },
    set panel(value) { panel = value; },
    getActiveEditor: () => editor,
    resolvePreviewColumn: (ed, split) => {
      resolveCalls.push({ editor: ed, split });
      return split ? splitColumn : defaultColumn;
    },
    ensurePanel: () => {
      if (!panel) panel = makePanel();
      return panel;
    },
    showInformationMessage: async (m: string) => {
      infoMessages.push(m);
      return undefined;
    },
    showWarningMessage: async (m: string) => {
      warningMessages.push(m);
      return undefined;
    }
  };
}

// Minimal subscriber stub — previewActiveTheory only reaches for
// requestPreview + getLatest, not the full lifecycle.
function makeFakeSubscriber(
  requestReturn = true,
  latest?: PidePreviewSnapshot
): PidePreviewSubscriber {
  const sentRequests: { uri: string; column: number }[] = [];
  return {
    requestPreview: (uri: string, column: number) => {
      sentRequests.push({ uri, column });
      return requestReturn;
    },
    getLatest: () => latest,
    onSnapshot: () => ({ dispose: () => {} }),
    dispose: () => {},
    /** Test-only escape hatch. */
    __sent: sentRequests
  } as unknown as PidePreviewSubscriber;
}

describe("previewActiveTheory guards", () => {
  it("surfaces info when LSP is not running", async () => {
    const ui = makeFakeUi({ uri: "file:///a/Foo.thy", isTheoryDocument: true, viewColumn: 1 });
    const sub = makeFakeSubscriber();
    const sent = await previewActiveTheory(sub, makeStatusReader("disabled"), ui);
    expect(sent).toBe(false);
    expect(ui.infoMessages[0]).toMatch(/language server is running/);
  });

  it("surfaces info when no active editor", async () => {
    const ui = makeFakeUi(undefined);
    const sub = makeFakeSubscriber();
    const sent = await previewActiveTheory(sub, makeStatusReader("running"), ui);
    expect(sent).toBe(false);
    expect(ui.infoMessages[0]).toMatch(/Open an Isabelle theory/);
  });

  it("surfaces info when active editor is not an Isabelle theory", async () => {
    const ui = makeFakeUi({ uri: "file:///a/README.md", isTheoryDocument: false, viewColumn: 1 });
    const sub = makeFakeSubscriber();
    const sent = await previewActiveTheory(sub, makeStatusReader("running"), ui);
    expect(sent).toBe(false);
    expect(ui.infoMessages[0]).toMatch(/only applies to `\.thy` files/);
  });

  it("surfaces warning when subscriber requestPreview returns false (LSP went away mid-call)", async () => {
    const ui = makeFakeUi({ uri: "file:///a/Foo.thy", isTheoryDocument: true, viewColumn: 1 });
    const sub = makeFakeSubscriber(false);
    const sent = await previewActiveTheory(sub, makeStatusReader("running"), ui);
    expect(sent).toBe(false);
    expect(ui.warningMessages[0]).toMatch(/Could not dispatch/);
  });
});

describe("previewActiveTheory success path", () => {
  it("ensures the panel, reveals it, sends the request, and paints a placeholder when no cache", async () => {
    const ui = makeFakeUi({ uri: "file:///a/Foo.thy", isTheoryDocument: true, viewColumn: 1 });
    const sub = makeFakeSubscriber(true);
    const sent = await previewActiveTheory(sub, makeStatusReader("running"), ui);
    expect(sent).toBe(true);
    expect(ui.resolveCalls).toHaveLength(1);
    expect(ui.resolveCalls[0].split).toBe(false);
    expect(ui.panel?.reveals).toEqual([1]);
    expect(ui.panel?.setContentCalls).toHaveLength(1);
    expect(ui.panel?.setContentCalls[0].title).toMatch(/Loading preview/);
    expect(ui.panel?.setContentCalls[0].html).toContain("Loading Isabelle preview");
    expect((sub as unknown as { __sent: { uri: string; column: number }[] }).__sent).toEqual([
      { uri: "file:///a/Foo.thy", column: 1 }
    ]);
  });

  it("paints the cached snapshot immediately when its URI matches the active editor", async () => {
    const cached: PidePreviewSnapshot = {
      uri: "file:///a/Foo.thy",
      column: 1,
      label: "Foo",
      content: "<h1>Theory Foo</h1>",
      receivedAt: "2026-05-17T00:00:00.000Z"
    };
    const ui = makeFakeUi({ uri: "file:///a/Foo.thy", isTheoryDocument: true, viewColumn: 1 });
    const sub = makeFakeSubscriber(true, cached);
    await previewActiveTheory(sub, makeStatusReader("running"), ui);
    expect(ui.panel?.setContentCalls).toHaveLength(1);
    expect(ui.panel?.setContentCalls[0].title).toBe("Foo");
    expect(ui.panel?.setContentCalls[0].html).toContain("Theory Foo");
  });

  it("falls back to placeholder when cached snapshot is for a different URI", async () => {
    const cached: PidePreviewSnapshot = {
      uri: "file:///a/Bar.thy",
      column: 1,
      label: "Bar",
      content: "<h1>Theory Bar</h1>",
      receivedAt: ""
    };
    const ui = makeFakeUi({ uri: "file:///a/Foo.thy", isTheoryDocument: true, viewColumn: 1 });
    const sub = makeFakeSubscriber(true, cached);
    await previewActiveTheory(sub, makeStatusReader("running"), ui);
    expect(ui.panel?.setContentCalls[0].title).toMatch(/Loading preview/);
  });

  it("requests the split column when split=true is passed", async () => {
    const ui = makeFakeUi({ uri: "file:///a/Foo.thy", isTheoryDocument: true, viewColumn: 1 }, 2, 1);
    const sub = makeFakeSubscriber(true);
    await previewActiveTheory(sub, makeStatusReader("running"), ui, { split: true });
    expect(ui.resolveCalls[0].split).toBe(true);
    expect(ui.panel?.reveals).toEqual([2]);
    expect((sub as unknown as { __sent: { uri: string; column: number }[] }).__sent).toEqual([
      { uri: "file:///a/Foo.thy", column: 2 }
    ]);
  });
});

describe("wrapPreviewHtml + wrapPreviewPlaceholderHtml", () => {
  it("wraps the server-provided content in a CSP-locked document", () => {
    const html = wrapPreviewHtml({
      uri: "u",
      column: 1,
      label: "Foo",
      content: "<h1>Theory Foo</h1>",
      receivedAt: "2026-05-17T00:00:00.000Z"
    });
    expect(html).toContain("<title>Foo</title>");
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("<h1>Theory Foo</h1>");
    expect(html).toContain("2026-05-17T00:00:00.000Z");
  });

  it("escapes label and timestamp into HTML-safe form", () => {
    const html = wrapPreviewHtml({
      uri: "u",
      column: 1,
      label: "<script>alert(1)</script>",
      content: "",
      receivedAt: ""
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("emits a placeholder document with the URI escaped", () => {
    const html = wrapPreviewPlaceholderHtml("file:///<bad>");
    expect(html).toContain("file:///&lt;bad&gt;");
    expect(html).toContain("default-src 'none'");
  });
});

describe("wirePreviewSnapshotsToPanel", () => {
  it("re-paints the panel whenever a non-empty snapshot arrives", () => {
    const ui = makeFakeUi({ uri: "u", isTheoryDocument: true, viewColumn: 1 });
    const handlers: ((s: PidePreviewSnapshot) => void)[] = [];
    const fakeSub = {
      onSnapshot: (handler: (s: PidePreviewSnapshot) => void) => {
        handlers.push(handler);
        return { dispose: () => {} };
      }
    } as unknown as PidePreviewSubscriber;
    const wiring = wirePreviewSnapshotsToPanel(fakeSub, ui);
    handlers[0]({ uri: "u", column: 1, label: "Foo", content: "<h1>x</h1>", receivedAt: "" });
    expect(ui.panel?.setContentCalls).toHaveLength(1);
    expect(ui.panel?.setContentCalls[0].title).toBe("Foo");
    wiring.dispose();
  });

  it("does NOT repaint when the snapshot is empty (avoids the loading flash)", () => {
    const ui = makeFakeUi({ uri: "u", isTheoryDocument: true, viewColumn: 1 });
    const handlers: ((s: PidePreviewSnapshot) => void)[] = [];
    const fakeSub = {
      onSnapshot: (handler: (s: PidePreviewSnapshot) => void) => {
        handlers.push(handler);
        return { dispose: () => {} };
      }
    } as unknown as PidePreviewSubscriber;
    wirePreviewSnapshotsToPanel(fakeSub, ui);
    handlers[0]({ uri: "u", column: 1, label: "Foo", content: "<body></body>", receivedAt: "" });
    expect(ui.panel).toBeUndefined();
  });
});
