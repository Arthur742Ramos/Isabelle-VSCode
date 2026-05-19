package dev.isabelle.vscode.server

import org.scalatest.funsuite.AnyFunSuite

final class OffsetToPositionSpec extends AnyFunSuite {
  test("offsetToPosition handles the beginning of the text") {
    val pos = OffsetToPosition.offsetToPosition("hello\nworld", 0)
    assert(pos == OffsetToPosition.Position(0, 0))
  }

  test("offsetToPosition advances columns within a line") {
    val pos = OffsetToPosition.offsetToPosition("hello\nworld", 3)
    assert(pos == OffsetToPosition.Position(0, 3))
  }

  test("offsetToPosition crosses a newline into line 1 column 0") {
    val pos = OffsetToPosition.offsetToPosition("hello\nworld", 6)
    assert(pos == OffsetToPosition.Position(1, 0))
  }

  test("offsetToPosition clamps past-end offsets to text length") {
    val pos = OffsetToPosition.offsetToPosition("abc", 100)
    assert(pos == OffsetToPosition.Position(0, 3))
  }

  test("positionToOffset round-trips with offsetToPosition for in-range positions") {
    val text = "alpha\nbeta\ngamma"
    val cases = Seq(0, 3, 5, 6, 10, 11, 16)
    for (offset <- cases) {
      val pos = OffsetToPosition.offsetToPosition(text, offset)
      val roundTrip = OffsetToPosition.positionToOffset(text, pos.line, pos.character)
      assert(roundTrip == offset, s"round-trip failed for offset=$offset (pos=$pos roundTrip=$roundTrip)")
    }
  }

  test("positionToOffset clamps lines past the end of the text") {
    val text = "alpha\nbeta"
    assert(OffsetToPosition.positionToOffset(text, 999, 0) == text.length)
  }

  test("positionToOffset clamps characters past the end of a line") {
    val text = "alpha\nbeta"
    // Line 0 has 5 chars; asking for column 99 should clamp at the newline.
    val offset = OffsetToPosition.positionToOffset(text, 0, 99)
    assert(offset == 5)
  }

  test("range produces start + end with correct line/character pairs") {
    val text = "line0\nline1\nline2"
    val range = OffsetToPosition.range(text, 0, 11)
    assert(range.start == OffsetToPosition.Position(0, 0))
    assert(range.end == OffsetToPosition.Position(1, 5))
  }
}
