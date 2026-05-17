import { describe, expect, it } from "vitest";
import {
  EXCLUDE_WORD_COMMAND_ID,
  EXCLUDE_WORD_PERMANENTLY_COMMAND_ID,
  INCLUDE_WORD_COMMAND_ID,
  INCLUDE_WORD_PERMANENTLY_COMMAND_ID,
  PIDE_CARET_UPDATE_METHOD,
  PIDE_EXCLUDE_WORD_METHOD,
  PIDE_EXCLUDE_WORD_PERMANENTLY_METHOD,
  PIDE_INCLUDE_WORD_METHOD,
  PIDE_INCLUDE_WORD_PERMANENTLY_METHOD,
  PIDE_RESET_WORDS_METHOD,
  RESET_WORDS_COMMAND_ID,
  SpellCheckerCaretEditor,
  SpellCheckerClient,
  SpellCheckerLogger,
  SpellCheckerLspStatusReader,
  SpellCheckerUi,
  SpellCheckerWordAction,
  dispatchResetWords,
  dispatchSpellCheckerWord
} from "../../src/api/spellCheckerCommands";
import { IsabelleLanguageServerStatus } from "../../src/lsp/lspTypes";

function makeStatusReader(state: IsabelleLanguageServerStatus["state"]): SpellCheckerLspStatusReader {
  return { getStatus: () => ({ state }) };
}

interface FakeClient extends SpellCheckerClient {
  readonly sent: { method: string; params?: unknown }[];
  throwOnSend: boolean;
}

function makeFakeClient(throwOnSend = false): FakeClient {
  const sent: { method: string; params?: unknown }[] = [];
  return {
    sent,
    throwOnSend,
    sendNotification: function (method: string, params?: unknown) {
      if (this.throwOnSend) throw new Error("send blew up");
      sent.push({ method, params });
    }
  };
}

interface FakeUi extends SpellCheckerUi {
  readonly infoMessages: string[];
}

function makeFakeUi(editor: SpellCheckerCaretEditor | undefined): FakeUi {
  const infoMessages: string[] = [];
  return {
    infoMessages,
    getActiveEditor: () => editor,
    showInformationMessage: async (m: string) => {
      infoMessages.push(m);
      return undefined;
    }
  };
}

function makeLogger(): SpellCheckerLogger & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    appendLine: (m: string) => lines.push(m)
  };
}

const THEORY_EDITOR: SpellCheckerCaretEditor = {
  uri: "file:///abs/Foo.thy",
  isTheoryDocument: true,
  line: 3,
  character: 5
};

const NON_THEORY_EDITOR: SpellCheckerCaretEditor = {
  uri: "file:///abs/README.md",
  isTheoryDocument: false,
  line: 0,
  character: 0
};

describe("dispatchSpellCheckerWord — guards", () => {
  for (const action of [
    "include",
    "include-permanently",
    "exclude",
    "exclude-permanently"
  ] as const) {
    it(`(${action}) surfaces info and returns lsp-not-running when LSP is not running`, async () => {
      const client = makeFakeClient();
      const ui = makeFakeUi(THEORY_EDITOR);
      const result = await dispatchSpellCheckerWord(
        action,
        client,
        makeStatusReader("disabled"),
        ui,
        makeLogger()
      );
      expect(result).toEqual({ dispatched: false, reason: "lsp-not-running" });
      expect(ui.infoMessages[0]).toMatch(/language server/);
      expect(client.sent).toEqual([]);
    });
  }

  it("surfaces info when there is no active editor", async () => {
    const client = makeFakeClient();
    const ui = makeFakeUi(undefined);
    const result = await dispatchSpellCheckerWord(
      "include",
      client,
      makeStatusReader("running"),
      ui,
      makeLogger()
    );
    expect(result).toEqual({ dispatched: false, reason: "no-editor" });
    expect(ui.infoMessages[0]).toMatch(/Open an Isabelle theory/);
    expect(client.sent).toEqual([]);
  });

  it("surfaces info when active editor is not an Isabelle theory", async () => {
    const client = makeFakeClient();
    const ui = makeFakeUi(NON_THEORY_EDITOR);
    const result = await dispatchSpellCheckerWord(
      "include",
      client,
      makeStatusReader("running"),
      ui,
      makeLogger()
    );
    expect(result).toEqual({ dispatched: false, reason: "not-theory-document" });
    expect(ui.infoMessages[0]).toMatch(/only apply to `\.thy` files/);
    expect(client.sent).toEqual([]);
  });
});

describe("dispatchSpellCheckerWord — success path", () => {
  const ACTION_TO_METHOD: Record<SpellCheckerWordAction, string> = {
    include: PIDE_INCLUDE_WORD_METHOD,
    "include-permanently": PIDE_INCLUDE_WORD_PERMANENTLY_METHOD,
    exclude: PIDE_EXCLUDE_WORD_METHOD,
    "exclude-permanently": PIDE_EXCLUDE_WORD_PERMANENTLY_METHOD
  };

  for (const [action, expectedMethod] of Object.entries(ACTION_TO_METHOD) as [
    SpellCheckerWordAction,
    string
  ][]) {
    it(`(${action}) sends PIDE/caret_update followed by ${expectedMethod}`, async () => {
      const client = makeFakeClient();
      const ui = makeFakeUi(THEORY_EDITOR);
      const result = await dispatchSpellCheckerWord(
        action,
        client,
        makeStatusReader("running"),
        ui,
        makeLogger()
      );
      expect(result.dispatched).toBe(true);
      expect(result.method).toBe(expectedMethod);
      expect(client.sent).toEqual([
        {
          method: PIDE_CARET_UPDATE_METHOD,
          params: {
            uri: "file:///abs/Foo.thy",
            line: 3,
            character: 5,
            focus: true
          }
        },
        { method: expectedMethod, params: undefined }
      ]);
    });
  }

  it("returns client-error and logs when sendNotification throws", async () => {
    const client = makeFakeClient(true);
    const logger = makeLogger();
    const ui = makeFakeUi(THEORY_EDITOR);
    const result = await dispatchSpellCheckerWord(
      "include",
      client,
      makeStatusReader("running"),
      ui,
      logger
    );
    expect(result).toEqual({ dispatched: false, reason: "client-error" });
    expect(logger.lines.some((l) => l.includes("failed to dispatch"))).toBe(true);
  });
});

describe("dispatchResetWords", () => {
  it("sends PIDE/reset_words without any caret update", async () => {
    const client = makeFakeClient();
    const result = await dispatchResetWords(
      client,
      makeStatusReader("running"),
      makeFakeUi(undefined),
      makeLogger()
    );
    expect(result).toEqual({ dispatched: true, method: PIDE_RESET_WORDS_METHOD });
    expect(client.sent).toEqual([{ method: PIDE_RESET_WORDS_METHOD, params: undefined }]);
  });

  it("surfaces info and returns lsp-not-running when LSP is not running", async () => {
    const client = makeFakeClient();
    const ui = makeFakeUi(undefined);
    const result = await dispatchResetWords(
      client,
      makeStatusReader("starting"),
      ui,
      makeLogger()
    );
    expect(result).toEqual({ dispatched: false, reason: "lsp-not-running" });
    expect(ui.infoMessages[0]).toMatch(/language server/);
    expect(client.sent).toEqual([]);
  });

  it("returns client-error and logs when sendNotification throws", async () => {
    const client = makeFakeClient(true);
    const logger = makeLogger();
    const result = await dispatchResetWords(
      client,
      makeStatusReader("running"),
      makeFakeUi(undefined),
      logger
    );
    expect(result).toEqual({ dispatched: false, reason: "client-error" });
    expect(logger.lines.some((l) => l.includes("failed to dispatch"))).toBe(true);
  });

  it("does NOT consult the active editor (reset is global)", async () => {
    const client = makeFakeClient();
    let editorAccessed = false;
    const ui: SpellCheckerUi = {
      getActiveEditor: () => {
        editorAccessed = true;
        return undefined;
      },
      showInformationMessage: async () => undefined
    };
    await dispatchResetWords(client, makeStatusReader("running"), ui, makeLogger());
    expect(editorAccessed).toBe(false);
  });
});

describe("public command id contract", () => {
  it("exposes stable command IDs that match the package.json contributions", () => {
    expect(INCLUDE_WORD_COMMAND_ID).toBe("isabelle.includeWord");
    expect(INCLUDE_WORD_PERMANENTLY_COMMAND_ID).toBe("isabelle.includeWordPermanently");
    expect(EXCLUDE_WORD_COMMAND_ID).toBe("isabelle.excludeWord");
    expect(EXCLUDE_WORD_PERMANENTLY_COMMAND_ID).toBe("isabelle.excludeWordPermanently");
    expect(RESET_WORDS_COMMAND_ID).toBe("isabelle.resetWords");
  });
});
