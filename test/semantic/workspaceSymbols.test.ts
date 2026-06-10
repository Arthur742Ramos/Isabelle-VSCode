import { describe, expect, it } from "vitest";
import {
  matchScore,
  matchWorkspaceSymbols,
  workspaceSymbolKind,
  WorkspaceSymbolEntity
} from "../../src/semantic/workspaceSymbols";
import { IsabelleEntityKind, THEORY_ENTITY_KINDS } from "../../src/semantic/theoryEntities";

function entity(name: string, uri: string, kind: IsabelleEntityKind = "lemma", line = 0): WorkspaceSymbolEntity {
  return {
    name,
    kind,
    uri,
    spanId: `${uri}:0:${line}`,
    range: { start: { line, character: 0 }, end: { line, character: name.length } }
  };
}

describe("matchScore", () => {
  it("ranks prefix < substring < subsequence < no-match", () => {
    expect(matchScore("foo", "foobar")).toBe(0); // prefix
    expect(matchScore("bar", "foobar")).toBe(1); // substring
    expect(matchScore("fb", "foobar")).toBe(2); // subsequence f..b
    expect(matchScore("xyz", "foobar")).toBeNull(); // no match
  });

  it("is order-sensitive for subsequences", () => {
    expect(matchScore("ba", "abc")).toBeNull(); // b before a not in order
    expect(matchScore("ac", "abc")).toBe(2); // a..c in order
  });
});

describe("matchWorkspaceSymbols", () => {
  const entities = [
    entity("add_commute", "file:///A.thy"),
    entity("add_assoc", "file:///A.thy", "lemma", 5),
    entity("addition", "file:///B.thy", "definition"),
    entity("multiply", "file:///B.thy", "definition", 2),
    entity("list", "file:///C.thy", "datatype")
  ];

  it("returns everything (alphabetised) for a blank query", () => {
    const result = matchWorkspaceSymbols("  ", entities).map((e) => e.name);
    expect(result).toEqual(["add_assoc", "add_commute", "addition", "list", "multiply"]);
  });

  it("matches case-insensitively", () => {
    const result = matchWorkspaceSymbols("ADD", entities).map((e) => e.name);
    expect(result).toContain("add_commute");
    expect(result).toContain("addition");
    expect(result).not.toContain("multiply");
  });

  it("ranks prefix matches before scattered subsequence matches", () => {
    // "adn" is a subsequence of "addition" (a-d-...-n) but not a prefix; the
    // names starting with "ad" should still be ordered by score then name.
    const result = matchWorkspaceSymbols("add", entities).map((e) => e.name);
    // all three "add*" are prefix (score 0), ordered alphabetically
    expect(result).toEqual(["add_assoc", "add_commute", "addition"]);
  });

  it("drops non-matches", () => {
    expect(matchWorkspaceSymbols("zzz", entities)).toHaveLength(0);
  });

  it("breaks score ties by shorter/alphabetical name then uri then line", () => {
    const dupes = [
      entity("foo", "file:///B.thy", "lemma", 3),
      entity("foo", "file:///A.thy", "lemma", 1),
      entity("foobar", "file:///A.thy")
    ];
    const result = matchWorkspaceSymbols("foo", dupes);
    // both "foo" are prefix score 0; same name -> ordered by uri (A before B).
    expect(result.map((e) => [e.name, e.uri])).toEqual([
      ["foo", "file:///A.thy"],
      ["foo", "file:///B.thy"],
      ["foobar", "file:///A.thy"]
    ]);
  });
});

describe("workspaceSymbolKind", () => {
  it("maps each entity kind to a non-empty workspace symbol kind", () => {
    for (const kind of THEORY_ENTITY_KINDS) {
      expect(workspaceSymbolKind(kind).length).toBeGreaterThan(0);
    }
  });

  it("uses type-appropriate kinds matching the document-symbol provider", () => {
    expect(workspaceSymbolKind("datatype")).toBe("enum");
    expect(workspaceSymbolKind("codatatype")).toBe("enum");
    expect(workspaceSymbolKind("record")).toBe("struct");
    expect(workspaceSymbolKind("typedef")).toBe("interface");
    expect(workspaceSymbolKind("type_synonym")).toBe("interface");
    expect(workspaceSymbolKind("class")).toBe("class");
    expect(workspaceSymbolKind("locale")).toBe("class");
    expect(workspaceSymbolKind("lemma")).toBe("method");
    expect(workspaceSymbolKind("definition")).toBe("function");
    expect(workspaceSymbolKind("theory")).toBe("module");
    expect(workspaceSymbolKind("section")).toBe("namespace");
  });
});
