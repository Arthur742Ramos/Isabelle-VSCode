import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const packageJsonPath = resolve(__dirname, "..", "..", "package.json");

interface ConfigurationProperty {
  type?: string | string[];
  description?: string;
  markdownDescription?: string;
  minimum?: number;
  maximum?: number;
  default?: unknown;
}

interface PackageJson {
  contributes?: {
    configuration?: {
      title?: string;
      properties?: Record<string, ConfigurationProperty>;
    };
  };
}

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as PackageJson;
const properties = packageJson.contributes?.configuration?.properties ?? {};
const entries = Object.entries(properties);

/** Markdown that renders as literal text in a plain `description` field. */
const MARKDOWN_PATTERN = /`|\*\*|\[[^\]]+\]\([^)]+\)/;
/** A closing HTML-like tag — never valid in Isabelle symbol escapes (`\<open>`). */
const STRAY_HTML_CLOSE_TAG = /<\/[A-Za-z]/;

function helpText(property: ConfigurationProperty): string {
  return property.markdownDescription ?? property.description ?? "";
}

describe("configuration contribution manifest", () => {
  it("contributes a non-trivial, titled settings section", () => {
    expect(entries.length).toBeGreaterThan(0);
    expect(packageJson.contributes?.configuration?.title).toBeTruthy();
  });

  it("documents every setting with non-empty help text", () => {
    for (const [key, property] of entries) {
      expect(helpText(property).trim().length, `${key} should have help text`).toBeGreaterThan(0);
    }
  });

  it("never sets both description and markdownDescription on one setting", () => {
    for (const [key, property] of entries) {
      const hasBoth = property.description !== undefined && property.markdownDescription !== undefined;
      expect(hasBoth, `${key} should not define both description and markdownDescription`).toBe(false);
    }
  });

  it("uses markdownDescription for any setting whose help text contains Markdown", () => {
    for (const [key, property] of entries) {
      if (property.description !== undefined && MARKDOWN_PATTERN.test(property.description)) {
        expect.fail(
          `${key} uses a plain "description" containing Markdown (backticks/bold/links) that renders ` +
            `literally in the Settings UI; switch it to "markdownDescription".`
        );
      }
    }
  });

  it("never embeds stray HTML-like closing tags in help text", () => {
    for (const [key, property] of entries) {
      expect(
        STRAY_HTML_CLOSE_TAG.test(helpText(property)),
        `${key} help text contains a stray HTML-like closing tag`
      ).toBe(false);
    }
  });

  it("bounds every numeric setting with a minimum", () => {
    for (const [key, property] of entries) {
      const isNumber = property.type === "number" || property.type === "integer";
      if (isNumber) {
        expect(typeof property.minimum, `${key} (number) should declare a numeric minimum`).toBe("number");
        if (property.maximum !== undefined) {
          expect(property.maximum, `${key} maximum should exceed its minimum`).toBeGreaterThan(
            property.minimum as number
          );
        }
      }
    }
  });
});
