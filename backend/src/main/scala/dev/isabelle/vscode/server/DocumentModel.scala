package dev.isabelle.vscode.server

import scala.collection.mutable

final case class TheoryDocument(uri: String, text: String, version: Int, session: Option[String])

final class DocumentStore(bridge: PideBridge = new LocalSyntaxPideBridge) {
  private val documents = mutable.Map.empty[String, TheoryDocument]

  def open(uri: String, text: String, version: Int, session: Option[String]): ujson.Value = {
    val document = TheoryDocument(uri, text, version, session)
    documents.update(uri, document)
    bridge.documentResult(document)
  }

  def update(uri: String, text: String, version: Int): ujson.Value = {
    val session = documents.get(uri).flatMap(_.session)
    val document = TheoryDocument(uri, text, version, session)
    documents.update(uri, document)
    bridge.documentResult(document)
  }

  def close(uri: String): ujson.Value = {
    documents.remove(uri)
    ujson.Obj("uri" -> uri)
  }

  /** Read-only peek at a synchronized document's text. Used by the
    * Phase 2a `document/checkWithPide` path to retrieve the editor's
    * current text without going through the open/update mutation
    * cycle. Returns None when the document is not currently
    * synchronized. */
  def peekText(uri: String): Option[String] =
    documents.get(uri).map(_.text)

  /** Phase 3: peek at a synchronized document's version number.
    * Used by `proofState/getWithPide` to derive the cache key when
    * the caller did not supply an explicit version. */
  def peekVersion(uri: String): Option[Int] =
    documents.get(uri).map(_.version)

  def proofState(uri: String, line: Int, character: Int): ujson.Value =
    documents.get(uri) match {
      case None =>
        ujson.Obj(
          "uri" -> uri,
          "status" -> "unavailable",
          "context" -> ujson.Arr(),
          "goals" -> ujson.Arr(),
          "raw" -> "",
          "message" -> "Theory document is not synchronized with the backend."
        )

      case Some(document) =>
        bridge.proofState(document, line, character)
    }

  def sledgehammer(
    requestId: String,
    uri: String,
    line: Int,
    character: Int,
    session: Option[String],
    isabelleExecutablePath: Option[String]
  ): ujson.Value =
    documents.get(uri) match {
      case None =>
        ujson.Obj(
          "requestId" -> requestId,
          "uri" -> uri,
          "status" -> "unavailable",
          "suggestions" -> ujson.Arr(),
          "raw" -> "Theory document is not synchronized with the backend.",
          "message" -> "Synchronize the Isabelle theory before running Sledgehammer."
        )

      case Some(document) =>
        bridge.sledgehammer(SledgehammerRequest(
          requestId = requestId,
          document = document,
          line = line,
          character = character,
          session = session,
          isabelleExecutablePath = isabelleExecutablePath
        ))
    }
}

final case class CommandSpan(
  id: String,
  kind: String,
  name: Option[String],
  startLine: Int,
  startCharacter: Int,
  endLine: Int,
  endCharacter: Int
) {
  def contains(line: Int, character: Int): Boolean =
    startsBeforeOrAt(line, character) && endsAfter(line, character)

  def startsBeforeOrAt(line: Int, character: Int): Boolean =
    startLine < line || (startLine == line && startCharacter <= character)

  private def endsAfter(line: Int, character: Int): Boolean =
    endLine > line || (endLine == line && endCharacter > character)

  def json: ujson.Value =
    ujson.Obj(
      "id" -> id,
      "kind" -> kind,
      "name" -> name.map(ujson.Str(_)).getOrElse(ujson.Null),
      "status" -> "pending",
      "range" -> ujson.Obj(
        "start" -> ujson.Obj("line" -> startLine, "character" -> startCharacter),
        "end" -> ujson.Obj("line" -> endLine, "character" -> endCharacter)
      )
    )
}

object CommandSpanParser {
  // Kept in parity with the TypeScript outer-syntax command table in
  // `src/semantic/isabelleSyntax.ts` so the Scala backend's command spans and
  // the TS local foundation recognise the same HOL/AFP vocabulary.
  private val CommandKeywords = Set(
    // Theory header & structure
    "theory",
    "imports",
    "keywords",
    "abbrevs",
    "begin",
    "end",
    // Document markup
    "chapter",
    "section",
    "subsection",
    "subsubsection",
    "paragraph",
    "subparagraph",
    "text",
    "txt",
    "text_raw",
    // Specifications & declarations
    "definition",
    "abbreviation",
    "fun",
    "function",
    "primrec",
    "primcorec",
    "fun_cases",
    "inductive",
    "inductive_set",
    "coinductive",
    "coinductive_set",
    "datatype",
    "codatatype",
    "type_synonym",
    "typedecl",
    "typedef",
    "record",
    "lift_definition",
    "consts",
    "axiomatization",
    "lemmas",
    "theorems",
    "named_theorems",
    "declare",
    "declaration",
    "notation",
    "no_notation",
    "syntax",
    "no_syntax",
    "translations",
    "no_translations",
    "hide_const",
    "hide_type",
    "hide_fact",
    "hide_class",
    "default_sort",
    "setup",
    "method_setup",
    "attribute_setup",
    "simproc_setup",
    "bundle",
    "unbundle",
    // Goal statements
    "lemma",
    "theorem",
    "corollary",
    "proposition",
    "schematic_goal",
    "termination",
    // Type classes & locales
    "locale",
    "experiment",
    "class",
    "instantiation",
    "instance",
    "subclass",
    "interpretation",
    "interpret",
    "global_interpretation",
    "sublocale",
    "context",
    "notepad",
    // Isar proof structure
    "proof",
    "apply",
    "apply_end",
    "supply",
    "subgoal",
    "using",
    "unfolding",
    "include",
    "including",
    "from",
    "with",
    "then",
    "have",
    "show",
    "hence",
    "thus",
    "fix",
    "assume",
    "presume",
    "define",
    "consider",
    "obtain",
    "guess",
    "let",
    "write",
    "note",
    "case",
    "next",
    "also",
    "moreover",
    "ultimately",
    "finally",
    "qed",
    "by",
    "done",
    "sorry",
    "oops",
    // Diagnostic / exploratory commands
    "value",
    "term",
    "prop",
    "typ",
    "thm",
    "prf",
    "full_prf",
    "find_theorems",
    "find_consts",
    "print_theorems",
    "print_statement",
    "print_locale",
    "print_classes",
    "sledgehammer",
    "nitpick",
    "quickcheck",
    "try",
    "try0",
    "solve_direct",
    "export_code",
    // Embedded ML
    "ML",
    "ML_file",
    "ML_val",
    "ML_prf"
  )

  private val IgnoredNames = Set("fixes", "assumes", "shows", "where", "if", "for")
  private val NameDeclaringKeywords = Set(
    "definition",
    "abbreviation",
    "fun",
    "function",
    "primrec",
    "primcorec",
    "fun_cases",
    "inductive",
    "inductive_set",
    "coinductive",
    "coinductive_set",
    "datatype",
    "codatatype",
    "type_synonym",
    "typedecl",
    "typedef",
    "record",
    "lift_definition",
    "lemmas",
    "theorems",
    "named_theorems",
    "method_setup",
    "attribute_setup",
    "simproc_setup",
    "bundle",
    "lemma",
    "theorem",
    "corollary",
    "proposition",
    "schematic_goal",
    "termination",
    "locale",
    "class",
    "subclass",
    "have",
    "show",
    "hence",
    "thus",
    "assume",
    "presume",
    "define",
    "obtain",
    "note",
    "case",
    "supply"
  )

  def parse(document: TheoryDocument): Vector[CommandSpan] = {
    val lines = document.text.split("\n", -1).toVector
    val starts = lines.zipWithIndex.flatMap { case (line, index) =>
      commandStart(line).map(start => (index, start))
    }

    starts.zipWithIndex.map { case ((line, command), index) =>
      val nextLine = starts.lift(index + 1).map(_._1)
      val end = nextLine match {
        case Some(value) => (value, 0)
        case None =>
          val endLine = lines.length - 1
          (endLine, lines.lift(endLine).map(_.length).getOrElse(0))
      }

      CommandSpan(
        id = s"${document.uri}:${document.version}:$index",
        kind = command.keyword,
        name = command.name,
        startLine = line,
        startCharacter = command.character,
        endLine = end._1,
        endCharacter = end._2
      )
    }
  }

  private def commandStart(line: String): Option[ParsedCommand] = {
    val leading = line.indexWhere(!_.isWhitespace)
    if (leading < 0) {
      return None
    }

    val trimmed = line.drop(leading)
    val parts = trimmed.split("\\s+", 2).toVector
    val keyword = parts.headOption.getOrElse("")
    if (!CommandKeywords.contains(keyword)) {
      return None
    }

    val name =
      if (NameDeclaringKeywords.contains(keyword)) declarationName(parts.lift(1).getOrElse(""))
      else None
    Some(ParsedCommand(keyword, name, leading))
  }

  // A leading type parameter (`'a`, `'a::ord`) at the start of the rest-of-line.
  private val LeadingTypeVariable =
    """^'[A-Za-z_][A-Za-z0-9_']*(?:\s*::\s*[A-Za-z_][A-Za-z0-9_'.]*)?""".r

  /**
   * Find the declared name in the text following a name-declaring keyword,
   * skipping a leading type parameter or parenthesised `(in locale)` target so
   * `datatype 'a list` yields `list` and `definition (in monoid) e` yields `e`.
   * Kept in parity with the TS `commandNameAfter` policy in `commandSpans.ts`.
   */
  private def declarationName(rest: String): Option[String] = {
    var remaining = rest.dropWhile(_.isWhitespace)
    var advanced = true
    while (advanced) {
      advanced = false
      LeadingTypeVariable.findPrefixOf(remaining) match {
        case Some(matched) =>
          remaining = remaining.drop(matched.length).dropWhile(_.isWhitespace)
          advanced = true
        case None =>
          if (remaining.startsWith("(")) {
            val close = matchingParen(remaining)
            if (close >= 0) {
              remaining = remaining.drop(close + 1).dropWhile(_.isWhitespace)
              advanced = true
            }
          }
      }
    }
    cleanName(remaining.takeWhile(!_.isWhitespace))
  }

  /** Index of the `)` closing the `(` at position 0, or -1 if unbalanced. */
  private def matchingParen(text: String): Int = {
    var depth = 0
    var index = 0
    while (index < text.length) {
      text.charAt(index) match {
        case '(' => depth += 1
        case ')' =>
          depth -= 1
          if (depth == 0) return index
        case _ => ()
      }
      index += 1
    }
    -1
  }

  private def cleanName(token: String): Option[String] = {
    val cleaned = token.takeWhile(ch => ch.isLetterOrDigit || ch == '_' || ch == '\'')
    Option(cleaned)
      .filter(_.nonEmpty)
      .filterNot(IgnoredNames.contains)
  }

  private final case class ParsedCommand(keyword: String, name: Option[String], character: Int)
}
