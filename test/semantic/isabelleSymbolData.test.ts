import { describe, expect, it } from "vitest";
import { ISABELLE_SYMBOL_TABLE } from "../../src/semantic/isabelleSymbolData";

// Structural-integrity guard for the GENERATED symbol table. The helper
// behaviour is covered by isabelleSymbols.test.ts; this pins the raw data so a
// regeneration mistake (a malformed token, a duplicate, an out-of-range code
// point, a bad abbreviation) fails fast instead of silently corrupting
// highlighting / hovers / symbol conversion.

const SYMBOL_TOKEN = /^\\<\^?[A-Za-z][A-Za-z0-9_']*>$/;

describe("ISABELLE_SYMBOL_TABLE integrity", () => {
  it("is a non-trivial, frozen-shape array", () => {
    expect(Array.isArray(ISABELLE_SYMBOL_TABLE)).toBe(true);
    expect(ISABELLE_SYMBOL_TABLE.length).toBeGreaterThan(400);
  });

  it("gives every entry a well-formed `\\<...>` symbol token", () => {
    for (const entry of ISABELLE_SYMBOL_TABLE) {
      expect(typeof entry.name, JSON.stringify(entry)).toBe("string");
      expect(SYMBOL_TOKEN.test(entry.name), `malformed token: ${JSON.stringify(entry.name)}`).toBe(true);
    }
  });

  it("has no duplicate symbol tokens", () => {
    const names = ISABELLE_SYMBOL_TABLE.map((entry) => entry.name);
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const name of names) {
      if (seen.has(name)) {
        dupes.push(name);
      }
      seen.add(name);
    }
    expect(dupes, `duplicate tokens: ${dupes.join(", ")}`).toEqual([]);
  });

  it("uses only valid Unicode code points (or null for markup symbols)", () => {
    for (const entry of ISABELLE_SYMBOL_TABLE) {
      if (entry.code === null) {
        continue;
      }
      expect(Number.isInteger(entry.code), `non-integer code for ${entry.name}`).toBe(true);
      expect(entry.code, `out-of-range code for ${entry.name}`).toBeGreaterThanOrEqual(0);
      expect(entry.code, `out-of-range code for ${entry.name}`).toBeLessThanOrEqual(0x10ffff);
      // A valid code point must round-trip through String.fromCodePoint without
      // throwing (this is exactly what the resolver does to build the glyph).
      expect(() => String.fromCodePoint(entry.code as number)).not.toThrow();
    }
  });

  it("has no two glyph-bearing symbols sharing the same code point", () => {
    // The reverse glyph→token map relies on this; a collision would make
    // symbolsToAscii ambiguous.
    const byCode = new Map<number, string>();
    for (const entry of ISABELLE_SYMBOL_TABLE) {
      if (entry.code === null) {
        continue;
      }
      const existing = byCode.get(entry.code);
      expect(
        existing,
        `code U+${entry.code.toString(16)} shared by ${existing} and ${entry.name}`
      ).toBeUndefined();
      byCode.set(entry.code, entry.name);
    }
  });

  it("gives every entry a string[] of non-empty abbreviations and a group of string|null", () => {
    for (const entry of ISABELLE_SYMBOL_TABLE) {
      expect(Array.isArray(entry.abbrevs), `abbrevs not an array for ${entry.name}`).toBe(true);
      for (const abbrev of entry.abbrevs) {
        expect(typeof abbrev, `non-string abbrev in ${entry.name}`).toBe("string");
        expect(abbrev.length, `empty abbrev in ${entry.name}`).toBeGreaterThan(0);
      }
      expect(
        entry.group === null || typeof entry.group === "string",
        `bad group for ${entry.name}`
      ).toBe(true);
    }
  });
});
