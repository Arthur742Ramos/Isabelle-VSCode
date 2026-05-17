import { describe, expect, it } from "vitest";
import {
  buildManualPasteBackPrompt,
  MANUAL_PASTE_BACK_CANCEL_ACTION,
  MANUAL_PASTE_BACK_DISPLAY_NAME,
  MANUAL_PASTE_BACK_OPEN_ACTION,
  MANUAL_PASTE_BACK_PROVIDER_ID,
  ManualPasteBackHost,
  ManualPasteBackRepairAiProvider
} from "../../src/repair/ManualPasteBackRepairAiProvider";
import { RepairAiRequest } from "../../src/repair/repairAiProvider";

const REQUEST: RepairAiRequest = {
  requestMarkdown: "# the request\n\nfull bundle here",
  documentUri: "file:///workspace/Demo.thy",
  documentVersion: 7,
  capturedAt: "2026-05-17T12:00:00.000Z"
};

interface FakeHostOptions {
  /** What the prompt returns. Use undefined for dismissal. */
  promptResult?: string | undefined;
  /** What the file picker returns. Use undefined for cancel. */
  pickedPath?: string | undefined;
  /** Synthetic patch text the readTextFile mock returns. */
  fileContent?: string;
  /** Throw on writeClipboard. */
  clipboardError?: Error;
  /** Throw on showInformationMessage. */
  promptError?: Error;
  /** Throw on showPatchOpenDialog. */
  pickerError?: Error;
  /** Throw on readTextFile. */
  readError?: Error;
}

function makeHost(opts: FakeHostOptions = {}): {
  host: ManualPasteBackHost;
  calls: { method: string; args: unknown[] }[];
} {
  const calls: { method: string; args: unknown[] }[] = [];
  const host: ManualPasteBackHost = {
    async writeClipboard(text) {
      calls.push({ method: "writeClipboard", args: [text] });
      if (opts.clipboardError) throw opts.clipboardError;
    },
    async showInformationMessage(message, ...actions) {
      calls.push({ method: "showInformationMessage", args: [message, ...actions] });
      if (opts.promptError) throw opts.promptError;
      return opts.promptResult;
    },
    async showPatchOpenDialog() {
      calls.push({ method: "showPatchOpenDialog", args: [] });
      if (opts.pickerError) throw opts.pickerError;
      return opts.pickedPath;
    },
    async readTextFile(p) {
      calls.push({ method: "readTextFile", args: [p] });
      if (opts.readError) throw opts.readError;
      return opts.fileContent ?? "";
    }
  };
  return { host, calls };
}

describe("buildManualPasteBackPrompt", () => {
  it("mentions the URI, version, and capturedAt timestamp from the request", () => {
    const prompt = buildManualPasteBackPrompt(REQUEST);
    expect(prompt).toContain("file:///workspace/Demo.thy");
    expect(prompt).toContain("v7");
    expect(prompt).toContain("2026-05-17T12:00:00.000Z");
  });

  it("names the open-patch action so the prompt and provider stay in sync", () => {
    const prompt = buildManualPasteBackPrompt(REQUEST);
    expect(prompt).toContain(MANUAL_PASTE_BACK_OPEN_ACTION);
  });

  it("mentions that the patch will go through the existing preview pipeline", () => {
    // Important contract: this provider does NOT auto-apply. The
    // prompt is the right place to remind the user that the
    // existing safety pipeline still validates anything they paste
    // back.
    expect(buildManualPasteBackPrompt(REQUEST)).toMatch(/previewRepairPatch/);
  });
});

describe("ManualPasteBackRepairAiProvider", () => {
  it("declares the canonical id and display name", () => {
    const provider = new ManualPasteBackRepairAiProvider(makeHost().host);
    expect(provider.id).toBe(MANUAL_PASTE_BACK_PROVIDER_ID);
    expect(provider.displayName).toBe(MANUAL_PASTE_BACK_DISPLAY_NAME);
  });

  it("happy path: writes the request to the clipboard, prompts, reads the chosen file, returns its content", async () => {
    const { host, calls } = makeHost({
      promptResult: MANUAL_PASTE_BACK_OPEN_ACTION,
      pickedPath: "/tmp/proposed.patch",
      fileContent: "--- a\n+++ b\n@@\n-old\n+new\n"
    });
    const provider = new ManualPasteBackRepairAiProvider(host);
    const result = await provider.generatePatch(REQUEST);
    expect(result).toEqual({
      ok: true,
      patchText: "--- a\n+++ b\n@@\n-old\n+new\n",
      providerRunId: `${MANUAL_PASTE_BACK_PROVIDER_ID}:${REQUEST.capturedAt}`
    });
    expect(calls.map((c) => c.method)).toEqual([
      "writeClipboard",
      "showInformationMessage",
      "showPatchOpenDialog",
      "readTextFile"
    ]);
    expect(calls[0].args[0]).toBe(REQUEST.requestMarkdown);
    expect(calls[3].args[0]).toBe("/tmp/proposed.patch");
  });

  it("returns a typed failure if writeClipboard throws", async () => {
    const { host } = makeHost({
      clipboardError: new Error("clipboard locked")
    });
    const provider = new ManualPasteBackRepairAiProvider(host);
    const result = await provider.generatePatch(REQUEST);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/clipboard locked/);
    }
  });

  it("returns a typed failure when the user dismisses the prompt", async () => {
    const { host, calls } = makeHost({ promptResult: undefined });
    const provider = new ManualPasteBackRepairAiProvider(host);
    const result = await provider.generatePatch(REQUEST);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/cancelled before a patch file was chosen/);
    }
    // We do NOT proceed to the picker after a dismissal.
    expect(calls.map((c) => c.method)).not.toContain("showPatchOpenDialog");
  });

  it("returns a typed failure when the user clicks the explicit Cancel action", async () => {
    const { host } = makeHost({ promptResult: MANUAL_PASTE_BACK_CANCEL_ACTION });
    const provider = new ManualPasteBackRepairAiProvider(host);
    const result = await provider.generatePatch(REQUEST);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/cancelled/);
    }
  });

  it("returns a typed failure for an unknown prompt action label", async () => {
    // Defensive: future VS Code prompt re-render could return an
    // unexpected label. Don't crash; treat as cancel with detail.
    const { host } = makeHost({ promptResult: "Eat lunch" });
    const provider = new ManualPasteBackRepairAiProvider(host);
    const result = await provider.generatePatch(REQUEST);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/unexpected action "Eat lunch"/);
    }
  });

  it("returns a typed failure when the file picker is cancelled", async () => {
    const { host } = makeHost({
      promptResult: MANUAL_PASTE_BACK_OPEN_ACTION,
      pickedPath: undefined
    });
    const provider = new ManualPasteBackRepairAiProvider(host);
    const result = await provider.generatePatch(REQUEST);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/no patch file chosen/);
    }
  });

  it("returns a typed failure when readTextFile throws", async () => {
    const { host } = makeHost({
      promptResult: MANUAL_PASTE_BACK_OPEN_ACTION,
      pickedPath: "/tmp/missing.patch",
      readError: new Error("ENOENT")
    });
    const provider = new ManualPasteBackRepairAiProvider(host);
    const result = await provider.generatePatch(REQUEST);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/unable to read \/tmp\/missing\.patch/);
      expect(result.reason).toMatch(/ENOENT/);
    }
  });

  it("rejects an empty patch file with a descriptive reason", async () => {
    const { host } = makeHost({
      promptResult: MANUAL_PASTE_BACK_OPEN_ACTION,
      pickedPath: "/tmp/empty.patch",
      fileContent: "  \n  \n"
    });
    const provider = new ManualPasteBackRepairAiProvider(host);
    const result = await provider.generatePatch(REQUEST);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/\/tmp\/empty\.patch was empty/);
    }
  });

  it("honours an abort signal that fires before the run starts", async () => {
    const { host, calls } = makeHost();
    const provider = new ManualPasteBackRepairAiProvider(host);
    const controller = new AbortController();
    controller.abort();
    const result = await provider.generatePatch(REQUEST, controller.signal);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/Aborted before manual paste-back started/);
    }
    expect(calls.length).toBe(0);
  });

  it("honours an abort signal that fires after the prompt", async () => {
    // Abort right after the prompt resolves but before we run the
    // picker. We simulate this by aborting from inside the prompt
    // mock.
    const { calls } = makeHost();
    void calls;
    const controller = new AbortController();
    const host: ManualPasteBackHost = {
      async writeClipboard() {},
      async showInformationMessage() {
        controller.abort();
        return MANUAL_PASTE_BACK_OPEN_ACTION;
      },
      async showPatchOpenDialog() {
        throw new Error("should not be called after abort");
      },
      async readTextFile() {
        throw new Error("should not be called after abort");
      }
    };
    const provider = new ManualPasteBackRepairAiProvider(host);
    const result = await provider.generatePatch(REQUEST, controller.signal);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/Aborted after the prompt was shown/);
    }
  });

  it("converts a showInformationMessage throw into a typed failure", async () => {
    const { host } = makeHost({ promptError: new Error("vscode crashed") });
    const provider = new ManualPasteBackRepairAiProvider(host);
    const result = await provider.generatePatch(REQUEST);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/prompt failed: vscode crashed/);
    }
  });

  it("converts a showPatchOpenDialog throw into a typed failure", async () => {
    const { host } = makeHost({
      promptResult: MANUAL_PASTE_BACK_OPEN_ACTION,
      pickerError: new Error("file picker crashed")
    });
    const provider = new ManualPasteBackRepairAiProvider(host);
    const result = await provider.generatePatch(REQUEST);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/file picker failed: file picker crashed/);
    }
  });
});
