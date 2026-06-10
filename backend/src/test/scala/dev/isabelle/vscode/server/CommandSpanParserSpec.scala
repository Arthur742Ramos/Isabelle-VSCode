package dev.isabelle.vscode.server

import org.scalatest.funsuite.AnyFunSuite

/**
 * Smoke test that verifies the ScalaTest wiring works end-to-end and
 * exercises a small slice of [[CommandSpanParser]]. The existing
 * Scala backend logic is otherwise covered indirectly through the
 * TypeScript-side vitest suites; this spec exists primarily so that
 * `npm run backend:test` has something concrete to run and so future
 * Scala-only behavior can grow alongside dedicated specs.
 */
final class CommandSpanParserSpec extends AnyFunSuite {

  private val document = TheoryDocument(
    uri = "file:///workspace/Demo.thy",
    text =
      "theory Demo\n" +
        "imports Main\n" +
        "begin\n" +
        "lemma demo: \"True\" by simp\n" +
        "end\n",
    version = 1,
    session = Some("HOL")
  )

  test("extracts the leading theory, imports, begin, lemma, and end command spans") {
    val spans = CommandSpanParser.parse(document)
    val kinds = spans.map(_.kind).toList
    assert(kinds == List("theory", "imports", "begin", "lemma", "end"))
  }

  test("captures the lemma name from a name-declaring command keyword") {
    val spans = CommandSpanParser.parse(document)
    val lemma = spans.find(_.kind == "lemma").getOrElse(fail("expected a lemma span"))
    assert(lemma.name.contains("demo"))
  }

  test("returns an empty span vector for theory text with no recognized commands") {
    val empty = document.copy(text = "-- just a comment\n", version = 2)
    assert(CommandSpanParser.parse(empty).isEmpty)
  }

  test("recognizes the broader HOL/AFP command vocabulary in parity with the TS table") {
    val broad = document.copy(
      text =
        "theory Broad\n" +
          "imports Main\n" +
          "begin\n" +
          "typedecl ident\n" +
          "type_synonym name = string\n" +
          "typedef pos = \"{n. n > 0}\" by auto\n" +
          "class ordered = fixes le :: bool\n" +
          "instantiation nat :: ordered\n" +
          "begin\n" +
          "end\n" +
          "interpretation triv: ordered by standard\n" +
          "lift_definition one :: pos is \"1\" by simp\n" +
          "lemmas useful = conjI\n" +
          "value \"2 + 2\"\n" +
          "find_theorems \"_ + _\"\n" +
          "ML \\<open>writeln\\<close>\n" +
          "end\n",
      version = 3
    )
    val kinds = CommandSpanParser.parse(broad).map(_.kind).toSet
    val expected = Set(
      "typedecl",
      "type_synonym",
      "typedef",
      "class",
      "instantiation",
      "interpretation",
      "lift_definition",
      "lemmas",
      "value",
      "find_theorems",
      "ML"
    )
    assert(expected.subsetOf(kinds), s"missing: ${expected.diff(kinds)}")
  }

  test("captures names from the broader name-declaring commands") {
    val named = document.copy(
      text =
        "theory Named\n" +
          "imports Main\n" +
          "begin\n" +
          "typedecl ident\n" +
          "type_synonym envty = nat\n" +
          "lemmas useful = conjI\n" +
          "end\n",
      version = 4
    )
    val spans = CommandSpanParser.parse(named)
    assert(spans.find(_.kind == "typedecl").flatMap(_.name).contains("ident"))
    assert(spans.find(_.kind == "type_synonym").flatMap(_.name).contains("envty"))
    assert(spans.find(_.kind == "lemmas").flatMap(_.name).contains("useful"))
  }
}
