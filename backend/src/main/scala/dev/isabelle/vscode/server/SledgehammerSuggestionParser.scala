package dev.isabelle.vscode.server

import scala.util.matching.Regex

/**
 * Phase 4 pure parser that converts Sledgehammer's prover output
 * (extracted via Phase 3b's `snapshot.messages` walker) into a
 * structured list of [[SledgehammerSuggestion]] entries.
 *
 * Sledgehammer's output is human-formatted text rendered through the
 * standard PIDE message channel. Lines look like:
 *
 * {{{
 * Sledgehammering...
 * fastforce: Try this: using assms by fastforce (7 ms)
 * simp: Try this: using assms by simp (16 ms)
 * metis: Try this: by (metis assms) (144 ms)
 * Done
 * }}}
 *
 * For each line of the form `<prover>: Try this: <proof> (<timing>)`
 * we emit one [[SledgehammerSuggestion]]. Other lines (status,
 * banner, "Done", error text) become part of the raw blob but do
 * not produce suggestions.
 *
 * Pure / vscode-free / no I/O. Tested under
 * [[dev.isabelle.vscode.server.SledgehammerSuggestionParserSpec]].
 */
object SledgehammerSuggestionParser {

  final case class Suggestion(
    method: String,
    proofText: String,
    description: Option[String]
  )

  // Group 1: prover name (alphanumeric + underscore).
  // Group 2: everything after `Try this:` (the proof plus an optional trailing
  // timing parenthesis). We deliberately capture the whole tail here and peel a
  // *timing-shaped* trailing `(...)` off in code, because a greedy/lazy regex
  // split mis-handles proofs that themselves end in parens with no timing —
  // e.g. `by (metis foo)` would wrongly parse as proof `by`, timing `metis foo`.
  private val Pattern: Regex =
    """^\s*(\w+):\s*Try this:\s*(.+?)\s*$""".r

  // A trailing parenthesised group that is a *timing* (or other prover note),
  // not part of the proof: a leading number/decimal, typically with a time unit
  // (`ms`, `s`, `min`). Matches `(144 ms)`, `(1.2 s)`, `(3 ms)`, `(> 5 s)`.
  private val TrailingTiming: Regex =
    """^(.*?)\s*\((\s*[<>~]?\s*\d[\d.,]*\s*(?:ms|s|min)?\s*)\)$""".r

  /**
   * Parse a single line, returning Some(suggestion) for "Try this:"
   * lines and None for anything else.
   */
  def parseLine(line: String): Option[Suggestion] =
    line match {
      case Pattern(method, body) =>
        val bodyTrimmed = body.trim
        if (bodyTrimmed.isEmpty) None
        else {
          val (proof, desc) = bodyTrimmed match {
            case TrailingTiming(p, timing) if p.trim.nonEmpty => (p.trim, Some(timing.trim))
            case _                                            => (bodyTrimmed, None)
          }
          Some(Suggestion(method.trim, proof, desc.filter(_.nonEmpty)))
        }
      case _ => None
    }

  /**
   * Parse a full output blob (multi-line). Returns suggestions in
   * source order. Duplicates (same method + proof text) are removed
   * preserving the first occurrence.
   */
  def parse(raw: String): Seq[Suggestion] = {
    if (raw == null || raw.isEmpty) return Seq.empty
    val lines = raw.split("\n", -1)
    val seen = scala.collection.mutable.LinkedHashMap.empty[(String, String), Suggestion]
    for (line <- lines) {
      parseLine(line).foreach { s =>
        val key = (s.method, s.proofText)
        if (!seen.contains(key)) seen.put(key, s)
      }
    }
    seen.values.toSeq
  }
}
