import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "..", "..");

function ignoreEntries(file: string): Set<string> {
  return new Set(
    readFileSync(resolve(root, file), "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"))
  );
}

const universal = ignoreEntries(".vscodeignore");
const platform = ignoreEntries(".vscodeignore.platform");

// Contributor- and agent-facing files that should never ship in the VSIX.
const CONTRIBUTOR_ONLY = ["AGENTS.md", "docs/**", "skills/**", "scripts/**"];

describe(".vscodeignore packaging hygiene", () => {
  it("excludes contributor- and agent-facing docs from the package", () => {
    for (const pattern of CONTRIBUTOR_ONLY) {
      expect(universal.has(pattern), `.vscodeignore should exclude ${pattern}`).toBe(true);
    }
  });

  it("keeps the per-platform ignore file in sync with the universal one (only jre/** differs)", () => {
    // The platform manifest mirrors the universal one but must NOT exclude the
    // bundled per-platform JRE; every other exclusion has to match exactly.
    expect(universal.has("jre/**"), ".vscodeignore should exclude jre/**").toBe(true);
    expect(platform.has("jre/**"), ".vscodeignore.platform must NOT exclude jre/**").toBe(false);

    const universalWithoutJre = new Set(universal);
    universalWithoutJre.delete("jre/**");
    expect([...universalWithoutJre].sort()).toEqual([...platform].sort());
  });

  it("still ships the user-facing assets needed at runtime", () => {
    // Guard against over-eager exclusion: these must NOT be ignored.
    for (const required of ["media/walkthrough", "examples", "out/extension.js", "language-configuration.json"]) {
      for (const ignored of universal) {
        expect(
          ignored === required || ignored.startsWith(`${required}/`),
          `${required} must not be excluded (found ${ignored})`
        ).toBe(false);
      }
    }
  });
});
