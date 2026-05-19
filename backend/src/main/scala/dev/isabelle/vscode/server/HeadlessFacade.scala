package dev.isabelle.vscode.server

import java.net.URLClassLoader
import java.nio.file.Path
import java.util.concurrent.atomic.AtomicBoolean
import scala.util.control.NonFatal

/**
 * Phase 2a lifecycle owner for a single live `isabelle.Headless.Session`.
 * Lazy-builds the session on first call; caches it for the life of
 * the backend process; shuts down on dispose.
 *
 * Cancellation: callers can flip the supplied [[AtomicBoolean]] true
 * to abort an in-flight warmup at the next safe boundary. Once the
 * Session has been constructed the cancellation flag is ignored
 * (`use_theories` itself is synchronous in 2a; full structured
 * cancellation arrives in 2b).
 */
final class HeadlessFacade private (
  loader: URLClassLoader,
  symbolTranslator: SymbolTranslator,
  sessionInstance: AnyRef,
  optionsInstance: AnyRef,
  val home: Path,
  val sessionName: String,
  val bootstrapNotes: Seq[String],
  val bootstrapElapsedMs: Long
) {
  private val sessionClass: Class[?] = sessionInstance.getClass

  private val useTheoriesMethod = sessionClass.getMethods.find(_.getName == "use_theories")
    .getOrElse(throw new NoSuchMethodException("Headless.Session.use_theories not found"))

  /**
   * Submit a single theory text against the cached session. Stages
   * the text on disk first (with Symbol.encode applied), then invokes
   * `use_theories(List(theoryName), qualifier="Draft",
   * master_dir=<scratch>, unicode_symbols=true, ...defaults)`.
   *
   * Catches `Throwable` because reflective entry points can surface
   * `LinkageError` and friends that `NonFatal` does not cover.
   */
  def submitTheory(
    workspaceUri: String,
    theoryName: String,
    unicodeText: String,
    scratchStore: ScratchTheoryStore
  ): Either[String, HeadlessFacade.SubmissionResult] = {
    val startedAt = System.currentTimeMillis()
    val sanitizedName = ScratchTheoryStore.sanitizeTheoryName(theoryName)
    val masterPath = try {
      scratchStore.stage(workspaceUri, sanitizedName, unicodeText)
    } catch {
      case t: Throwable => return Left(s"Failed to stage theory text: ${describe(t)}")
    }

    val masterDir = Option(masterPath.getParent).map(_.toString).getOrElse("")
    val isabellePath = HeadlessFacade.toIsabellePath(loader, masterDir).getOrElse(masterDir)

    try {
      // Build the 12 args, taking defaults for everything except positions 0-3.
      val args = (1 to useTheoriesMethod.getParameterCount).map { idx =>
        try {
          val m = sessionClass.getMethod(s"use_theories$$default$$$idx")
          m.invoke(sessionInstance)
        } catch {
          case _: Throwable => null
        }
      }.toArray

      // Positions: 0=theories(List), 1=qualifier(String), 2=master_dir(String), 3=unicode_symbols(Boolean)
      args(0) = HeadlessFacade.scalaListOf(loader, sanitizedName)
      args(1) = "Draft"
      args(2) = isabellePath
      args(3) = java.lang.Boolean.TRUE

      val result = useTheoriesMethod.invoke(sessionInstance, args*)
      HeadlessFacade.parseUseTheoriesResult(result, symbolTranslator) match {
        case Right(parsed) =>
          val elapsed = System.currentTimeMillis() - startedAt
          Right(parsed.copy(elapsedMs = elapsed))
        case Left(err) => Left(s"use_theories result parse failed: $err")
      }
    } catch {
      case t: Throwable => Left(s"use_theories invocation failed: ${describe(t)}")
    }
  }

  /**
   * Shut down the underlying session and close the classloader.
   * Safe to call multiple times — second call is a no-op.
   */
  def shutdown(): Unit = {
    HeadlessBootstrap.stopSession(sessionInstance)
    try loader.close() catch { case _: Throwable => () }
  }

  private def describe(t: Throwable): String = {
    // Unwrap InvocationTargetException to get the actual reflection target's exception,
    // then walk the full cause chain so Isabelle's User_Error / etc. messages surface.
    val unwrapped = t match {
      case e: java.lang.reflect.InvocationTargetException if e.getCause != null => e.getCause
      case other => other
    }
    val msg = Option(unwrapped.getMessage).filter(_.nonEmpty).getOrElse(unwrapped.getClass.getSimpleName)
    var cause = unwrapped.getCause
    val causeChain = scala.collection.mutable.Buffer.empty[String]
    var depth = 0
    while (cause != null && depth < 5) {
      val cmsg = Option(cause.getMessage).filter(_.nonEmpty).getOrElse(cause.getClass.getSimpleName)
      causeChain += s"${cause.getClass.getSimpleName}: $cmsg"
      cause = cause.getCause
      depth += 1
    }
    val causeText = if (causeChain.isEmpty) "" else s" (caused by: ${causeChain.mkString(" -> ")})"
    s"${unwrapped.getClass.getSimpleName}: $msg$causeText"
  }
}

object HeadlessFacade {

  /** Coarse-grained submission result. Phase 2a returns whole-document
    * ok/error counts; detailed per-command status mapping is deferred
    * to a future sub-phase per the user's locked scope. */
  final case class SubmissionResult(
    ok: Boolean,
    nodeCount: Int,
    nodeNames: List[String],
    errorCount: Int,
    errorMessages: List[String],
    elapsedMs: Long
  )

  sealed trait BuildError {
    def step: String
    def reason: String
    def notes: Seq[String]
    def message: String = s"[$step] $reason"
  }
  final case class CancelledBuild(notes: Seq[String]) extends BuildError {
    override val step: String = "build"
    override val reason: String = "Warmup cancelled before session was ready"
  }
  final case class BootstrapError(step: String, reason: String, notes: Seq[String]) extends BuildError

  /**
   * Build a fully-warmed facade. Checks `cancelFlag` between bootstrap
   * steps and aborts cleanly if true. The classloader is owned by
   * the returned facade — caller must not close it directly; use
   * [[HeadlessFacade.shutdown]] instead.
   */
  def build(
    loader: URLClassLoader,
    home: Path,
    cygwinRoot: String,
    sessionName: String,
    symbolTranslator: SymbolTranslator,
    cancelFlag: AtomicBoolean
  ): Either[BuildError, HeadlessFacade] = {
    if (cancelFlag.get()) return Left(CancelledBuild(Seq("cancelled before Environment.init")))

    HeadlessBootstrap.bootstrap(loader, home, cygwinRoot, sessionName) match {
      case HeadlessBootstrap.BootstrapFailure(step, reason, notes) =>
        try loader.close() catch { case _: Throwable => () }
        Left(BootstrapError(step, reason, notes))

      case HeadlessBootstrap.BootstrapSuccess(session, options, elapsed, notes) =>
        if (cancelFlag.get()) {
          // Clean up the session we just built.
          HeadlessBootstrap.stopSession(session)
          try loader.close() catch { case _: Throwable => () }
          Left(CancelledBuild(notes :+ "cancelled after bootstrap"))
        } else {
          Right(new HeadlessFacade(
            loader = loader,
            symbolTranslator = symbolTranslator,
            sessionInstance = session,
            optionsInstance = options,
            home = home,
            sessionName = sessionName,
            bootstrapNotes = notes,
            bootstrapElapsedMs = elapsed
          ))
        }
    }
  }

  /** Translate a platform-native path (Windows `C:\...`, POSIX `/...`)
    * into the slash-form Isabelle's parser expects. Uses
    * `isabelle.setup.Environment.standard_path` reflectively. Returns
    * None on reflective failure so the caller falls back to the raw
    * platform path. */
  private[server] def toIsabellePath(loader: ClassLoader, platformPath: String): Option[String] = {
    try {
      val cls = Class.forName("isabelle.setup.Environment", true, loader)
      val method = cls.getMethods.find(m =>
        m.getName == "standard_path" && m.getParameterCount == 1 &&
          m.getParameterTypes()(0) == classOf[String]
      ).getOrElse(return None)
      Some(method.invoke(null, platformPath).asInstanceOf[String])
    } catch {
      case _: Throwable => None
    }
  }

  /** Construct a Scala `List(theoryName)` reflectively via the
    * classloader so the instance is the same `scala.collection.immutable.List`
    * that Headless was compiled against. Uses the cons-cell constructor
    * (`value :: Nil`) directly so we don't depend on `List$.apply`'s
    * compiled varargs signature, which differs across Scala patch
    * releases and is awkward to match by reflection. */
  private[server] def scalaListOf(loader: ClassLoader, value: String): AnyRef = {
    val nilModule = Class.forName("scala.collection.immutable.Nil$", true, loader)
      .getField("MODULE$").get(null)
    val consClass = Class.forName("scala.collection.immutable.$colon$colon", true, loader)
    // Constructor signature: (head: A, next: List[A])
    val ctors = consClass.getConstructors
    val ctor = ctors.find(_.getParameterCount == 2).getOrElse(
      throw new NoSuchMethodException("scala.collection.immutable.$colon$colon constructor not found")
    )
    ctor.newInstance(value, nilModule).asInstanceOf[AnyRef]
  }

  /**
   * Reflectively read the four fields we care about off a
   * `isabelle.Headless.Use_Theories_Result`. Errors collected per
   * node are decoded back to Unicode for display.
   */
  private[server] def parseUseTheoriesResult(
    result: AnyRef,
    symbolTranslator: SymbolTranslator
  ): Either[String, SubmissionResult] = {
    try {
      val cls = result.getClass

      def callList(name: String): scala.collection.immutable.List[AnyRef] = {
        val m = cls.getMethod(name)
        val out = m.invoke(result)
        out.asInstanceOf[scala.collection.immutable.List[AnyRef]]
      }

      val nodes = callList("nodes")
      val ok = cls.getMethod("ok").invoke(result).asInstanceOf[java.lang.Boolean].booleanValue()

      val nodeNames = nodes.map { entry =>
        try {
          val tuple = entry.asInstanceOf[scala.Tuple2[AnyRef, AnyRef]]
          val nameObj = tuple._1
          // Document.Node.Name has a `toString` that returns the theory's logical name.
          Option(nameObj).map(_.toString).getOrElse("<unnamed>")
        } catch {
          case _: Throwable => entry.toString
        }
      }

      val errorMessages = nodes.flatMap { entry =>
        try {
          val tuple = entry.asInstanceOf[scala.Tuple2[AnyRef, AnyRef]]
          val nodeStatus = tuple._2
          val statusCls = nodeStatus.getClass
          // Node_Status.failed: Int — quick "did this node have any failed commands"
          val failedField = statusCls.getMethods.find(m => m.getName == "failed" && m.getParameterCount == 0)
          val failedCount = failedField.map(_.invoke(nodeStatus).asInstanceOf[Integer].intValue()).getOrElse(0)
          if (failedCount > 0) {
            val name = Option(tuple._1).map(_.toString).getOrElse("<unnamed>")
            Some(s"$name: $failedCount failed command(s)")
          } else None
        } catch {
          case _: Throwable => None
        }
      }

      Right(SubmissionResult(
        ok = ok,
        nodeCount = nodes.size,
        nodeNames = nodeNames,
        errorCount = errorMessages.size,
        errorMessages = errorMessages.map(symbolTranslator.decode),
        elapsedMs = 0L // filled in by caller
      ))
    } catch {
      case t: Throwable =>
        val msg = Option(t.getMessage).getOrElse(t.getClass.getSimpleName)
        Left(s"${t.getClass.getSimpleName}: $msg")
    }
  }
}
