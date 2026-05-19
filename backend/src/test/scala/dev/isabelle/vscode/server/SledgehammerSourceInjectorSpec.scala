package dev.isabelle.vscode.server

import org.scalatest.funspec.AnyFunSpec
import org.scalatest.matchers.should.Matchers

class SledgehammerSourceInjectorSpec extends AnyFunSpec with Matchers {

  describe("SledgehammerSourceInjector.inject") {
    it("inserts a sledgehammer line at the cursor's line, preserving indent") {
      val src = "theory T\n  begin\n  lemma x: \"True\"\n    sorry\nend\n"
      val r = SledgehammerSourceInjector.inject(src, cursorLine = 3, cursorCharacter = 4)
      r.injectionLine shouldBe 3
      r.injectionCharacter shouldBe 4
      val newLines = r.text.split("\n", -1)
      newLines(3) shouldBe "    sledgehammer"
      newLines(4) shouldBe "    sorry"
      newLines.length shouldBe (src.split("\n", -1).length + 1)
    }

    it("preserves zero indentation when cursor is on a line with no indent") {
      val src = "lemma x: \"True\"\nsorry\n"
      val r = SledgehammerSourceInjector.inject(src, cursorLine = 1, cursorCharacter = 0)
      r.injectionCharacter shouldBe 0
      val newLines = r.text.split("\n", -1)
      newLines(1) shouldBe "sledgehammer"
      newLines(2) shouldBe "sorry"
    }

    it("clamps a cursor past the end of the document to the last line") {
      val src = "a\nb\nc"
      val r = SledgehammerSourceInjector.inject(src, cursorLine = 99, cursorCharacter = 0)
      r.injectionLine shouldBe 2
      val newLines = r.text.split("\n", -1)
      newLines(2) shouldBe "sledgehammer"
      newLines(3) shouldBe "c"
    }

    it("handles an empty document by producing just the sledgehammer keyword") {
      val r = SledgehammerSourceInjector.inject("", cursorLine = 0, cursorCharacter = 0)
      r.text shouldBe "sledgehammer\n"
      r.injectionLine shouldBe 0
      r.injectionCharacter shouldBe 0
    }

    it("preserves tab indentation faithfully") {
      val src = "lemma:\n\t\tsorry"
      val r = SledgehammerSourceInjector.inject(src, cursorLine = 1, cursorCharacter = 2)
      r.injectionCharacter shouldBe 2
      val newLines = r.text.split("\n", -1)
      newLines(1) shouldBe "\t\tsledgehammer"
      newLines(2) shouldBe "\t\tsorry"
    }

    it("handles a null input as empty") {
      val r = SledgehammerSourceInjector.inject(null, cursorLine = 0, cursorCharacter = 0)
      r.text shouldBe "sledgehammer\n"
    }

    it("clamps a negative cursor line to 0") {
      val src = "a\nb\nc"
      val r = SledgehammerSourceInjector.inject(src, cursorLine = -3, cursorCharacter = 0)
      r.injectionLine shouldBe 0
      val newLines = r.text.split("\n", -1)
      newLines(0) shouldBe "sledgehammer"
      newLines(1) shouldBe "a"
    }
  }

  describe("SledgehammerSourceInjector.buildCommandSyntax (Phase 5)") {
    it("returns bare `sledgehammer` when options are empty") {
      SledgehammerSourceInjector.buildCommandSyntax(SledgehammerSourceInjector.Options.empty) shouldBe "sledgehammer"
    }

    it("formats params as sorted `[k=v, k=v]`") {
      val opts = SledgehammerSourceInjector.Options(params = Map("minimize" -> "true", "max_facts" -> "8"))
      SledgehammerSourceInjector.buildCommandSyntax(opts) shouldBe "sledgehammer [max_facts=8, minimize=true]"
    }

    it("emits `(fact1 fact2)` for onlyFacts") {
      val opts = SledgehammerSourceInjector.Options(onlyFacts = Seq("foo", "bar"))
      SledgehammerSourceInjector.buildCommandSyntax(opts) shouldBe "sledgehammer (foo bar)"
    }

    it("emits `(add: ...)` and `(del: ...)` with leading-keyword syntax") {
      val opts = SledgehammerSourceInjector.Options(
        addFacts = Seq("foo"),
        delFacts = Seq("bar", "baz")
      )
      SledgehammerSourceInjector.buildCommandSyntax(opts) shouldBe "sledgehammer (add: foo del: bar baz)"
    }

    it("combines params and fact overrides correctly") {
      val opts = SledgehammerSourceInjector.Options(
        params = Map("minimize" -> "true", "preplay_timeout" -> "10"),
        onlyFacts = Seq("assms", "foo")
      )
      SledgehammerSourceInjector.buildCommandSyntax(opts) shouldBe "sledgehammer [minimize=true, preplay_timeout=10] (assms foo)"
    }

    it("escapes fact names containing spaces with double quotes") {
      val opts = SledgehammerSourceInjector.Options(onlyFacts = Seq("foo bar", "baz"))
      SledgehammerSourceInjector.buildCommandSyntax(opts) shouldBe "sledgehammer (\"foo bar\" baz)"
    }

    it("ignores empty-string fact names by emitting `_` placeholder") {
      val name = SledgehammerSourceInjector.escapeFactName("   ")
      name shouldBe "_"
    }
  }

  describe("SledgehammerSourceInjector.injectWithOptions") {
    it("emits the options-augmented command at the cursor line") {
      val src = "lemma x:\n  sorry"
      val opts = SledgehammerSourceInjector.Options(
        params = Map("minimize" -> "true"),
        onlyFacts = Seq("assms")
      )
      val r = SledgehammerSourceInjector.injectWithOptions(src, cursorLine = 1, cursorCharacter = 2, opts)
      r.commandSyntax shouldBe "sledgehammer [minimize=true] (assms)"
      val newLines = r.text.split("\n", -1)
      newLines(1) shouldBe "  sledgehammer [minimize=true] (assms)"
      newLines(2) shouldBe "  sorry"
    }
  }
}
