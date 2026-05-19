package dev.isabelle.vscode.server

/**
 * Phase 4 pure source-injection helper for Sledgehammer.
 *
 * Sledgehammer in Headless mode can be triggered by inserting the
 * `sledgehammer` command into the theory source at the location the
 * user wants to invoke it for, then re-submitting via
 * `Headless.Session.use_theories`. The resulting `Document.Snapshot`
 * contains the prover output (via `snapshot.messages` — same primitive
 * Phase 3b uses) including the "Try this: ..." suggestion lines.
 *
 * This module owns the source-mutation arithmetic: take the original
 * theory text + the user's cursor position, return:
 *   - the injected text (with `sledgehammer` inserted as a new line),
 *   - the position of the injected `sledgehammer` keyword (which is
 *     what we feed to the snapshot extractor to find the right command).
 *
 * The injection strategy is "insert at the start of the line containing
 * the cursor". This is simple, predictable, and works whether the user
 * places the cursor on `sorry`, `done`, `by ...`, an unfinished
 * `apply`, or a blank line in the middle of a proof script.
 *
 * Pure / vscode-free / no I/O. Tested under
 * [[dev.isabelle.vscode.server.SledgehammerSourceInjectorSpec]].
 */
object SledgehammerSourceInjector {

  final case class Injection(
    text: String,
    injectionLine: Int,
    injectionCharacter: Int,
    originalCursorLine: Int,
    originalCursorCharacter: Int
  )

  /**
   * Insert a `sledgehammer` line immediately before the line that
   * contains the cursor. Preserve the same indentation as the cursor's
   * line so the injected command looks natural in the source.
   *
   * Returns the new text plus the position of the injected
   * `sledgehammer` keyword (line = `cursorLine`, character = the
   * indentation column). After injection the cursor's original line
   * has shifted down by 1; callers that want to keep the user's
   * conceptual cursor steady should add 1 to `cursorLine`.
   */
  def inject(text: String, cursorLine: Int, cursorCharacter: Int): Injection = {
    val safeText = if (text == null) "" else text
    val lines = safeText.split("\n", -1)
    val safeLine = math.max(0, math.min(cursorLine, math.max(0, lines.length - 1)))
    val line = if (lines.isEmpty) "" else lines(safeLine)
    val indent = line.takeWhile(c => c == ' ' || c == '\t')
    val insertion = s"${indent}sledgehammer"

    val newLines =
      if (lines.isEmpty) Array(insertion)
      else (lines.take(safeLine) :+ insertion) ++ lines.drop(safeLine)

    Injection(
      text = newLines.mkString("\n"),
      injectionLine = safeLine,
      injectionCharacter = indent.length,
      originalCursorLine = safeLine,
      originalCursorCharacter = cursorCharacter
    )
  }
}
