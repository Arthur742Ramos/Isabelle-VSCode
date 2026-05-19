package dev.isabelle.vscode.server

import scala.util.control.NonFatal

/**
 * Phase 3 reflective extractor for `isabelle.Document.Snapshot` →
 * proof state. Walks the snapshot's commands, finds the command at
 * a `(line, character)` cursor position using shared offset
 * arithmetic, then asks `Snapshot.state.command_states(...)` for
 * the live command states. Each state carries an XML tree the
 * `isabelle.XML.content(...)` helper flattens to plain text.
 *
 * Catches `Throwable` (not `NonFatal`) at every reflective boundary
 * because Isabelle's static initializers throw `LinkageError`
 * subclasses (see AGENTS.md §12).
 */
object SnapshotProofStateExtractor {

  /**
   * Output of [[extractAt]]. Goal list + raw flattened text.
   * Context entries are left empty for Phase 3 — populating them
   * requires more reflection into PIDE's local-context surface;
   * deferred to a follow-up phase or live triage.
   */
  final case class ExtractedProofState(
    commandKind: Option[String],
    commandName: Option[String],
    commandRangeOffsets: Option[(Int, Int)],
    goals: Seq[String],
    raw: String,
    notes: Seq[String]
  )

  /**
   * Probe the snapshot for the command at the user's cursor and
   * extract its proof state. Returns `Left` on reflective failure
   * with a structured reason the handler can surface as
   * `status: "unavailable"`.
   *
   * @param loader   The classloader the Headless session was built
   *                 against — used to reflect on `isabelle.XML`.
   * @param snapshot The live `isabelle.Document.Snapshot` instance.
   * @param documentText The original (Unicode) source text — needed
   *                     because PIDE's command ranges are character
   *                     offsets, but the cursor came in as
   *                     `(line, character)`. We resolve the cursor
   *                     to an offset via [[OffsetToPosition]].
   * @param line     0-based line of the cursor.
   * @param character 0-based UTF-16 column of the cursor.
   */
  def extractAt(
    loader: ClassLoader,
    snapshot: AnyRef,
    documentText: String,
    line: Int,
    character: Int
  ): Either[String, ExtractedProofState] = {
    val notes = scala.collection.mutable.Buffer.empty[String]
    try {
      val cursorOffset = OffsetToPosition.positionToOffset(documentText, line, character)

      val commands = listCommands(snapshot) match {
        case Left(err) => return Left(err)
        case Right(list) =>
          notes += s"snapshot has ${list.size} commands"
          list
      }

      val (matched, runningOffset) = findCommandAtOffset(commands, cursorOffset)
      matched match {
        case None =>
          Right(ExtractedProofState(
            commandKind = None,
            commandName = None,
            commandRangeOffsets = None,
            goals = Seq.empty,
            raw = "",
            notes = notes.toSeq :+ s"no command found at offset $cursorOffset"
          ))
        case Some((commandObj, startOffset, length)) =>
          val commandKind = invokeStringMethod(commandObj, "kind").orElse(invokeStringMethod(commandObj, "command_name")).orElse(invokeStringMethod(commandObj, "name"))
          val commandName = invokeStringMethod(commandObj, "name")
          val source = invokeStringMethod(commandObj, "source").getOrElse("")
          notes += s"matched command at offset=$startOffset length=$length kind=${commandKind.getOrElse("?")} source-len=${source.length}"

          // Reflectively grab state.command_states(version, command)
          val rawAndGoals = extractStateMarkup(loader, snapshot, commandObj, notes)
          val (raw, goals) = rawAndGoals.getOrElse(("", Seq.empty[String]))

          Right(ExtractedProofState(
            commandKind = commandKind,
            commandName = commandName,
            commandRangeOffsets = Some((startOffset, startOffset + length)),
            goals = goals,
            raw = raw,
            notes = notes.toSeq
          ))
      }
    } catch {
      case t: Throwable =>
        Left(s"snapshot extraction failed: ${describe(t)}")
    }
  }

  /** Reflectively walk `snapshot.node.commands.toList`. */
  private def listCommands(snapshot: AnyRef): Either[String, List[AnyRef]] = {
    try {
      val nodeMethod = snapshot.getClass.getMethods.find(m => m.getName == "node" && m.getParameterCount == 0)
        .getOrElse(return Left("Snapshot.node() not found"))
      val node = nodeMethod.invoke(snapshot)
      if (node == null) return Left("Snapshot.node() returned null")

      val commandsMethod = node.getClass.getMethods.find(m => m.getName == "commands" && m.getParameterCount == 0)
        .getOrElse(return Left("Document.Node.commands() not found"))
      val commands = commandsMethod.invoke(node)
      if (commands == null) return Left("Document.Node.commands() returned null")

      val toListMethod = commands.getClass.getMethods.find(m => m.getName == "toList" && m.getParameterCount == 0)
        .getOrElse(return Left("commands.toList() not found"))
      Right(toListMethod.invoke(commands).asInstanceOf[scala.collection.immutable.List[AnyRef]])
    } catch {
      case t: Throwable => Left(describe(t))
    }
  }

  /**
   * Walk the command list and find the command that contains the
   * cursor offset. PIDE commands are sequential; we accumulate
   * `length()` to derive the running offset. Returns the matched
   * command + its start offset + length. If the cursor sits before
   * the first command, returns None.
   *
   * Matches the placeholder bridge's "if cursor is between commands,
   * pick the last command before the cursor" semantics so the proof
   * state panel feels consistent.
   */
  private def findCommandAtOffset(
    commands: List[AnyRef],
    cursorOffset: Int
  ): (Option[(AnyRef, Int, Int)], Int) = {
    var runningOffset = 0
    var lastBefore: Option[(AnyRef, Int, Int)] = None
    val it = commands.iterator
    while (it.hasNext) {
      val cmd = it.next()
      val length = invokeIntMethod(cmd, "length").getOrElse(0)
      val endOffset = runningOffset + length
      if (cursorOffset >= runningOffset && cursorOffset < endOffset) {
        return (Some((cmd, runningOffset, length)), runningOffset)
      }
      if (runningOffset <= cursorOffset) {
        lastBefore = Some((cmd, runningOffset, length))
      }
      runningOffset = endOffset
    }
    (lastBefore, runningOffset)
  }

  /**
   * Reflectively call `snapshot.state.command_states(version, command)`,
   * collect the resulting list of `Command.State` instances, and
   * extract their markup via `XML.content(tree)`. Returns the
   * combined raw text + a heuristic split into goals.
   */
  private def extractStateMarkup(
    loader: ClassLoader,
    snapshot: AnyRef,
    commandObj: AnyRef,
    notes: scala.collection.mutable.Buffer[String]
  ): Option[(String, Seq[String])] = {
    try {
      val stateMethod = snapshot.getClass.getMethods.find(m => m.getName == "state" && m.getParameterCount == 0)
        .getOrElse { notes += "snapshot.state() not found"; return None }
      val state = stateMethod.invoke(snapshot)
      val versionMethod = snapshot.getClass.getMethods.find(m => m.getName == "version" && m.getParameterCount == 0)
        .getOrElse { notes += "snapshot.version() not found"; return None }
      val version = versionMethod.invoke(snapshot)

      val csMethod = state.getClass.getMethods.find(m =>
        m.getName == "command_states" && m.getParameterCount == 2
      ).getOrElse { notes += "state.command_states(2 args) not found"; return None }

      val statesList = csMethod.invoke(state, version, commandObj).asInstanceOf[scala.collection.immutable.List[AnyRef]]
      notes += s"command_states returned ${statesList.size} state(s)"
      if (statesList.isEmpty) return Some(("", Seq.empty))

      // For each Command.State, get the results / status markup and
      // flatten via XML.content. Command.State.results is the most
      // useful field for proof goals; failing that, fall back to
      // the State's full markup tree if accessible.
      val xmlCls = Class.forName("isabelle.XML$", true, loader)
      val xmlModule = xmlCls.getField("MODULE$").get(null)
      val xmlContentTree = xmlCls.getMethods.find(m =>
        m.getName == "content" && m.getParameterCount == 1 &&
          m.getParameterTypes()(0).getSimpleName != "List"
      )
      val xmlContentList = xmlCls.getMethods.find(m =>
        m.getName == "content" && m.getParameterCount == 1 &&
          m.getParameterTypes()(0).getSimpleName == "List"
      )

      val combined = statesList.flatMap { cmdState =>
        extractFromCommandState(cmdState, xmlModule, xmlContentTree, xmlContentList, notes)
      }
      val raw = combined.mkString("\n").trim
      val goals = splitGoals(raw)
      Some((raw, goals))
    } catch {
      case t: Throwable =>
        notes += s"extractStateMarkup failure: ${describe(t)}"
        None
    }
  }

  /**
   * Probe a `Command.State` for printable markup. Tries several
   * candidate accessors in order of preference. Returns whatever
   * non-empty strings we manage to extract.
   */
  private def extractFromCommandState(
    cmdState: AnyRef,
    xmlModule: AnyRef,
    xmlContentTree: Option[java.lang.reflect.Method],
    xmlContentList: Option[java.lang.reflect.Method],
    notes: scala.collection.mutable.Buffer[String]
  ): Seq[String] = {
    val cls = cmdState.getClass
    val out = scala.collection.mutable.Buffer.empty[String]

    // Candidate accessors carrying useful markup. `results` is the
    // standard PIDE result list (Command.Results — a wrapper around
    // SortedMap[Long, XML.Tree]). `eval_state` may also be useful.
    // The full state's print operation is the canonical way to
    // extract proof goals but requires reflective construction of
    // a Print_Operation — too fragile for Phase 3 first cut.
    val candidateNames = Seq("results", "markup", "status")
    for (name <- candidateNames) {
      try {
        val m = cls.getMethods.find(m2 => m2.getName == name && m2.getParameterCount == 0)
        m.foreach { method =>
          val value = method.invoke(cmdState)
          if (value != null) {
            val text = renderMarkupValue(value, xmlModule, xmlContentTree, xmlContentList, notes)
            if (text.nonEmpty) {
              out += s"[$name]\n$text"
            }
          }
        }
      } catch {
        case NonFatal(t) => notes += s"$name accessor failed: ${describe(t)}"
      }
    }

    out.toSeq
  }

  /**
   * Best-effort: try to render an arbitrary markup-bearing PIDE
   * value as plain text. Walks a few common shapes:
   *   1. scala List → XML.content(list).
   *   2. PIDE Command.Results (has .iterator returning (Long, Tree) pairs).
   *   3. Single XML.Tree → XML.content(tree).
   *   4. toString fallback.
   */
  private def renderMarkupValue(
    value: AnyRef,
    xmlModule: AnyRef,
    xmlContentTree: Option[java.lang.reflect.Method],
    xmlContentList: Option[java.lang.reflect.Method],
    notes: scala.collection.mutable.Buffer[String]
  ): String = {
    // 1. Is it a scala List?
    if (value.isInstanceOf[scala.collection.immutable.List[?]]) {
      val list = value.asInstanceOf[scala.collection.immutable.List[AnyRef]]
      xmlContentList.foreach { m =>
        try {
          val s = m.invoke(xmlModule, list).asInstanceOf[String]
          if (s != null && s.nonEmpty) return s
        } catch { case _: Throwable => () }
      }
      return list.map(_.toString).mkString("\n")
    }

    // 2. PIDE Command.Results / Exports / similar exposes `.iterator`
    // returning (Long, AnyRef) pairs where the AnyRef is an XML.Tree.
    try {
      val iteratorMethod = value.getClass.getMethods.find(m2 => m2.getName == "iterator" && m2.getParameterCount == 0)
      iteratorMethod.foreach { m =>
        val it = m.invoke(value).asInstanceOf[Iterator[AnyRef]]
        val sb = new StringBuilder
        var emitted = 0
        while (it.hasNext && emitted < 100) {
          val element = it.next()
          val tree = element match {
            case tuple: scala.Tuple2[?, ?] => tuple._2.asInstanceOf[AnyRef]
            case other: AnyRef             => other
          }
          if (tree != null) {
            xmlContentTree.foreach { tm =>
              try {
                val s = tm.invoke(xmlModule, tree).asInstanceOf[String]
                if (s != null && s.nonEmpty) {
                  if (sb.nonEmpty) sb.append("\n")
                  sb.append(s)
                  emitted += 1
                }
              } catch { case _: Throwable => () }
            }
          }
        }
        if (sb.nonEmpty) return sb.toString
      }
    } catch {
      case t: Throwable => notes += s"iterator-render failed: ${describe(t)}"
    }

    // 3. Try XML.content(value) as Tree.
    xmlContentTree.foreach { m =>
      try {
        val s = m.invoke(xmlModule, value).asInstanceOf[String]
        if (s != null && s.nonEmpty) return s
      } catch { case _: Throwable => () }
    }

    // 4. Final fallback: toString.
    Option(value.toString).getOrElse("")
  }

  /**
   * Split a flattened proof-state body into per-goal entries. PIDE
   * uses markers like "proof (prove)", "goal (N subgoals):", "1.",
   * "2." etc. Our heuristic: split on lines starting with a digit
   * followed by ".". Keeps the leading marker; falls back to a
   * single entry if no markers are present.
   */
  private[server] def splitGoals(raw: String): Seq[String] = {
    if (raw.isEmpty) return Seq.empty
    val lines = raw.split("\n", -1)
    val groups = scala.collection.mutable.Buffer.empty[scala.collection.mutable.Buffer[String]]
    var current = scala.collection.mutable.Buffer.empty[String]
    for (l <- lines) {
      val trimmed = l.trim
      // New goal marker: "1." or "12." (digit-dot at line start)
      if (trimmed.matches("^\\d+\\..*")) {
        if (current.nonEmpty) groups += current
        current = scala.collection.mutable.Buffer.empty[String]
      }
      current += l
    }
    if (current.nonEmpty) groups += current
    if (groups.size <= 1) Seq(raw.trim)
    else groups.map(_.mkString("\n").trim).toSeq
  }

  private def invokeStringMethod(target: AnyRef, name: String): Option[String] = {
    try {
      target.getClass.getMethods.find(m => m.getName == name && m.getParameterCount == 0).flatMap { m =>
        val v = m.invoke(target)
        if (v == null) None
        else if (v.isInstanceOf[String]) Some(v.asInstanceOf[String]).filter(_.nonEmpty)
        else Some(v.toString).filter(_.nonEmpty)
      }
    } catch { case _: Throwable => None }
  }

  private def invokeIntMethod(target: AnyRef, name: String): Option[Int] = {
    try {
      target.getClass.getMethods.find(m => m.getName == name && m.getParameterCount == 0).flatMap { m =>
        val v = m.invoke(target)
        if (v == null) None
        else Some(v.asInstanceOf[java.lang.Integer].intValue)
      }
    } catch { case _: Throwable => None }
  }

  private def describe(t: Throwable): String = {
    val unwrapped = t match {
      case e: java.lang.reflect.InvocationTargetException if e.getCause != null => e.getCause
      case other => other
    }
    val msg = Option(unwrapped.getMessage).filter(_.nonEmpty).getOrElse(unwrapped.getClass.getSimpleName)
    s"${unwrapped.getClass.getSimpleName}: $msg"
  }
}
