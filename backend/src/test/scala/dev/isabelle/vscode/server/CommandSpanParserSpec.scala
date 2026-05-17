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
}
