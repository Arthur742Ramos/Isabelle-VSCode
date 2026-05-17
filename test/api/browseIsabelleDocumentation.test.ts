import { describe, expect, it, vi } from "vitest";
import {
  browseIsabelleDocumentation,
  ShowDocumentationLogger,
  ShowDocumentationLspStatusReader,
  ShowDocumentationQuickPickItem,
  ShowDocumentationUi
} from "../../src/api/browseIsabelleDocumentation";
import { PideDocumentationCache } from "../../src/api/PideDocumentationCache";
import { IsabelleLanguageServerStatus } from "../../src/lsp/lspTypes";

function makeStatusReader(state: IsabelleLanguageServerStatus["state"]): ShowDocumentationLspStatusReader {
  return {
    getStatus: () => ({ state })
  };
}

function makeLogger(): ShowDocumentationLogger & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    appendLine: (line: string) => lines.push(line)
  };
}

interface FakeUi extends ShowDocumentationUi {
  readonly shownInfo: string[];
  readonly shownWarning: string[];
  readonly openedPaths: string[];
  readonly capturedPickItems: { items: readonly ShowDocumentationQuickPickItem[] };
}

function makeFakeUi(
  pickedIndex: number | undefined = undefined,
  openExternalReturn = true
): FakeUi {
  const shownInfo: string[] = [];
  const shownWarning: string[] = [];
  const openedPaths: string[] = [];
  const capturedPickItems: { items: readonly ShowDocumentationQuickPickItem[] } = { items: [] };
  return {
    shownInfo,
    shownWarning,
    openedPaths,
    capturedPickItems,
    showQuickPick: async (items: readonly ShowDocumentationQuickPickItem[]) => {
      capturedPickItems.items = [...items];
      if (pickedIndex === undefined) return undefined;
      return items[pickedIndex];
    },
    showInformationMessage: async (m: string) => {
      shownInfo.push(m);
      return undefined;
    },
    showWarningMessage: async (m: string) => {
      shownWarning.push(m);
      return undefined;
    },
    openExternalFile: async (path: string) => {
      openedPaths.push(path);
      return openExternalReturn;
    }
  };
}

function makeFakeCache(sections: readonly unknown[], refreshSpy?: () => void): PideDocumentationCache {
  return {
    getSections: () => sections,
    refresh: () => refreshSpy?.()
  } as unknown as PideDocumentationCache;
}

describe("browseIsabelleDocumentation", () => {
  it("surfaces an info message when the LSP is not running", async () => {
    const cache = makeFakeCache([]);
    const ui = makeFakeUi();
    await browseIsabelleDocumentation(cache, makeStatusReader("disabled"), makeLogger(), ui);
    expect(ui.shownInfo).toHaveLength(1);
    expect(ui.shownInfo[0]).toMatch(/language server is running/);
    expect(ui.openedPaths).toEqual([]);
  });

  it("requests a fresh response and surfaces a loading message when the cache is empty", async () => {
    const refreshSpy = vi.fn();
    const cache = makeFakeCache([], refreshSpy);
    const ui = makeFakeUi();
    await browseIsabelleDocumentation(cache, makeStatusReader("running"), makeLogger(), ui);
    expect(refreshSpy).toHaveBeenCalledOnce();
    expect(ui.shownInfo[0]).toMatch(/loading from the language server/);
  });

  it("surfaces a warning when sections exist but contain no entries", async () => {
    const cache = makeFakeCache([{ title: "T", important: false, entries: [] }]);
    const ui = makeFakeUi();
    await browseIsabelleDocumentation(cache, makeStatusReader("running"), makeLogger(), ui);
    expect(ui.shownWarning[0]).toMatch(/no documentation entries/);
  });

  it("shows a quick-pick with one item per entry, important-first", async () => {
    const cache = makeFakeCache([
      { title: "B-NotImportant", important: false, entries: [{ label: "B1", printHtml: "", platformPath: "/B1.pdf" }] },
      { title: "A-Important", important: true, entries: [{ label: "A1", printHtml: "", platformPath: "/A1.pdf" }] }
    ]);
    const ui = makeFakeUi(0);
    await browseIsabelleDocumentation(cache, makeStatusReader("running"), makeLogger(), ui);
    expect(ui.capturedPickItems.items.map((p) => p.label)).toEqual(["A1", "B1"]);
    expect(ui.capturedPickItems.items[0].description).toContain("★");
  });

  it("opens the selected entry via the OS default when the user picks one", async () => {
    const cache = makeFakeCache([
      { title: "T", important: true, entries: [{ label: "Tutorial", printHtml: "", platformPath: "C:/iso/Tutorial.pdf" }] }
    ]);
    const ui = makeFakeUi(0);
    await browseIsabelleDocumentation(cache, makeStatusReader("running"), makeLogger(), ui);
    expect(ui.openedPaths).toEqual(["C:/iso/Tutorial.pdf"]);
  });

  it("does nothing further when the user cancels the quick-pick", async () => {
    const cache = makeFakeCache([
      { title: "T", important: true, entries: [{ label: "Tutorial", printHtml: "", platformPath: "/Tutorial.pdf" }] }
    ]);
    const ui = makeFakeUi(undefined);
    await browseIsabelleDocumentation(cache, makeStatusReader("running"), makeLogger(), ui);
    expect(ui.openedPaths).toEqual([]);
    expect(ui.shownWarning).toEqual([]);
  });

  it("surfaces a warning when openExternalFile returns false", async () => {
    const cache = makeFakeCache([
      { title: "T", important: true, entries: [{ label: "Tutorial", printHtml: "", platformPath: "/Tutorial.pdf" }] }
    ]);
    const ui = makeFakeUi(0, false);
    await browseIsabelleDocumentation(cache, makeStatusReader("running"), makeLogger(), ui);
    expect(ui.shownWarning[0]).toMatch(/Failed to open Tutorial/);
  });

  it("logs and surfaces a warning when openExternalFile throws", async () => {
    const cache = makeFakeCache([
      { title: "T", important: true, entries: [{ label: "Tutorial", printHtml: "", platformPath: "/Tutorial.pdf" }] }
    ]);
    const logger = makeLogger();
    const shownWarning: string[] = [];
    const ui: ShowDocumentationUi = {
      showQuickPick: async (items) => items[0],
      showInformationMessage: async () => undefined,
      showWarningMessage: async (m: string) => {
        shownWarning.push(m);
        return undefined;
      },
      openExternalFile: async () => {
        throw new Error("boom");
      }
    };
    await browseIsabelleDocumentation(cache, makeStatusReader("running"), logger, ui);
    expect(shownWarning[0]).toMatch(/boom/);
    expect(logger.lines.some((l) => l.includes("openExternal"))).toBe(true);
  });
});
