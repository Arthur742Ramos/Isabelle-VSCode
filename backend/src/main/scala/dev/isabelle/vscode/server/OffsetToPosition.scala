package dev.isabelle.vscode.server

/**
 * Phase 3 shared helper: translate a flat character offset within a
 * document's text into a `(line, character)` pair using the same
 * line-counting convention LSP uses (0-based line, 0-based UTF-16
 * character index — we approximate with UTF-16 char count since
 * VS Code and Isabelle both use that).
 *
 * Used by both the placeholder bridge (mapping `CommandSpanParser`
 * offsets back to ranges) and the Phase 3 PIDE bridge (mapping
 * `isabelle.Command.range` offsets onto editor positions for the
 * proof state command lookup).
 *
 * Pure / vscode-free / no I/O so vitest mirrors can pin every
 * branch.
 */
object OffsetToPosition {

  /**
   * Convert an absolute character offset into the text into a
   * `(line, character)` pair. Out-of-range offsets clamp at the end
   * of the text.
   */
  def offsetToPosition(text: String, offset: Int): Position = {
    if (offset <= 0) return Position(0, 0)
    val clamped = if (offset > text.length) text.length else offset

    var line = 0
    var column = 0
    var i = 0
    while (i < clamped) {
      val c = text.charAt(i)
      if (c == '\n') {
        line += 1
        column = 0
      } else {
        column += 1
      }
      i += 1
    }
    Position(line, column)
  }

  /**
   * Convert a `(line, character)` pair into the absolute character
   * offset within the text. Pairs past the end of the text clamp at
   * `text.length`.
   */
  def positionToOffset(text: String, line: Int, character: Int): Int = {
    if (line < 0) return 0
    var currentLine = 0
    var i = 0
    while (i < text.length && currentLine < line) {
      if (text.charAt(i) == '\n') currentLine += 1
      i += 1
    }
    if (currentLine < line) return text.length
    val columnTarget = if (character < 0) 0 else character
    var col = 0
    while (i < text.length && col < columnTarget && text.charAt(i) != '\n') {
      i += 1
      col += 1
    }
    i
  }

  final case class Position(line: Int, character: Int)

  /**
   * Range of two positions. Used to build the `CommandSpan` wire
   * shape from raw `(startOffset, endOffset)` PIDE ranges.
   */
  final case class Range(start: Position, end: Position)

  def range(text: String, startOffset: Int, endOffset: Int): Range =
    Range(
      offsetToPosition(text, startOffset),
      offsetToPosition(text, endOffset)
    )
}
