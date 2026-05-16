package dev.isabelle.vscode.server

import scala.collection.mutable

final case class TheoryDocument(uri: String, text: String, version: Int, session: Option[String])

final class DocumentStore {
  private val documents = mutable.Map.empty[String, TheoryDocument]

  def open(uri: String, text: String, version: Int, session: Option[String]): ujson.Value = {
    val document = TheoryDocument(uri, text, version, session)
    documents.update(uri, document)
    documentResult(document)
  }

  def update(uri: String, text: String, version: Int): ujson.Value = {
    val session = documents.get(uri).flatMap(_.session)
    val document = TheoryDocument(uri, text, version, session)
    documents.update(uri, document)
    documentResult(document)
  }

  def close(uri: String): ujson.Value = {
    documents.remove(uri)
    ujson.Obj("uri" -> uri)
  }

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
        val spans = CommandSpanParser.parse(document)
        val command = spans.find(_.contains(line, character))
          .orElse(spans.reverse.find(_.startsBeforeOrAt(line, character)))

        ujson.Obj(
          "uri" -> uri,
          "version" -> document.version,
          "status" -> "unavailable",
          "command" -> command.map(_.json).getOrElse(ujson.Null),
          "context" -> ujson.Arr(),
          "goals" -> ujson.Arr(
            ujson.Obj(
              "index" -> 1,
              "text" -> "Live proof goals require Isabelle/PIDE proof-state integration."
            )
          ),
          "raw" -> ujson.Str(command
            .map(span => s"Current command: ${span.kind}${span.name.map(name => s" $name").getOrElse("")}")
            .getOrElse("No Isabelle command span at the current cursor position.")),
          "message" -> "Proof-state panel is connected; semantic goals/context are pending PIDE integration."
        )
    }

  private def documentResult(document: TheoryDocument): ujson.Value =
    ujson.Obj(
      "uri" -> document.uri,
      "version" -> document.version,
      "commandSpans" -> CommandSpanParser.parse(document).map(_.json)
    )
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
    "lemma",
    "theorem",
    "corollary",
    "proposition",
    "definition",
    "fun",
    "function",
    "primrec",
    "inductive",
    "datatype",
    "record",
    "locale",
    "context",
    "proof",
    "qed",
    "by",
    "apply",
    "done",
    "end"
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

    val name = parts.lift(1).filter(token => token.nonEmpty && !token.startsWith("\"") && token != "=" && token != "+")
    Some(ParsedCommand(keyword, name, leading))
  }

  private final case class ParsedCommand(keyword: String, name: Option[String], character: Int)
}
