package dev.isabelle.vscode.server

import org.scalatest.funspec.AnyFunSpec
import org.scalatest.matchers.should.Matchers

class SledgehammerSuggestionParserSpec extends AnyFunSpec with Matchers {

  describe("SledgehammerSuggestionParser.parseLine") {
    it("parses the canonical 'prover: Try this: <proof> (<timing>)' shape") {
      val s = SledgehammerSuggestionParser.parseLine("metis: Try this: by (metis assms) (144 ms)")
      s shouldBe defined
      s.get.method shouldBe "metis"
      s.get.proofText shouldBe "by (metis assms)"
      s.get.description shouldBe Some("144 ms")
    }

    it("parses with leading whitespace") {
      val s = SledgehammerSuggestionParser.parseLine("  fastforce: Try this: using assms by fastforce (7 ms)")
      s shouldBe defined
      s.get.method shouldBe "fastforce"
      s.get.proofText shouldBe "using assms by fastforce"
      s.get.description shouldBe Some("7 ms")
    }

    it("returns None for non-suggestion lines") {
      SledgehammerSuggestionParser.parseLine("Sledgehammering...") shouldBe None
      SledgehammerSuggestionParser.parseLine("Done") shouldBe None
      SledgehammerSuggestionParser.parseLine("") shouldBe None
      SledgehammerSuggestionParser.parseLine("fastforce found a proof...") shouldBe None
    }

    it("handles missing timing description gracefully") {
      val s = SledgehammerSuggestionParser.parseLine("metis: Try this: by metis")
      s shouldBe defined
      s.get.method shouldBe "metis"
      s.get.proofText shouldBe "by metis"
      s.get.description shouldBe None
    }

    it("keeps a proof that ends in parens when there is no timing suffix") {
      // Regression: the old greedy/lazy split parsed this as proof `by`,
      // timing `metis foo`. The proof's own trailing parens are part of it.
      val s = SledgehammerSuggestionParser.parseLine("metis: Try this: by (metis foo)")
      s shouldBe defined
      s.get.method shouldBe "metis"
      s.get.proofText shouldBe "by (metis foo)"
      s.get.description shouldBe None
    }

    it("peels only a timing-shaped trailing parenthesis off the proof") {
      val withTiming = SledgehammerSuggestionParser.parseLine("metis: Try this: by (metis foo) (144 ms)")
      withTiming.get.proofText shouldBe "by (metis foo)"
      withTiming.get.description shouldBe Some("144 ms")

      // A proof ending in a non-timing paren keeps it.
      val noTiming = SledgehammerSuggestionParser.parseLine("blast: Try this: by (auto simp: x)")
      noTiming.get.proofText shouldBe "by (auto simp: x)"
      noTiming.get.description shouldBe None
    }

    it("keeps nested parens in the proof while extracting the timing") {
      val s = SledgehammerSuggestionParser.parseLine("z3: Try this: by (smt (z3) foo) (10 ms)")
      s shouldBe defined
      s.get.proofText shouldBe "by (smt (z3) foo)"
      s.get.description shouldBe Some("10 ms")
    }

    it("accepts fractional and second-unit timings") {
      SledgehammerSuggestionParser.parseLine("metis: Try this: by metis (1.2 s)").get.description shouldBe Some("1.2 s")
    }
  }

  describe("SledgehammerSuggestionParser.parse") {
    val sample =
      """Sledgehammering...
        |fastforce found a proof...
        |simp found a proof...
        |auto found a proof...
        |fastforce: Try this: using assms by fastforce (7 ms)
        |simp: Try this: using assms by simp (16 ms)
        |auto: Try this: using assms by auto (5 ms)
        |metis found a proof...
        |metis: Try this: by (metis assms) (144 ms)
        |Done""".stripMargin

    it("extracts every 'Try this:' line in source order") {
      val sugs = SledgehammerSuggestionParser.parse(sample)
      sugs should have size 4
      sugs.map(_.method) shouldBe Seq("fastforce", "simp", "auto", "metis")
      sugs(3).proofText shouldBe "by (metis assms)"
      sugs(3).description shouldBe Some("144 ms")
    }

    it("returns an empty Seq for empty input") {
      SledgehammerSuggestionParser.parse("") shouldBe empty
      SledgehammerSuggestionParser.parse(null) shouldBe empty
    }

    it("returns an empty Seq when there are no 'Try this:' lines") {
      SledgehammerSuggestionParser.parse("Sledgehammering...\nDone\n") shouldBe empty
    }

    it("deduplicates exact (method, proofText) pairs preserving first occurrence") {
      val raw = "metis: Try this: by metis (144 ms)\nmetis: Try this: by metis (200 ms)\n"
      val sugs = SledgehammerSuggestionParser.parse(raw)
      sugs should have size 1
      sugs.head.description shouldBe Some("144 ms")
    }
  }
}
