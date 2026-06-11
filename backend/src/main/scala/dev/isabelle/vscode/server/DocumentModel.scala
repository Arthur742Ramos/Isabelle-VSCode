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
    "nonterminal",
    "judgment",
    "alias",
    "type_alias",
    "oracle",
    "type_notation",
    "no_type_notation",
    "syntax_consts",
    "syntax_types",
    "syntax_declaration",
    "parse_translation",
    "print_translation",
    "parse_ast_translation",
    "print_ast_translation",
    "typed_print_translation",
    "code_datatype",
    "adhoc_overloading",
    "no_adhoc_overloading",
    "local_setup",
    "open_bundle",
    "generate_file",
    "external_file",
    "bibtex_file",
    "ROOTS_file",
    "realizers",
    "realizability",
    "extract_type",
    "extract",
    "overloading",
    "setup_lifting",
    "lifting_forget",
    "lifting_update",
    "parametric_constant",
    "coinduction_upto",
    "bnf_axiomatization",
    "copy_bnf",
    "datatype_compat",
    "datatype_record",
    "corec",
    "quotient_type",
    "quotient_definition",
    "bnf",
    "lift_bnf",
    "free_constructors",
    "corecursive",
    "primcorecursive",
    "friend_of_corec",
    "code_pred",
    "partial_function",
    "inductive_cases",
    "inductive_simps",
    "specification",
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
    "defer",
    "prefer",
    "back",
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
    "print_state",
    "print_context",
    "print_theory",
    "print_definitions",
    "print_defn_rules",
    "print_syntax",
    "print_abbrevs",
    "print_facts",
    "print_cases",
    "print_term_bindings",
    "print_locales",
    "print_interps",
    "print_attributes",
    "print_simpset",
    "print_rules",
    "print_trans_rules",
    "print_methods",
    "print_options",
    "print_bundles",
    "print_codesetup",
    "print_commands",
    "print_antiquotations",
    "print_ML_antiquotations",
    "thy_deps",
    "locale_deps",
    "class_deps",
    "thm_deps",
    "thm_oracles",
    "unused_thms",
    "help",
    "welcome",
    "export_generated_files",
    "compile_generated_files",
    "scala_build_generated_files",
    "values",
    "find_unused_assms",
    "nunchaku",
    "test_code",
    "print_bnfs",
    "print_claset",
    "print_induct_rules",
    "print_coercions",
    "print_record",
    "print_case_translations",
    "print_quotients",
    "print_quotconsts",
    "print_quot_maps",
    "sledgehammer_params",
    "nitpick_params",
    "quickcheck_params",
    "nunchaku_params",
    "quickcheck_generator",
    // Embedded ML
    "ML",
    "ML_file",
    "ML_val",
    "ML_prf",
    "ML_command",
    "ML_export",
    "ML_file_debug",
    "ML_file_no_debug",
    "SML_file",
    "SML_file_debug",
    "SML_file_no_debug",
    "SML_import",
    "SML_export"
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
    "nonterminal",
    "judgment",
    "alias",
    "type_alias",
    "oracle",
    "lemma",
    "theorem",
    "corollary",
    "proposition",
    "schematic_goal",
    "termination",
    "datatype_record",
    "corec",
    "quotient_type",
    "corecursive",
    "primcorecursive",
    "partial_function",
    "inductive_cases",
    "inductive_simps",
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

    // Walk the lines carrying comment / string / cartouche state across line
    // boundaries (mirroring the TS commandSpans.ts scanner) so a command keyword
    // inside a multi-line `(* … *)` comment, a `"…"` string, or a `text ‹…›` /
    // `\<open>…\<close>` cartouche is never mistaken for a real command.
    var state = ScanState(commentDepth = 0, inString = false, cartoucheDepth = 0)
    val startsBuilder = Vector.newBuilder[(Int, ParsedCommand)]
    lines.zipWithIndex.foreach { case (line, index) =>
      val result = scanLineForCommand(line, state)
      state = result.state
      result.command.foreach(command => startsBuilder += ((index, command)))
    }
    val starts = startsBuilder.result()

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

  private val AsciiCartoucheOpen = "\\<open>"
  private val AsciiCartoucheClose = "\\<close>"
  private val UnicodeCartoucheOpen = '‹' // ‹
  private val UnicodeCartoucheClose = '›' // ›

  private final case class ScanState(commentDepth: Int, inString: Boolean, cartoucheDepth: Int)
  private final case class LineScan(command: Option[ParsedCommand], state: ScanState)

  /**
   * Scan a single line starting from `initial` state, returning the (possibly
   * carried-over) end state plus the command this line begins, if any. A command
   * is only recognised when the first top-level *code* token on the line — not
   * inside a comment, string, or cartouche — is a recognised keyword.
   */
  private def scanLineForCommand(line: String, initial: ScanState): LineScan = {
    var commentDepth = initial.commentDepth
    var inString = initial.inString
    var cartoucheDepth = initial.cartoucheDepth
    var sawCode = false
    var command: Option[ParsedCommand] = None
    var index = 0
    val len = line.length

    def startsAt(s: String, at: Int): Boolean = line.regionMatches(at, s, 0, s.length)

    while (index < len) {
      if (commentDepth > 0) {
        if (startsAt("(*", index)) { commentDepth += 1; index += 2 }
        else if (startsAt("*)", index)) { commentDepth -= 1; index += 2 }
        else index += 1
      } else if (inString) {
        if (line.charAt(index) == '\\') index += 2
        else if (line.charAt(index) == '"') { inString = false; index += 1 }
        else index += 1
      } else if (cartoucheDepth > 0) {
        if (startsAt(AsciiCartoucheOpen, index)) { cartoucheDepth += 1; index += AsciiCartoucheOpen.length }
        else if (startsAt(AsciiCartoucheClose, index)) {
          cartoucheDepth = math.max(0, cartoucheDepth - 1); index += AsciiCartoucheClose.length
        } else if (line.charAt(index) == UnicodeCartoucheOpen) { cartoucheDepth += 1; index += 1 }
        else if (line.charAt(index) == UnicodeCartoucheClose) {
          cartoucheDepth = math.max(0, cartoucheDepth - 1); index += 1
        } else index += 1
      } else if (startsAt("(*", index)) {
        commentDepth += 1; index += 2
      } else if (startsAt(AsciiCartoucheOpen, index)) {
        sawCode = true; cartoucheDepth += 1; index += AsciiCartoucheOpen.length
      } else if (line.charAt(index) == '"') {
        sawCode = true; inString = true; index += 1
      } else if (line.charAt(index) == UnicodeCartoucheOpen) {
        sawCode = true; cartoucheDepth += 1; index += 1
      } else if (line.charAt(index).isWhitespace) {
        index += 1
      } else {
        if (!sawCode) {
          sawCode = true
          command = commandAt(line, index)
        }
        index += 1
      }
    }

    LineScan(command, ScanState(commentDepth, inString, cartoucheDepth))
  }

  /** Parse a command keyword (and its declared name) starting at column `from`. */
  private def commandAt(line: String, from: Int): Option[ParsedCommand] = {
    val rest = line.substring(from)
    val parts = rest.split("\\s+", 2).toVector
    val keyword = parts.headOption.getOrElse("")
    if (!CommandKeywords.contains(keyword)) {
      return None
    }
    val name =
      if (NameDeclaringKeywords.contains(keyword)) declarationName(parts.lift(1).getOrElse(""))
      else None
    Some(ParsedCommand(keyword, name, from))
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
