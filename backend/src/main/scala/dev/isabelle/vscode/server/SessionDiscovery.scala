package dev.isabelle.vscode.server

import java.io.File
import java.nio.charset.StandardCharsets
import java.nio.file.{AccessDeniedException, Files, NoSuchFileException, Path}
import scala.collection.mutable
import scala.util.control.NonFatal

final case class SessionDiscoveryOptions(
  workspaceFolders: Seq[String],
  roots: Seq[String],
  afpPath: Option[String]
)

object SessionDiscovery {
  private val SectionKeywords = Set(
    "sessions",
    "directories",
    "theories",
    "document_theories",
    "document_files",
    "export_files"
  )

  private val SkippedDirectories = Set(".git", "node_modules", "out", "target", ".metals")

  def discover(options: SessionDiscoveryOptions): ujson.Value = {
    val sessions = mutable.Buffer.empty[DiscoveredSession]
    val scannedDirectories = mutable.Set.empty[String]

    for {
      workspaceFolder <- options.workspaceFolders
      rootDirectory <- findRootDirectories(workspaceFolder, options.roots, options.afpPath)
    } {
      val normalized = canonicalPath(new File(rootDirectory))
      if (!scannedDirectories.contains(normalized)) {
        scannedDirectories.add(normalized)
        readOptionalFile(new File(normalized, "ROOT").toPath).foreach { source =>
          sessions ++= parseRootFile(source, normalized)
        }
      }
    }

    ujson.Obj(
      "sessions" -> ujson.Arr(sessions.sortBy(_.name).map(sessionJson).toSeq: _*)
    )
  }

  private def findRootDirectories(
    workspaceFolder: String,
    extraRoots: Seq[String],
    afpPath: Option[String]
  ): Seq[String] = {
    val roots = mutable.LinkedHashSet.empty[String]
    roots.add(workspaceFolder)

    readOptionalFile(new File(workspaceFolder, "ROOTS").toPath).foreach { source =>
      parseRootsFile(source).foreach(root => roots.add(resolvePath(workspaceFolder, root)))
    }

    extraRoots.foreach(root => roots.add(resolvePath(workspaceFolder, root)))
    afpPath.filter(_.nonEmpty).foreach(path => roots.add(new File(path, "thys").getAbsolutePath))
    roots.addAll(findNestedRootDirectories(new File(workspaceFolder), 0))

    roots.toSeq
  }

  private def findNestedRootDirectories(directory: File, depth: Int): Seq[String] = {
    if (depth > 5 || shouldSkipDirectory(directory)) {
      return Seq.empty
    }

    val entries =
      try {
        Option(directory.listFiles()).getOrElse(Array.empty)
      } catch {
        case NonFatal(_) => Array.empty[File]
      }

    if (!directory.isDirectory || !directory.canRead) {
      return Seq.empty
    }

    val discovered = mutable.Buffer.empty[String]
    if (entries.exists(entry => entry.isFile && entry.getName == "ROOT")) {
      discovered += canonicalPath(directory)
    }

    entries.filter(_.isDirectory).foreach { child =>
      discovered ++= findNestedRootDirectories(child, depth + 1)
    }

    discovered.toSeq
  }

  private def shouldSkipDirectory(directory: File): Boolean =
    SkippedDirectories.contains(directory.getName)

  private def parseRootsFile(source: String): Seq[String] =
    source
      .split("\\r?\\n")
      .iterator
      .map(line => line.replaceAll("#.*", "").trim)
      .filter(_.nonEmpty)
      .map(unquote)
      .toSeq

  private def parseRootFile(source: String, rootDirectory: String): Seq[DiscoveredSession] = {
    val tokens = tokenize(stripNestedComments(source))
    val sessions = mutable.Buffer.empty[DiscoveredSession]
    var index = 0

    while (index < tokens.length) {
      if (tokens(index).value != "session") {
        index += 1
      } else {
        val name = tokens.lift(index + 1).map(_.value)
        if (name.isEmpty) {
          index = tokens.length
        } else {
          index += 2
          index = skipBalancedGroups(tokens, index)

          var sessionDirectory = rootDirectory
          if (tokens.lift(index).exists(_.value == "in")) {
            tokens.lift(index + 1).foreach { directory =>
              sessionDirectory = joinPath(rootDirectory, directory.value)
            }
            index += 2
          }

          var parent: Option[String] = None
          if (tokens.lift(index).exists(_.value == "=")) {
            parent = tokens.lift(index + 1).map(_.value)
            index += 2
          }

          if (tokens.lift(index).exists(_.value == "+")) {
            index += 1
          }

          val theories = mutable.Buffer.empty[String]
          val importedSessions = mutable.Buffer.empty[String]
          val directories = mutable.Buffer.empty[String]
          val documentFiles = mutable.Buffer.empty[String]

          while (
            index < tokens.length &&
              tokens(index).value != "session" &&
              tokens(index).value != "chapter"
          ) {
            tokens(index).value match {
              case "sessions" =>
                val collected = collectSection(tokens, index + 1)
                importedSessions ++= collected.values.map(_.value)
                index = collected.nextIndex
              case "directories" =>
                val collected = collectSection(tokens, index + 1)
                directories ++= collected.values.map(_.value)
                index = collected.nextIndex
              case "theories" =>
                val collected = collectSection(tokens, index + 1)
                theories ++= collected.values.map(_.value)
                index = collected.nextIndex
              case "document_files" =>
                val collected = collectSection(tokens, index + 1)
                documentFiles ++= collected.values.map(_.value)
                index = collected.nextIndex
              case _ =>
                index += 1
            }
          }

          sessions += DiscoveredSession(
            name = name.get,
            parent = parent,
            rootDirectory = rootDirectory,
            sessionDirectory = sessionDirectory,
            theories = theories.map(resolveTheory(_, sessionDirectory, directories.toSeq)).toSeq,
            importedSessions = importedSessions.toSeq,
            directories = directories.toSeq,
            documentFiles = documentFiles.toSeq
          )
        }
      }
    }

    sessions.toSeq
  }

  private def collectSection(tokens: Seq[Token], startIndex: Int): CollectedSection = {
    val values = mutable.Buffer.empty[Token]
    var index = skipOptions(tokens, startIndex)

    while (index < tokens.length) {
      val value = tokens(index).value
      if (value == "session" || value == "chapter" || SectionKeywords.contains(value)) {
        return CollectedSection(values.toSeq, index)
      }

      if (value != "(" && value != ")" && value != "[" && value != "]" && value != ",") {
        values += tokens(index)
      }
      index += 1
    }

    CollectedSection(values.toSeq, index)
  }

  private def skipOptions(tokens: Seq[Token], startIndex: Int): Int = {
    var index = startIndex
    while (tokens.lift(index).exists(_.value == "[")) {
      var depth = 0
      do {
        tokens.lift(index).map(_.value).foreach {
          case "[" => depth += 1
          case "]" => depth -= 1
          case _ =>
        }
        index += 1
      } while (index < tokens.length && depth > 0)
    }
    index
  }

  private def skipBalancedGroups(tokens: Seq[Token], startIndex: Int): Int = {
    var index = startIndex
    while (tokens.lift(index).exists(_.value == "(")) {
      var depth = 0
      do {
        tokens.lift(index).map(_.value).foreach {
          case "(" => depth += 1
          case ")" => depth -= 1
          case _ =>
        }
        index += 1
      } while (index < tokens.length && depth > 0)
    }
    index
  }

  private def resolveTheory(
    theoryName: String,
    sessionDirectory: String,
    directories: Seq[String]
  ): DiscoveredTheory = {
    val roots = sessionDirectory +: directories.map(directory => joinPath(sessionDirectory, directory))
    val path = roots
      .flatMap(root => theoryPathCandidates(root, theoryName))
      .find(candidate => Files.isRegularFile(Path.of(candidate)))
    DiscoveredTheory(theoryName, path)
  }

  private def theoryPathCandidates(root: String, theoryName: String): Seq[String] = {
    val baseName =
      if (theoryName.endsWith(".thy")) theoryName.dropRight(4)
      else theoryName
    val flat = new File(root, s"$baseName.thy").getPath
    val qualified = new File(root, baseName.split("\\.").mkString(File.separator)).getPath + ".thy"
    Seq(flat, qualified).distinct
  }

  private def stripNestedComments(source: String): String = {
    val result = new StringBuilder
    var depth = 0
    var index = 0

    while (index < source.length) {
      val current = source.charAt(index)
      val next = if (index + 1 < source.length) source.charAt(index + 1) else 0.toChar

      if (current == '(' && next == '*') {
        depth += 1
        index += 2
      } else if (current == '*' && next == ')' && depth > 0) {
        depth -= 1
        index += 2
      } else {
        if (depth == 0) {
          result.append(current)
        }
        index += 1
      }
    }

    result.toString
  }

  private def tokenize(source: String): Seq[Token] = {
    val tokens = mutable.Buffer.empty[Token]
    var index = 0

    while (index < source.length) {
      val char = source.charAt(index)

      if (char.isWhitespace) {
        index += 1
      } else if (char == '"') {
        val parsed = readQuoted(source, index)
        tokens += Token(parsed.value, quoted = true)
        index = parsed.nextIndex
      } else if ("=+()[],".contains(char)) {
        tokens += Token(char.toString, quoted = false)
        index += 1
      } else {
        var end = index + 1
        while (
          end < source.length &&
            !source.charAt(end).isWhitespace &&
            !"=+()[],".contains(source.charAt(end))
        ) {
          end += 1
        }
        tokens += Token(source.slice(index, end), quoted = false)
        index = end
      }
    }

    tokens.toSeq
  }

  private def readQuoted(source: String, startIndex: Int): ParsedQuoted = {
    val value = new StringBuilder
    var index = startIndex + 1

    while (index < source.length) {
      val char = source.charAt(index)
      if (char == '\\' && index + 1 < source.length) {
        value.append(source.charAt(index + 1))
        index += 2
      } else if (char == '"') {
        return ParsedQuoted(value.toString, index + 1)
      } else {
        value.append(char)
        index += 1
      }
    }

    ParsedQuoted(value.toString, index)
  }

  private def sessionJson(session: DiscoveredSession): ujson.Value =
    {
      val json = ujson.Obj(
      "name" -> session.name,
      "rootDirectory" -> session.rootDirectory,
      "sessionDirectory" -> session.sessionDirectory,
      "theories" -> ujson.Arr(session.theories.map(theoryJson): _*),
      "importedSessions" -> ujson.Arr(session.importedSessions.map(ujson.Str(_)): _*),
      "directories" -> ujson.Arr(session.directories.map(ujson.Str(_)): _*),
      "documentFiles" -> ujson.Arr(session.documentFiles.map(ujson.Str(_)): _*)
    )
      session.parent.foreach(parent => json("parent") = parent)
      json
    }

  private def theoryJson(theory: DiscoveredTheory): ujson.Value =
    {
      val json = ujson.Obj("name" -> theory.name)
      theory.path.foreach(path => json("path") = path)
      json
    }

  private def readOptionalFile(path: Path): Option[String] =
    try {
      if (Files.isRegularFile(path)) {
        Some(Files.readString(path, StandardCharsets.UTF_8))
      } else {
        None
      }
    } catch {
      case _: AccessDeniedException | _: NoSuchFileException => None
    }

  private def resolvePath(base: String, value: String): String = {
    val file = new File(value)
    if (file.isAbsolute) file.getAbsolutePath else new File(base, value).getAbsolutePath
  }

  private def joinPath(base: String, value: String): String =
    new File(base, value).getPath

  private def canonicalPath(file: File): String =
    try file.getCanonicalPath
    catch {
      case NonFatal(_) => file.getAbsolutePath
    }

  private def unquote(value: String): String =
    if (value.startsWith("\"") && value.endsWith("\"")) value.slice(1, value.length - 1)
    else value

  private final case class DiscoveredSession(
    name: String,
    parent: Option[String],
    rootDirectory: String,
    sessionDirectory: String,
    theories: Seq[DiscoveredTheory],
    importedSessions: Seq[String],
    directories: Seq[String],
    documentFiles: Seq[String]
  )

  private final case class DiscoveredTheory(name: String, path: Option[String])
  private final case class Token(value: String, quoted: Boolean)
  private final case class ParsedQuoted(value: String, nextIndex: Int)
  private final case class CollectedSection(values: Seq[Token], nextIndex: Int)
}
