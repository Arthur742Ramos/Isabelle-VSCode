import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "..", "..");

interface SnippetEntry {
  prefix: string | string[];
  body: string | string[];
  description?: string;
}

const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
  contributes?: { snippets?: Array<{ language: string; path: string }> };
};

const snippetContribution = (packageJson.contributes?.snippets ?? []).find(
  (entry) => entry.language === "isabelle"
);

const snippets: Record<string, SnippetEntry> = snippetContribution
  ? (JSON.parse(readFileSync(resolve(root, snippetContribution.path), "utf8")) as Record<string, SnippetEntry>)
  : {};

const entries = Object.entries(snippets);

function bodyText(body: string | string[]): string {
  return Array.isArray(body) ? body.join("\n") : body;
}

function prefixes(prefix: string | string[]): string[] {
  return Array.isArray(prefix) ? prefix : [prefix];
}

describe("Isabelle snippets manifest", () => {
  it("is contributed for the isabelle language with a real file", () => {
    expect(snippetContribution, "package.json should contribute isabelle snippets").toBeDefined();
    expect(entries.length).toBeGreaterThan(10);
  });

  it("gives every snippet a non-empty prefix, body, and description", () => {
    for (const [name, snippet] of entries) {
      expect(prefixes(snippet.prefix).length, `${name} prefix`).toBeGreaterThan(0);
      for (const prefix of prefixes(snippet.prefix)) {
        expect(prefix.trim().length, `${name} prefix is non-empty`).toBeGreaterThan(0);
      }
      expect(bodyText(snippet.body).length, `${name} body`).toBeGreaterThan(0);
      expect((snippet.description ?? "").trim().length, `${name} description`).toBeGreaterThan(0);
    }
  });

  it("keeps every snippet prefix unique", () => {
    const seen = new Map<string, string>();
    for (const [name, snippet] of entries) {
      for (const prefix of prefixes(snippet.prefix)) {
        expect(seen.has(prefix), `prefix "${prefix}" is duplicated (${seen.get(prefix)} and ${name})`).toBe(false);
        seen.set(prefix, name);
      }
    }
  });

  it("includes the core authoring constructs", () => {
    const allPrefixes = new Set(entries.flatMap(([, snippet]) => prefixes(snippet.prefix)));
    for (const required of ["theory", "lemma", "theorem", "fun", "definition", "datatype", "proof"]) {
      expect(allPrefixes.has(required), `missing core snippet prefix "${required}"`).toBe(true);
    }
  });

  it("includes the broader specification constructs", () => {
    const allPrefixes = new Set(entries.flatMap(([, snippet]) => prefixes(snippet.prefix)));
    for (const required of [
      "type_synonym",
      "typedef",
      "function",
      "primcorec",
      "codatatype",
      "lift_definition",
      "class",
      "instantiation",
      "interpretation",
      "notepad"
    ]) {
      expect(allPrefixes.has(required), `missing specification snippet prefix "${required}"`).toBe(true);
    }
  });

  it("has a final tab stop ($0) wherever it uses numbered tab stops", () => {
    for (const [name, snippet] of entries) {
      const body = bodyText(snippet.body);
      const usesNumbered = /\$\{?\d/.test(body);
      if (usesNumbered) {
        expect(body.includes("$0"), `${name} should provide a final $0 cursor`).toBe(true);
      }
    }
  });

  it("closes every ${...} tab-stop placeholder (nesting-aware)", () => {
    // Walk the body tracking placeholder depth: `${` opens, `}` closes. This
    // catches an unclosed `${...` directly, rather than just comparing counts
    // (which a literal `}` elsewhere could mask).
    for (const [name, snippet] of entries) {
      const body = bodyText(snippet.body);
      let depth = 0;
      let minDepth = 0;
      for (let i = 0; i < body.length; i++) {
        if (body[i] === "$" && body[i + 1] === "{") {
          depth += 1;
          i += 1;
        } else if (body[i] === "}" && depth > 0) {
          depth -= 1;
        }
        minDepth = Math.min(minDepth, depth);
      }
      expect(depth, `${name} has an unclosed \${...} placeholder`).toBe(0);
      expect(minDepth, `${name} placeholder nesting underflowed`).toBe(0);
    }
  });

  it("uses the file-name default for the theory skeleton", () => {
    const theory = snippets["Theory file skeleton"];
    expect(theory).toBeDefined();
    expect(bodyText(theory.body)).toContain("${TM_FILENAME_BASE}");
    expect(bodyText(theory.body)).toContain("begin");
    expect(bodyText(theory.body)).toContain("end");
  });
});
