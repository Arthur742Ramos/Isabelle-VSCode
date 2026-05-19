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
   * How to filter `snapshot.messages` entries against the cursor's
   * command range. Phase 3c (#92) made the filter explicit so
   * Sledgehammer (which needs whole-file output to harvest "Try
   * this:" lines that may sit on the injected command's range or
   * be unpositioned) cannot be silently regressed by tightening the
   * proof state panel's per-cursor focus.
   */
  sealed trait MessageFilterMode
  object MessageFilterMode {
    /** Phase 3c default for `proofState/getWithPide`: include only
     *  positioned entries that overlap the cursor's command range.
     *  Falls back to "include all" if NO entry has positional info
     *  (so a build that emits everything unpositioned still works). */
    case object CursorCommandOnly extends MessageFilterMode
    /** Phase 3b legacy behavior used by `SledgehammerWithPideHandler`:
     *  include every entry regardless of position. Required because
     *  Sledgehammer "Try this:" output may be unpositioned OR
     *  positioned outside the injected command's range. */
    case object WholeSnapshot extends MessageFilterMode
  }

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
   * @param loader     The classloader the Headless session was built
   *                   against — used to reflect on `isabelle.XML`.
   * @param snapshot   The live `isabelle.Document.Snapshot` instance.
   * @param documentText The original (Unicode) source text — needed
   *                   because PIDE's command ranges are character
   *                   offsets, but the cursor came in as
   *                   `(line, character)`. We resolve the cursor
   *                   to an offset via [[OffsetToPosition]].
   * @param line       0-based line of the cursor.
   * @param character  0-based UTF-16 column of the cursor.
   * @param filterMode See [[MessageFilterMode]]. Defaults to
   *                   `CursorCommandOnly` (Phase 3c) so the proof
   *                   state panel shows per-cursor focus; pass
   *                   `WholeSnapshot` from Sledgehammer to keep
   *                   harvesting "Try this:" output regardless of
   *                   per-command positioning.
   */
  def extractAt(
    loader: ClassLoader,
    snapshot: AnyRef,
    documentText: String,
    line: Int,
    character: Int,
    filterMode: MessageFilterMode = MessageFilterMode.CursorCommandOnly
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
          notes += s"matched command at offset=$startOffset length=$length kind=${commandKind.getOrElse("?")} source-len=${source.length} filter=$filterMode"

          // Reflectively grab state.command_states(version, command)
          val rawAndGoals = extractStateMarkup(loader, snapshot, commandObj, notes)

          // Phase 3b/3c: also probe `snapshot.messages`. Phase 3c
          // routes through the explicit filter mode so the proof
          // state panel can focus on the cursor's command while
          // Sledgehammer keeps its whole-file harvest.
          val printedState = extractPrinterMessages(loader, snapshot, startOffset, length, filterMode, notes)
          val (raw0, goals0) = rawAndGoals.getOrElse(("", Seq.empty[String]))
          val (raw, goals) =
            if (printedState.nonEmpty) {
              val printedRaw = printedState.mkString("\n").trim
              val combined = if (raw0.isEmpty) printedRaw else printedRaw + "\n---\n" + raw0
              (combined, splitGoals(printedRaw))
            } else (raw0, goals0)

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

  /**
   * Phase 3b/3c: reflectively call `snapshot.messages` and apply
   * the requested filter mode. The reflective walk is unchanged
   * from Phase 3b; what's new is that each entry is now collected
   * WITH its optional positional info and the
   * include-or-skip decision happens after the full pass so the
   * "all unpositioned → include all" fallback works deterministically.
   *
   * Empty on any reflective failure (the Phase 3a `[results]`
   * fallback then applies).
   */
  private def extractPrinterMessages(
    loader: ClassLoader,
    snapshot: AnyRef,
    commandStartOffset: Int,
    commandLength: Int,
    filterMode: MessageFilterMode,
    notes: scala.collection.mutable.Buffer[String]
  ): Seq[String] = {
    try {
      val messagesMethod = snapshot.getClass.getMethods.find(m => m.getName == "messages" && m.getParameterCount == 0)
      if (messagesMethod.isEmpty) {
        notes += "snapshot.messages() not found"
        return Seq.empty
      }
      val messagesRaw = messagesMethod.get.invoke(snapshot)
      if (messagesRaw == null) return Seq.empty

      val xmlCls = Class.forName("isabelle.XML$", true, loader)
      val xmlModule = xmlCls.getField("MODULE$").get(null)
      val contentTree = xmlCls.getMethods.find(m =>
        m.getName == "content" && m.getParameterCount == 1 &&
          m.getParameterTypes()(0).getSimpleName != "List"
      )

      // (Option[(start, stop)], renderedText) per entry — collected first,
      // then policy applied. Allows the deterministic "all-unpositioned"
      // fallback for CursorCommandOnly.
      val collected = scala.collection.mutable.Buffer.empty[(Option[(Int, Int)], String)]

      def renderTree(tree: AnyRef): Option[String] =
        contentTree.flatMap { m =>
          try {
            val s = m.invoke(xmlModule, tree).asInstanceOf[String]
            if (s == null || s.isEmpty) None else Some(s)
          } catch { case _: Throwable => None }
        }

      def processEntry(entry: AnyRef): Unit = {
        try {
          val tuple = entry.asInstanceOf[scala.Tuple2[AnyRef, AnyRef]]
          val first = tuple._1
          // Phase 3c: probe for positional info on the first element
          // directly. Phase 3b assumed `info()` was always present,
          // but for `Text.Info[XML.Elem]` the canonical accessors are
          // `range()` on the wrapper and `info()` for the payload.
          val entryRange = reflectRangeStartStop(first)
          // The XML to render is `first.info()` when `first` was a
          // `Text.Info[_]` wrapper, otherwise `first` itself.
          val infoMethod = first.getClass.getMethods.find(m => m.getName == "info" && m.getParameterCount == 0)
          val xmlElem = infoMethod.map(_.invoke(first)).getOrElse(first)
          renderTree(xmlElem).foreach { rendered =>
            collected += ((entryRange, rendered))
          }
        } catch {
          case _: Throwable => () // entry doesn't match the expected shape; skip
        }
      }

      messagesRaw match {
        case list: scala.collection.immutable.List[?] =>
          list.foreach(e => processEntry(e.asInstanceOf[AnyRef]))
        case iterable: scala.collection.Iterable[?] =>
          iterable.foreach(e => processEntry(e.asInstanceOf[AnyRef]))
        case other =>
          // Try toList
          val toListMethod = other.getClass.getMethods.find(m => m.getName == "toList" && m.getParameterCount == 0)
          toListMethod.foreach { m =>
            val list = m.invoke(other).asInstanceOf[scala.collection.immutable.List[AnyRef]]
            list.foreach(processEntry)
          }
      }

      val commandStop = commandStartOffset + commandLength
      val filtered = applyFilter(collected.toSeq, commandStartOffset, commandStop, filterMode, notes)
      notes += s"snapshot.messages collected=${collected.size} kept=${filtered.size} (mode=$filterMode)"
      filtered
    } catch {
      case t: Throwable =>
        notes += s"extractPrinterMessages failure: ${describe(t)}"
        Seq.empty
    }
  }

  /**
   * Phase 3c filter policy. Pure function — extracted so the
   * range-overlap behavior can be tested without standing up a
   * synthetic reflective snapshot.
   *
   *   - WholeSnapshot: return every rendered entry's text.
   *   - CursorCommandOnly:
   *       * If NO entry has positional info, return every rendered
   *         entry's text (with a note explaining the fallback —
   *         range filtering is not available for this snapshot).
   *       * Otherwise, return only positioned entries that overlap
   *         the cursor's command range. Unpositioned entries are
   *         dropped in this case to avoid re-introducing the
   *         whole-file noise that Phase 3c is meant to remove.
   */
  private[server] def applyFilter(
    collected: Seq[(Option[(Int, Int)], String)],
    commandStart: Int,
    commandStop: Int,
    filterMode: MessageFilterMode,
    notes: scala.collection.mutable.Buffer[String]
  ): Seq[String] = filterMode match {
    case MessageFilterMode.WholeSnapshot =>
      collected.map(_._2)
    case MessageFilterMode.CursorCommandOnly =>
      val anyPositioned = collected.exists(_._1.isDefined)
      if (!anyPositioned) {
        notes += "range filtering unavailable — no positional info on any message entry; including all"
        collected.map(_._2)
      } else {
        val kept = collected.collect {
          case (Some((start, stop)), text) if rangesOverlap(start, stop, commandStart, commandStop) => text
        }
        val droppedPositioned = collected.count {
          case (Some((start, stop)), _) => !rangesOverlap(start, stop, commandStart, commandStop)
          case _                        => false
        }
        val droppedUnpositioned = collected.count(_._1.isEmpty)
        if (droppedPositioned > 0) notes += s"dropped $droppedPositioned positioned message(s) outside command range [$commandStart..$commandStop)"
        if (droppedUnpositioned > 0) notes += s"dropped $droppedUnpositioned unpositioned message(s) (mixed mode policy)"
        kept
      }
  }

  /**
   * Half-open range overlap. Two ranges `[a, b)` and `[c, d)`
   * overlap iff each is non-empty AND `a < d && c < b`. Pure —
   * tested directly.
   *
   * Zero-length ranges (where start == stop) are empty intervals
   * and overlap nothing. This matters when `cmd.length() == 0` for
   * a malformed snapshot OR when a message position is point-like.
   */
  private[server] def rangesOverlap(aStart: Int, aStop: Int, bStart: Int, bStop: Int): Boolean =
    aStart < aStop && bStart < bStop && aStart < bStop && bStart < aStop

  /**
   * Probe the first element of a `snapshot.messages` tuple for
   * positional info. Tries `range()` on the entry directly (matches
   * `Text.Info[_]`'s `range` accessor), falls back to `info()` then
   * `range()` (for any wrapper-of-wrapper shape Isabelle might
   * surface).
   *
   * Returns `Some((start, stop))` only when both accessors are
   * present and return non-null Int values.
   */
  private def reflectRangeStartStop(target: AnyRef): Option[(Int, Int)] = {
    def rangeOf(t: AnyRef): Option[AnyRef] =
      try {
        t.getClass.getMethods.find(m => m.getName == "range" && m.getParameterCount == 0)
          .flatMap(m => Option(m.invoke(t)))
      } catch { case _: Throwable => None }

    def startStopOf(range: AnyRef): Option[(Int, Int)] = {
      def intOf(name: String): Option[Int] =
        try {
          range.getClass.getMethods.find(m => m.getName == name && m.getParameterCount == 0).flatMap { m =>
            val v = m.invoke(range)
            if (v == null) None
            else v match {
              case i: java.lang.Integer => Some(i.intValue)
              case l: java.lang.Long    => Some(l.intValue)
              case _                    => None
            }
          }
        } catch { case _: Throwable => None }

      for {
        s <- intOf("start")
        e <- intOf("stop")
      } yield (s, e)
    }

    rangeOf(target).flatMap(startStopOf).orElse {
      try {
        val infoMethod = target.getClass.getMethods.find(m => m.getName == "info" && m.getParameterCount == 0)
        infoMethod.flatMap(m => Option(m.invoke(target))).flatMap(inner => rangeOf(inner)).flatMap(startStopOf)
      } catch { case _: Throwable => None }
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
