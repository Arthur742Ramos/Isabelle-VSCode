import { describe, expect, it } from "vitest";
import { extractCommandSpans } from "../../src/document/commandSpans";
import { CommandSpan } from "../../src/protocol/messages";
import {
  extractTheoryEntities,
  groupEntitiesByKind,
  IsabelleEntityKind,
  isTheoryEntityKind,
  THEORY_ENTITY_KINDS
} from "../../src/semantic/theoryEntities";

describe("extractTheoryEntities", () => {
  it("extracts named declarations and statements as theory entities", () => {
    const spans = extractCommandSpans(
      "file:///Entities.thy",
      [
        "theory Entities",
        "imports Main",
        "begin",
        "",
        "definition answer :: nat where \"answer = 42\"",
        "abbreviation double where \"double x \\<equiv> x + x\"",
        "datatype tree = Leaf | Node tree tree",
        "record point = x :: nat y :: nat",
        "fun length :: \"'a list \\<Rightarrow> nat\" where",
        "  \"length [] = 0\"",
        "",
        "lemma answer_positive: \"answer > 0\"",
        "  by simp",
        "",
        "theorem main_theorem: \"True\"",
        "  by simp",
        "",
        "locale ring = fixes mul :: \"'a \\<Rightarrow> 'a \\<Rightarrow> 'a\"",
        "",
        "end"
      ].join("\n"),
      1
    );

    const entities = extractTheoryEntities(spans);

    expect(entities.map((entity) => [entity.kind, entity.name])).toEqual([
      ["definition", "answer"],
      ["abbreviation", "double"],
      ["datatype", "tree"],
      ["record", "point"],
      ["fun", "length"],
      ["lemma", "answer_positive"],
      ["theorem", "main_theorem"],
      ["locale", "ring"]
    ]);

    const lemma = entities.find((entity) => entity.kind === "lemma");
    expect(lemma?.range.start).toEqual({ line: 11, character: 0 });
    expect(lemma?.spanId).toEqual(
      spans.find((span) => span.kind === "lemma" && span.name === "answer_positive")?.id
    );
  });

  it("extracts the broader specification vocabulary as theory entities", () => {
    const spans = extractCommandSpans(
      "file:///Specs.thy",
      [
        "theory Specs",
        "imports Main",
        "begin",
        "typedecl ident",
        "type_synonym env = \"ident \\<Rightarrow> nat\"",
        "typedef pos = \"{n :: nat. n > 0}\"",
        "  by auto",
        "codatatype stream = SCons nat \"stream\"",
        "primcorec ones :: \"nat stream\" where \"ones = SCons 1 ones\"",
        "inductive_set evens :: \"nat set\" where \"0 \\<in> evens\"",
        "lift_definition pos_one :: pos is \"1 :: nat\" by simp",
        "class ordered = fixes le :: \"'a \\<Rightarrow> 'a \\<Rightarrow> bool\"",
        "end"
      ].join("\n"),
      1
    );

    const byKind = new Map(extractTheoryEntities(spans).map((entity) => [entity.kind, entity.name]));
    expect(byKind.get("typedecl")).toBe("ident");
    expect(byKind.get("type_synonym")).toBe("env");
    expect(byKind.get("typedef")).toBe("pos");
    expect(byKind.get("codatatype")).toBe("stream");
    expect(byKind.get("primcorec")).toBe("ones");
    expect(byKind.get("inductive_set")).toBe("evens");
    expect(byKind.get("lift_definition")).toBe("pos_one");
    expect(byKind.get("class")).toBe("ordered");
  });

  it("omits anonymous statements and spans that do not declare entities", () => {
    const spans = extractCommandSpans(
      "file:///Anonymous.thy",
      [
        "theory Anonymous",
        "imports Main",
        "begin",
        "lemma \"True\"",
        "  by simp",
        "lemma named_one: True",
        "  by simp",
        "section \"A section without metadata\"",
        "end"
      ].join("\n"),
      1
    );

    const entities = extractTheoryEntities(spans);

    expect(entities.map((entity) => [entity.kind, entity.name])).toEqual([
      ["lemma", "named_one"]
    ]);
  });

  it("does not emit entities for spans whose kind is not in the entity set", () => {
    const spans: CommandSpan[] = [
      {
        id: "synthetic:0",
        kind: "apply",
        name: "ignored",
        status: "pending",
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }
      },
      {
        id: "synthetic:1",
        kind: "have",
        name: "ignored",
        status: "pending",
        range: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } }
      }
    ];

    expect(extractTheoryEntities(spans)).toEqual([]);
  });

  it("omits section entities while current command-span extraction does not populate their names", () => {
    const spans = extractCommandSpans(
      "file:///Sections.thy",
      [
        "section \"Top\"",
        "subsection \"Middle\"",
        "subsubsection \"Bottom\"",
        "theory Sections",
        "imports Main",
        "begin",
        "end"
      ].join("\n"),
      1
    );

    const entities = extractTheoryEntities(spans);
    expect(entities.find((entity) => entity.kind === "section")).toBeUndefined();
    expect(entities.find((entity) => entity.kind === "subsection")).toBeUndefined();
    expect(entities.find((entity) => entity.kind === "subsubsection")).toBeUndefined();
  });
});

describe("groupEntitiesByKind", () => {
  it("returns a fully initialized grouping with empty arrays for absent kinds", () => {
    const grouped = groupEntitiesByKind([]);

    for (const kind of THEORY_ENTITY_KINDS) {
      expect(grouped[kind]).toEqual([]);
    }
  });

  it("groups entities under their kinds", () => {
    const spans = extractCommandSpans(
      "file:///Grouped.thy",
      [
        "theory Grouped",
        "imports Main",
        "begin",
        "definition a where \"a = True\"",
        "definition b where \"b = False\"",
        "lemma l1: \"a\"",
        "  by simp",
        "datatype color = Red | Green",
        "end"
      ].join("\n"),
      1
    );

    const grouped = groupEntitiesByKind(extractTheoryEntities(spans));

    expect(grouped.definition.map((entity) => entity.name)).toEqual(["a", "b"]);
    expect(grouped.lemma.map((entity) => entity.name)).toEqual(["l1"]);
    expect(grouped.datatype.map((entity) => entity.name)).toEqual(["color"]);
    expect(grouped.theorem).toEqual([]);
  });
});

describe("isTheoryEntityKind", () => {
  it("recognizes known entity kinds and rejects others", () => {
    const known: IsabelleEntityKind[] = [
      "theorem",
      "definition",
      "datatype",
      "locale",
      "section",
      "typedef",
      "type_synonym",
      "codatatype",
      "class",
      "lift_definition"
    ];
    for (const kind of known) {
      expect(isTheoryEntityKind(kind)).toBe(true);
    }

    expect(isTheoryEntityKind("apply")).toBe(false);
    expect(isTheoryEntityKind("have")).toBe(false);
    expect(isTheoryEntityKind("nonsense")).toBe(false);
  });
});
