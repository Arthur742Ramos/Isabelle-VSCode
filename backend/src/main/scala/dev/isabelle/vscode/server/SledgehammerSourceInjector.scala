package dev.isabelle.vscode.server

/**
 * Phase 4 / Phase 5 pure source-injection helper for Sledgehammer.
 *
 * Sledgehammer in Headless mode can be triggered by inserting the
 * `sledgehammer` command into the theory source at the location the
 * user wants to invoke it for, then re-submitting via
 * `Headless.Session.use_theories`. The resulting `Document.Snapshot`
 * contains the prover output (via `snapshot.messages` — same primitive
 * Phase 3b uses) including the "Try this: ..." suggestion lines.
 *
 * Phase 5 extension: the injected command can carry sledgehammer
 * `[params]` and `(fact_override)` to support the M7 minimization
 * unlock — `sledgehammer (only: foo bar)` runs against just that
 * fact set, and `minimize=true` (Sledgehammer's default) reduces the
 * winning proof to its essentials. This lets the TS-side
 * `Isabelle: Minimize Sledgehammer Proof at Cursor` command produce
 * smaller proof bodies from an existing `by (metis foo bar baz)`.
 *
 * Pure / vscode-free / no I/O. Tested under
 * [[dev.isabelle.vscode.server.SledgehammerSourceInjectorSpec]].
 */
object SledgehammerSourceInjector {

  /**
   * Sledgehammer parameter / fact-override options threaded through
   * the new `sledgehammer/run` wire shape.
   *
   * - `params`        — raw `[k1=v1, k2=v2]` options forwarded verbatim,
   *                     e.g. `Map("minimize" -> "true",
   *                                "max_facts" -> "8",
   *                                "preplay_timeout" -> "10")`.
   * - `onlyFacts`     — restrict Sledgehammer's search to these facts
   *                     (becomes `(name1 name2 ...)` in syntax).
   * - `addFacts`      — additional facts to consider beyond the
   *                     default chained ones (becomes `(add: ...)`).
   * - `delFacts`      — facts to exclude (becomes `(del: ...)`).
   */
  final case class Options(
    params: Map[String, String] = Map.empty,
    onlyFacts: Seq[String] = Seq.empty,
    addFacts: Seq[String] = Seq.empty,
    delFacts: Seq[String] = Seq.empty
  ) {
    def isEmpty: Boolean = params.isEmpty && onlyFacts.isEmpty && addFacts.isEmpty && delFacts.isEmpty
  }
  object Options {
    val empty: Options = Options()
  }

  final case class Injection(
    text: String,
    injectionLine: Int,
    injectionCharacter: Int,
    originalCursorLine: Int,
    originalCursorCharacter: Int,
    commandSyntax: String
  )

  /**
   * Insert a `sledgehammer` line immediately before the line that
   * contains the cursor. Preserve the same indentation as the cursor's
   * line so the injected command looks natural in the source.
   */
  def inject(text: String, cursorLine: Int, cursorCharacter: Int): Injection =
    injectWithOptions(text, cursorLine, cursorCharacter, Options.empty)

  def injectWithOptions(
    text: String,
    cursorLine: Int,
    cursorCharacter: Int,
    options: Options
  ): Injection = {
    val safeText = if (text == null) "" else text
    val lines = safeText.split("\n", -1)
    val safeLine = math.max(0, math.min(cursorLine, math.max(0, lines.length - 1)))
    val line = if (lines.isEmpty) "" else lines(safeLine)
    val indent = line.takeWhile(c => c == ' ' || c == '\t')
    val commandSyntax = buildCommandSyntax(options)
    val insertion = s"$indent$commandSyntax"

    val newLines =
      if (lines.isEmpty) Array(insertion)
      else (lines.take(safeLine) :+ insertion) ++ lines.drop(safeLine)

    Injection(
      text = newLines.mkString("\n"),
      injectionLine = safeLine,
      injectionCharacter = indent.length,
      originalCursorLine = safeLine,
      originalCursorCharacter = cursorCharacter,
      commandSyntax = commandSyntax
    )
  }

  /**
   * Build the actual `sledgehammer [params] (fact_override)` text the
   * injector splices into the source.
   */
  private[server] def buildCommandSyntax(options: Options): String = {
    val paramsPart =
      if (options.params.isEmpty) ""
      else {
        val pairs = options.params.toSeq.sortBy(_._1).map { case (k, v) =>
          if (v.isEmpty) k else s"$k=$v"
        }
        s" [${pairs.mkString(", ")}]"
      }

    val factParts = scala.collection.mutable.Buffer.empty[String]
    if (options.onlyFacts.nonEmpty) {
      factParts += options.onlyFacts.map(escapeFactName).mkString(" ")
    }
    if (options.addFacts.nonEmpty) {
      factParts += s"add: ${options.addFacts.map(escapeFactName).mkString(" ")}"
    }
    if (options.delFacts.nonEmpty) {
      factParts += s"del: ${options.delFacts.map(escapeFactName).mkString(" ")}"
    }
    val factPart =
      if (factParts.isEmpty) ""
      else s" (${factParts.mkString(" ")})"

    s"sledgehammer$paramsPart$factPart"
  }

  /**
   * Fact names in Isabelle are normally bare identifiers. If a fact
   * name contains spaces (unusual but possible for instantiated theorems),
   * quote it. We keep this very conservative — just defend against
   * obvious shell-injection-like content.
   */
  private[server] def escapeFactName(name: String): String = {
    val trimmed = name.trim
    if (trimmed.isEmpty) "_"
    else if (trimmed.contains(' ') || trimmed.contains('"')) "\"" + trimmed.replace("\"", "\\\"") + "\""
    else trimmed
  }
}

