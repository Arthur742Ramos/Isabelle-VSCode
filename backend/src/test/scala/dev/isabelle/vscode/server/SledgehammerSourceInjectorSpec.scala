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
}
