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
  // Group 2: proof text (greedy, stops at the timing parenthesis or end).
  // Group 3: optional timing or description in parens.
  private val Pattern: Regex =
    """^\s*(\w+):\s*Try this:\s*(.+?)(?:\s*\(([^()]+)\))?\s*$""".r

  /**
   * Parse a single line, returning Some(suggestion) for "Try this:"
   * lines and None for anything else.
   */
  def parseLine(line: String): Option[Suggestion] =
    line match {
      case Pattern(method, proof, descRaw) =>
        val proofTrimmed = proof.trim
        if (proofTrimmed.isEmpty) None
        else Some(Suggestion(method.trim, proofTrimmed, Option(descRaw).map(_.trim).filter(_.nonEmpty)))
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
