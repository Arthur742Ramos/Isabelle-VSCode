import { describe, expect, it } from "vitest";
import { findSymbolEscapeRange } from "../../src/semantic/ranges";

describe("findSymbolEscapeRange", () => {
  it("finds symbol escapes at positions inside the half-open range", () => {
    expect(findSymbolEscapeRange("x \\<forall> y", 3)).toEqual({ start: 2, end: 11 });
    expect(findSymbolEscapeRange("x \\<forall> y", 10)).toEqual({ start: 2, end: 11 });
  });

  it("does not include the character after the symbol escape", () => {
    expect(findSymbolEscapeRange("x \\<forall> y", 11)).toBeUndefined();
  });
});
