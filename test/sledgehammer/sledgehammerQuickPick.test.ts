import { describe, expect, it } from "vitest";
import { SledgehammerSuggestion } from "../../src/protocol/messages";
import {
  SledgehammerQuickPickItem,
  buildSledgehammerQuickPickItems
} from "../../src/sledgehammer/sledgehammerQuickPick";

function suggestion(
  overrides: Partial<SledgehammerSuggestion> = {}
): SledgehammerSuggestion {
  return {
    proofText: "by auto",
    ...overrides
  };
}

describe("buildSledgehammerQuickPickItems", () => {
  it("returns an empty array for no suggestions", () => {
    expect(buildSledgehammerQuickPickItems([])).toEqual([]);
  });

  it("uses the suggestion label when present", () => {
    const items = buildSledgehammerQuickPickItems([
      suggestion({ label: "metis proof", proofText: "by metis" })
    ]);
    expect(items[0].label).toBe("metis proof");
  });

  it("falls back to 'Suggestion N' (1-based) when no label is given", () => {
    const items = buildSledgehammerQuickPickItems([
      suggestion({ proofText: "by auto" }),
      suggestion({ proofText: "by blast" })
    ]);
    expect(items.map((item) => item.label)).toEqual([
      "Suggestion 1",
      "Suggestion 2"
    ]);
  });

  it("populates index with the 0-based position in the input array", () => {
    const items = buildSledgehammerQuickPickItems([
      suggestion({ proofText: "a" }),
      suggestion({ proofText: "b" }),
      suggestion({ proofText: "c" })
    ]);
    expect(items.map((item) => item.index)).toEqual([0, 1, 2]);
  });

  it("surfaces the trimmed proof text as the detail column", () => {
    const items = buildSledgehammerQuickPickItems([
      suggestion({ proofText: "   by auto   " })
    ]);
    expect(items[0].detail).toBe("by auto");
  });

  it("leaves detail undefined when the proof text is empty / whitespace-only", () => {
    const items = buildSledgehammerQuickPickItems([
      suggestion({ proofText: "" }),
      suggestion({ proofText: "   \n   " })
    ]);
    expect(items[0].detail).toBeUndefined();
    expect(items[1].detail).toBeUndefined();
  });

  it("uses method as the description when it adds info beyond the proof text", () => {
    const items = buildSledgehammerQuickPickItems([
      suggestion({ method: "metis", proofText: "by (metis foo)" })
    ]);
    expect(items[0].description).toBe("metis");
  });

  it("omits the description when method matches proof text exactly", () => {
    // Avoid duplicating the same string in two columns of the picker.
    const items = buildSledgehammerQuickPickItems([
      suggestion({ method: "by auto", proofText: "by auto" })
    ]);
    expect(items[0].description).toBeUndefined();
  });

  it("omits the description when method is missing or whitespace-only", () => {
    const items = buildSledgehammerQuickPickItems([
      suggestion({ proofText: "by blast" }),
      suggestion({ method: "   ", proofText: "by force" })
    ]);
    expect(items[0].description).toBeUndefined();
    expect(items[1].description).toBeUndefined();
  });

  it("preserves the original input order across all fields", () => {
    const items: readonly SledgehammerQuickPickItem[] =
      buildSledgehammerQuickPickItems([
        suggestion({ label: "first", proofText: "by auto" }),
        suggestion({ label: "second", proofText: "by blast" }),
        suggestion({ label: "third", proofText: "by force" })
      ]);
    expect(items).toEqual([
      { label: "first", description: undefined, detail: "by auto", index: 0 },
      { label: "second", description: undefined, detail: "by blast", index: 1 },
      { label: "third", description: undefined, detail: "by force", index: 2 }
    ]);
  });
});
