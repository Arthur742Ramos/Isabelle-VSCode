import { describe, expect, it } from "vitest";
import {
  extractWalkthroughCommandLinks,
  findDriftCounts,
  hasDanglingRecheckProse,
  meetsMinimum,
  parseIsabelleYear,
  parseJavaMajor,
  parseNodeMajor,
  parseSbtMajorMinor
} from "../../.github/extensions/isabelle-pide-helpers/helpers.mjs";

// Structural tests for the pure helpers consumed by the Copilot CLI
// extension at .github/extensions/isabelle-pide-helpers/extension.mjs.
//
// The extension itself imports `@github/copilot-sdk` which is resolved by
// the Copilot CLI runtime, not via npm — so we can't load extension.mjs
// directly from vitest. Keeping the parsers / matchers in helpers.mjs
// lets us exercise them under npm run check just like every other module
// in this repo (see AGENTS.md "Test conventions").

describe("parseJavaMajor", () => {
  it("parses modern openjdk output (21)", () => {
    expect(parseJavaMajor('openjdk version "21.0.1" 2023-10-17 LTS')).toBe(21);
  });
  it("parses Oracle 17", () => {
    expect(parseJavaMajor('java version "17.0.10" 2024-01-16 LTS')).toBe(17);
  });
  it("parses legacy 1.8 as 8", () => {
    expect(parseJavaMajor('java version "1.8.0_392"')).toBe(8);
  });
  it("returns undefined for unrecognized output", () => {
    expect(parseJavaMajor("no version here")).toBeUndefined();
  });
  it("returns undefined for empty input", () => {
    expect(parseJavaMajor("")).toBeUndefined();
  });
});

describe("parseNodeMajor", () => {
  it("parses standard v-prefixed output", () => {
    expect(parseNodeMajor("v24.15.0")).toBe(24);
    expect(parseNodeMajor("v20.18.1")).toBe(20);
  });
  it("tolerates leading whitespace and a missing v prefix", () => {
    expect(parseNodeMajor("  22.5.1\n")).toBe(22);
  });
  it("returns undefined for garbage", () => {
    expect(parseNodeMajor("not a version")).toBeUndefined();
    expect(parseNodeMajor("")).toBeUndefined();
  });
});

describe("parseSbtMajorMinor", () => {
  it("parses the common 'sbt version in this project' line", () => {
    expect(parseSbtMajorMinor("sbt version in this project: 1.12.11")).toEqual([1, 12]);
  });
  it("parses 'sbt script version' format", () => {
    expect(parseSbtMajorMinor("sbt script version: 1.10.0")).toEqual([1, 10]);
  });
  it("parses an [info]-prefixed line", () => {
    expect(parseSbtMajorMinor("[info] sbt server version: 1.10.5")).toEqual([1, 10]);
  });
  it("returns undefined when the line is missing", () => {
    expect(parseSbtMajorMinor("not sbt output")).toBeUndefined();
    expect(parseSbtMajorMinor("")).toBeUndefined();
  });
});

describe("parseIsabelleYear", () => {
  it("parses standard `Isabelle2025: October 2025`", () => {
    expect(parseIsabelleYear("Isabelle2025: October 2025")).toBe(2025);
  });
  it("parses 2019 (the minimum supported edition)", () => {
    expect(parseIsabelleYear("Isabelle2019: June 2019")).toBe(2019);
  });
  it("returns undefined when no year is present", () => {
    expect(parseIsabelleYear("Isabelle: development snapshot")).toBeUndefined();
    expect(parseIsabelleYear("")).toBeUndefined();
  });
});

describe("meetsMinimum", () => {
  it("returns true for equal versions", () => {
    expect(meetsMinimum([1, 12], [1, 12])).toBe(true);
  });
  it("returns true for higher major", () => {
    expect(meetsMinimum([2, 0], [1, 12])).toBe(true);
  });
  it("returns true for same major higher minor", () => {
    expect(meetsMinimum([1, 13], [1, 12])).toBe(true);
  });
  it("returns false for lower major", () => {
    expect(meetsMinimum([0, 99], [1, 12])).toBe(false);
  });
  it("returns false for same major lower minor", () => {
    expect(meetsMinimum([1, 11], [1, 12])).toBe(false);
  });
  it("returns false for undefined version", () => {
    expect(meetsMinimum(undefined, [1, 12])).toBe(false);
  });
});

describe("extractWalkthroughCommandLinks", () => {
  it("captures the command id from a simple link", () => {
    const text = "Try [**Re-check**](command:isabelle.checkPrerequisites) now.";
    const links = extractWalkthroughCommandLinks(text);
    expect(links).toHaveLength(1);
    expect(links[0].commandId).toBe("isabelle.checkPrerequisites");
  });
  it("captures a link that carries a query string argument", () => {
    const text = "Click [Run](command:isabelle.runSledgehammer?%5B1%5D) to start.";
    const links = extractWalkthroughCommandLinks(text);
    expect(links).toHaveLength(1);
    expect(links[0].commandId).toBe("isabelle.runSledgehammer");
    expect(links[0].raw).toContain("?%5B1%5D");
  });
  it("captures multiple distinct links", () => {
    const text =
      "First [a](command:isabelle.one) then [b](command:isabelle.two?%7B%7D) and [c](command:isabelle.three).";
    const links = extractWalkthroughCommandLinks(text);
    expect(links.map((l) => l.commandId)).toEqual([
      "isabelle.one",
      "isabelle.two",
      "isabelle.three"
    ]);
  });
  it("returns empty when no command links are present", () => {
    expect(extractWalkthroughCommandLinks("plain text [link](https://x.com)")).toEqual([]);
  });
});

describe("findDriftCounts", () => {
  it("flags the canonical '52 commands' case", () => {
    expect(findDriftCounts("52 commands in the palette")).toEqual([
      { count: "52", noun: "commands" }
    ]);
  });
  it("flags single-digit counts like '5 steps'", () => {
    expect(findDriftCounts("walkthrough has 5 steps total")).toEqual([
      { count: "5", noun: "steps" }
    ]);
  });
  it("flags '639 tests'", () => {
    expect(findDriftCounts("ran the 639 tests successfully")).toEqual([
      { count: "639", noun: "tests" }
    ]);
  });
  it("does NOT flag '1 panel' (singular natural language)", () => {
    expect(findDriftCounts("opens 1 panel automatically")).toEqual([]);
  });
  it("does NOT flag version numbers like 'Isabelle2025' or 'Node 20'", () => {
    expect(findDriftCounts("Isabelle2025 is current")).toEqual([]);
    expect(findDriftCounts("requires Node 20")).toEqual([]);
    expect(findDriftCounts("Java 21+ on PATH")).toEqual([]);
  });
  it("returns multiple findings in one pass", () => {
    const result = findDriftCounts("48 commands across 6 panels and 639 tests");
    expect(result).toEqual([
      { count: "48", noun: "commands" },
      { count: "6", noun: "panels" },
      { count: "639", noun: "tests" }
    ]);
  });
});

describe("hasDanglingRecheckProse", () => {
  it("flags prose when no matching command link is present", () => {
    const text = "Click **Re-check setup** below to refresh.";
    expect(hasDanglingRecheckProse(text)).toBe(true);
  });
  it("does NOT flag prose if a command:isabelle.checkPrerequisites link is also present", () => {
    const text =
      "Click **Re-check setup** below — link: [Re-check](command:isabelle.checkPrerequisites).";
    expect(hasDanglingRecheckProse(text)).toBe(false);
  });
  it("returns false when the prose is absent", () => {
    expect(hasDanglingRecheckProse("nothing relevant here")).toBe(false);
  });
});
