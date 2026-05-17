import * as path from "path";
import { describe, expect, it } from "vitest";
import { extractCommandSpans } from "../../src/document/commandSpans";
import { DiscoveredSession } from "../../src/protocol/messages";
import { extractImportLinks } from "../../src/semantic/documentLinks";
import { findDeclarationByName, findDefinitionByName, wordAt } from "../../src/semantic/definitions";

describe("findDeclarationByName", () => {
  it("finds the nearest previous local declaration by exact name", () => {
    const spans = extractCommandSpans(
      "file:///Definitions.thy",
      [
        "theory Definitions",
        "imports Main",
        "begin",
        "definition answer :: nat where \"answer = 42\"",
        "lemma uses_answer: \"answer = 42\"",
        "  by simp",
        "end"
      ].join("\n"),
      1
    );

    const declaration = findDeclarationByName("answer", spans, { line: 4, character: 21 });

    expect(declaration?.span.kind).toBe("definition");
    expect(declaration?.span.range.start).toEqual({ line: 3, character: 0 });
  });

  it("matches primed Isabelle names exactly", () => {
    const spans = extractCommandSpans(
      "file:///Primed.thy",
      [
        "theory Primed",
        "imports Main",
        "begin",
        "lemma foo': True",
        "  by simp",
        "lemma foo: True",
        "  by simp",
        "end"
      ].join("\n"),
      1
    );

    expect(findDeclarationByName("foo'", spans)?.span.name).toBe("foo'");
    expect(findDeclarationByName("foo", spans)?.span.name).toBe("foo");
  });

  it("does not resolve forward declarations for a positioned lookup", () => {
    const spans = extractCommandSpans(
      "file:///Forward.thy",
      [
        "theory Forward",
        "imports Main",
        "begin",
        "lemma first: later",
        "  sorry",
        "definition later where \"later = True\"",
        "end"
      ].join("\n"),
      1
    );

    expect(findDeclarationByName("later", spans, { line: 3, character: 13 })).toBeUndefined();
  });
});

describe("findDefinitionByName", () => {
  it("prefers a previous local declaration over imported declarations", () => {
    const source = lookupDocument(
      "file:///Local.thy",
      [
        "theory Local",
        "imports Imported",
        "begin",
        "definition answer where \"answer = True\"",
        "lemma uses_answer: \"answer\"",
        "  sorry",
        "end"
      ].join("\n"),
      { line: 4, character: 21 }
    );
    const imported = lookupDocument(
      "file:///Imported.thy",
      [
        "theory Imported",
        "imports Main",
        "begin",
        "definition answer where \"answer = False\"",
        "end"
      ].join("\n")
    );

    const declaration = findDefinitionByName("answer", source, [imported]);

    expect(declaration?.uri).toBe("file:///Local.thy");
    expect(declaration?.span.range.start).toEqual({ line: 3, character: 0 });
  });

  it("resolves declarations from directly imported theory paths", () => {
    const root = process.platform === "win32" ? "C:\\work" : "/work";
    const sourcePath = path.join(root, "App", "Example.thy");
    const importedPath = path.join(root, "Lib", "Library.thy");
    const sourceText = [
      "theory Example",
      "imports Library",
      "begin",
      "lemma uses_helper: \"helper\"",
      "  sorry",
      "end"
    ].join("\n");
    const importedText = [
      "theory Library",
      "imports Main",
      "begin",
      "definition helper where \"helper = True\"",
      "end"
    ].join("\n");
    const sessions = [
      session("Lib", root, [theory("Library", importedPath)]),
      {
        ...session("App", root, [theory("Example", sourcePath)]),
        importedSessions: ["Lib"]
      }
    ];
    const links = extractImportLinks(sourceText, sourcePath, sessions);

    const declaration = findDefinitionByName(
      "helper",
      lookupDocument(sourcePath, sourceText, { line: 3, character: 21 }),
      links.map((link) => lookupDocument(link.targetPath, importedText))
    );

    expect(links.map((link) => link.targetPath)).toEqual([importedPath]);
    expect(declaration?.uri).toBe(importedPath);
    expect(declaration?.span.range.start).toEqual({ line: 3, character: 0 });
  });

  it("does not fall through to imports when the same name has a forward local declaration", () => {
    const source = lookupDocument(
      "file:///ForwardLocal.thy",
      [
        "theory ForwardLocal",
        "imports Imported",
        "begin",
        "lemma uses_later: \"later\"",
        "  sorry",
        "definition later where \"later = True\"",
        "end"
      ].join("\n"),
      { line: 3, character: 20 }
    );
    const imported = lookupDocument(
      "file:///Imported.thy",
      [
        "theory Imported",
        "imports Main",
        "begin",
        "definition later where \"later = False\"",
        "end"
      ].join("\n")
    );

    expect(findDefinitionByName("later", source, [imported])).toBeUndefined();
  });

  it("returns undefined for ambiguous imported declarations", () => {
    const source = lookupDocument(
      "file:///Ambiguous.thy",
      [
        "theory Ambiguous",
        "imports Left Right",
        "begin",
        "lemma uses_helper: \"helper\"",
        "  sorry",
        "end"
      ].join("\n"),
      { line: 3, character: 21 }
    );
    const left = lookupDocument(
      "file:///Left.thy",
      [
        "theory Left",
        "imports Main",
        "begin",
        "definition helper where \"helper = True\"",
        "end"
      ].join("\n")
    );
    const right = lookupDocument(
      "file:///Right.thy",
      [
        "theory Right",
        "imports Main",
        "begin",
        "definition helper where \"helper = False\"",
        "end"
      ].join("\n")
    );

    expect(findDefinitionByName("helper", source, [left, right])).toBeUndefined();
  });
});

describe("wordAt", () => {
  it("returns Isabelle identifier ranges at a cursor position", () => {
    expect(wordAt("lemma foo': True", 9)).toEqual({
      word: "foo'",
      start: 6,
      end: 10
    });
  });
});

function lookupDocument(
  uri: string,
  text: string,
  position?: { line: number; character: number }
): { uri: string; spans: ReturnType<typeof extractCommandSpans>; position?: { line: number; character: number } } {
  return {
    uri,
    spans: extractCommandSpans(uri, text, 1),
    position
  };
}

function session(name: string, rootDirectory: string, theories: DiscoveredSession["theories"]): DiscoveredSession {
  return {
    name,
    rootDirectory,
    sessionDirectory: rootDirectory,
    theories,
    importedSessions: [],
    directories: [],
    documentFiles: []
  };
}

function theory(name: string, theoryPath: string): DiscoveredSession["theories"][number] {
  return {
    name,
    path: theoryPath
  };
}
