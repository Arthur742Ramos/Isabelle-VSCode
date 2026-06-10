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

  test("extracts declaration names that follow type parameters and locale targets") {
    val parametric = document.copy(
      text =
        "theory Param\n" +
          "imports Main\n" +
          "begin\n" +
          "datatype 'a tree = Leaf | Node 'a \"'a tree\"\n" +
          "codatatype ('a, 'b) bitree = BNode 'a 'b\n" +
          "type_synonym 'a env = \"string \\<Rightarrow> 'a\"\n" +
          "definition (in monoid) e :: 'a where \"e = one\"\n" +
          "lemma (in group) inv_unique: True\n" +
          "datatype nat' = Z | S nat'\n" +
          "end\n",
      version = 5
    )
    val spans = CommandSpanParser.parse(parametric)
    assert(spans.find(_.kind == "datatype").flatMap(_.name).contains("tree"))
    assert(spans.find(_.kind == "codatatype").flatMap(_.name).contains("bitree"))
    assert(spans.find(_.kind == "type_synonym").flatMap(_.name).contains("env"))
    assert(spans.find(_.kind == "definition").flatMap(_.name).contains("e"))
    assert(spans.find(_.kind == "lemma").flatMap(_.name).contains("inv_unique"))
    // A name that is merely primed (no leading type parameter) is taken as-is.
    assert(spans.find(s => s.kind == "datatype" && s.name.contains("nat'")).isDefined)
  }

  test("still captures a plain leading name and ignores fixes/assumes") {
    val plain = document.copy(
      text =
        "theory Plain\n" +
          "imports Main\n" +
          "begin\n" +
          "definition foo :: nat where \"foo = 0\"\n" +
          "lemma bar: True by simp\n" +
          "end\n",
      version = 6
    )
    val spans = CommandSpanParser.parse(plain)
    assert(spans.find(_.kind == "definition").flatMap(_.name).contains("foo"))
    assert(spans.find(_.kind == "lemma").flatMap(_.name).contains("bar"))
  }

  test("ignores command keywords inside a multi-line block comment") {
    val commented = document.copy(
      text =
        "theory C\n" +
          "imports Main\n" +
          "begin\n" +
          "(*\n" +
          "lemma ignored: True\n" +
          "definition also_ignored where \"x = 0\"\n" +
          "*)\n" +
          "lemma kept: True by simp\n" +
          "end\n",
      version = 7
    )
    val kinds = CommandSpanParser.parse(commented).map(_.kind)
    assert(!kinds.contains("definition"), s"definition leaked from comment: $kinds")
    // The only lemma span is the real one after the comment closes.
    val lemmas = CommandSpanParser.parse(commented).filter(_.kind == "lemma")
    assert(lemmas.size == 1, s"expected one lemma, got ${lemmas.map(_.name)}")
    assert(lemmas.head.name.contains("kept"))
  }

  test("ignores command keywords inside a multi-line cartouche and string") {
    val open = "‹" // ‹
    val close = "›" // ›
    val cartouche = document.copy(
      text =
        "theory K\n" +
          "imports Main\n" +
          "begin\n" +
          s"text $open\n" +
          "lemma ignored_in_cartouche: True\n" +
          s"$close\n" +
          "text \"\n" +
          "definition ignored_in_string where x\n" +
          "\"\n" +
          "lemma kept: True by simp\n" +
          "end\n",
      version = 8
    )
    val spans = CommandSpanParser.parse(cartouche)
    val kinds = spans.map(_.kind)
    assert(!kinds.contains("definition"), s"definition leaked: $kinds")
    val lemmas = spans.filter(_.kind == "lemma")
    assert(lemmas.size == 1 && lemmas.head.name.contains("kept"), s"unexpected lemmas: ${lemmas.map(_.name)}")
  }

  test("does not treat a keyword after code on the same line as a command start") {
    // `instance ..` and a trailing `by` are not separate command spans, and a
    // keyword that is not the first code token on the line is ignored.
    val doc = document.copy(
      text = "theory I\nimports Main\nbegin\nlemma l: \"True\" by simp\nend\n",
      version = 9
    )
    val kinds = CommandSpanParser.parse(doc).map(_.kind)
    // only the leading `lemma` (plus theory/imports/begin/end), not a `by` span
    assert(!kinds.contains("by"), s"`by` should not be a span: $kinds")
    assert(kinds.count(_ == "lemma") == 1)
  }
}
