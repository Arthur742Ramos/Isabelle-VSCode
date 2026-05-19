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
  private val CommandKeywords = Set(
    "theory",
    "imports",
    "begin",
    "end",
    "section",
    "subsection",
    "subsubsection",
    "text",
    "lemma",
    "theorem",
    "corollary",
    "proposition",
    "schematic_goal",
    "definition",
    "abbreviation",
    "fun",
    "function",
    "primrec",
    "inductive",
    "datatype",
    "record",
    "locale",
    "context",
    "proof",
    "apply",
    "using",
    "unfolding",
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
    "obtain",
    "guess",
    "let",
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
    "oops"
  )

  private val IgnoredNames = Set("fixes", "assumes", "shows", "where", "if", "for")
  private val NameDeclaringKeywords = Set(
    "lemma",
    "theorem",
    "corollary",
    "proposition",
    "schematic_goal",
    "definition",
    "abbreviation",
    "fun",
    "function",
    "primrec",
    "inductive",
    "datatype",
    "record",
    "locale",
    "have",
    "show",
    "hence",
    "thus",
    "assume",
    "presume",
    "obtain",
    "note",
    "case"
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
    val parts = trimmed.split("\\s+", 3).toVector
    val keyword = parts.headOption.getOrElse("")
    if (!CommandKeywords.contains(keyword)) {
      return None
    }

    val name =
      if (NameDeclaringKeywords.contains(keyword)) parts.lift(1).flatMap(cleanName)
      else None
    Some(ParsedCommand(keyword, name, leading))
  }

  private def cleanName(token: String): Option[String] = {
    val cleaned = token.takeWhile(ch => ch.isLetterOrDigit || ch == '_' || ch == '\'')
    Option(cleaned)
      .filter(_.nonEmpty)
      .filterNot(IgnoredNames.contains)
  }

  private final case class ParsedCommand(keyword: String, name: Option[String], character: Int)
}
