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

// Concrete files that MUST ship for the extension to work at runtime.
const REQUIRED_RUNTIME_FILES = [
  "out/extension.js",
  "package.json",
  "language-configuration.json",
  "syntaxes/isabelle.tmLanguage.json",
  "media/icon.png",
  "media/walkthrough/open-theory.md",
  "examples/Smoke.thy"
];

/**
 * Translate a `.vscodeignore` glob to an anchored RegExp so the test can detect
 * whether a pattern (including broad globs like `media/**`, `out/**`, or
 * `**\/*.js`) would exclude a required runtime file.
 */
function globToRegExp(glob: string): RegExp {
  let source = "";
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === "*") {
      if (glob[i + 1] === "*") {
        source += ".*";
        i++;
        if (glob[i + 1] === "/") {
          i++;
        }
      } else {
        source += "[^/]*";
      }
    } else if (".+^${}()|[]\\".includes(char)) {
      source += `\\${char}`;
    } else {
      source += char;
    }
  }
  return new RegExp(`^${source}$`);
}

function excludesFile(pattern: string, file: string): boolean {
  return globToRegExp(pattern).test(file);
}

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
    // Guard against over-eager exclusion, including broad globs (`media/**`,
    // `out/**`, `**/*.js`) that would still drop a required file.
    for (const file of REQUIRED_RUNTIME_FILES) {
      for (const pattern of universal) {
        expect(
          excludesFile(pattern, file),
          `${file} must ship, but .vscodeignore pattern "${pattern}" excludes it`
        ).toBe(false);
      }
    }
  });

  it("uses a glob matcher that recognizes broad excludes", () => {
    // Sanity-check the matcher so the runtime-assets guard above is meaningful.
    expect(excludesFile("media/**", "media/icon.png")).toBe(true);
    expect(excludesFile("out/**", "out/extension.js")).toBe(true);
    expect(excludesFile("**/*.js", "out/extension.js")).toBe(true);
    expect(excludesFile("out/test/**", "out/extension.js")).toBe(false);
    expect(excludesFile("out/**/*.map", "out/extension.js")).toBe(false);
  });
});
