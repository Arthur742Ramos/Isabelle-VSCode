package dev.isabelle.vscode.server

import java.nio.file.{Files, Path, Paths}
import scala.util.control.NonFatal

/**
 * Reflective bootstrap for Isabelle's PIDE classes from a child
 * `URLClassLoader`. Phase 2a verified this whole chain end-to-end
 * against `Isabelle2025-2`:
 *
 *   1. `isabelle.setup.Environment.init(isabelle_root, cygwin_root)`
 *      — runs bash on Windows (via Isabelle's bundled Cygwin) to
 *      execute `isabelle getenv -d` and load the resolved settings
 *      into Environment's static `_settings` map. **This is the
 *      mandatory bootstrap step**: every other Isabelle class that
 *      reaches Symbol → Isabelle_System → Settings → Environment
 *      will trigger `Environment.init("","")` from a class
 *      initializer, which throws `Unknown Isabelle root directory`
 *      unless `Environment._settings` is already populated OR
 *      `ISABELLE_ROOT` / `isabelle.root` is set in the JVM
 *      environment.
 *
 *   2. `isabelle.Isabelle_System.init(isabelle_root, cygwin_root)` —
 *      additional belt-and-suspenders init that mirrors the call
 *      Isabelle's own launcher makes. Not strictly required if
 *      Environment.init has run (Isabelle_System.settings delegates
 *      to Environment.settings) but invoked here defensively because
 *      `start_session` is the first call we did not verify
 *      end-to-end in the Phase 1/2a spike (see plan.md). Failure
 *      here is non-fatal — recorded in [[BootstrapResult.notes]]
 *      and bootstrap continues.
 *
 *   3. `isabelle.Options.init("", scala.Nil)` — constructs a
 *      default Options instance loaded from the bootstrapped
 *      Environment settings.
 *
 *   4. `isabelle.Headless.Resources.make(options, sessionName, …)`
 *      — scans ROOT files and builds the session-dependency graph
 *      (~5-10 s on first call).
 *
 *   5. `Resources.start_session(…)` — forks PolyML (~5-30 s) and
 *      returns a live [[isabelle.Headless.Session]] reference.
 *
 *  Catches `Throwable` (not `NonFatal`) at every reflective boundary
 *  because Isabelle's static initializers can fail with
 *  `ExceptionInInitializerError`, a `LinkageError` subclass that
 *  `NonFatal` explicitly excludes. See AGENTS.md §12.
 */
object HeadlessBootstrap {

  /**
   * Outcome of [[bootstrap]]. On success carries the live
   * `Headless.Session` instance + the Options instance used to build
   * it (so callers can pass the same Options to `use_theories`).
   */
  sealed trait BootstrapResult {
    def notes: Seq[String]
  }

  final case class BootstrapSuccess(
    sessionInstance: AnyRef,
    optionsInstance: AnyRef,
    elapsedMs: Long,
    notes: Seq[String]
  ) extends BootstrapResult

  final case class BootstrapFailure(
    step: String,
    reason: String,
    notes: Seq[String]
  ) extends BootstrapResult

  /**
   * Run the full chain reflectively. The caller supplies an already-
   * built [[URLClassLoader]] (cycled lifecycle is owned by
   * [[HeadlessFacade]]). Returns success even if the optional
   * `Isabelle_System.init` step fails — that one is documented as
   * defensive and surfaced via [[BootstrapResult.notes]].
   */
  def bootstrap(
    loader: ClassLoader,
    home: Path,
    cygwinRoot: String,
    sessionName: String,
    sessionDirs: Seq[Path] = Seq.empty
  ): BootstrapResult = {
    val notes = scala.collection.mutable.Buffer.empty[String]
    val startedAt = System.currentTimeMillis()

    // Step 1: Environment.init — MANDATORY
    val envResult = invokeEnvironmentInit(loader, home, cygwinRoot)
    envResult match {
      case Left(err) => return BootstrapFailure("environment-init", err, notes.toSeq)
      case Right(()) => notes += "Environment.init succeeded"
    }

    // Step 2: Isabelle_System.init — defensive, non-fatal on failure
    invokeIsabelleSystemInit(loader, home, cygwinRoot) match {
      case Left(err) => notes += s"Isabelle_System.init skipped/failed (non-fatal): $err"
      case Right(()) => notes += "Isabelle_System.init succeeded"
    }

    // Step 3: construct Options
    val options = invokeOptionsInit(loader) match {
      case Left(err) => return BootstrapFailure("options-init", err, notes.toSeq)
      case Right(value) =>
        notes += "Options.init succeeded"
        value
    }

    // Step 4: construct Headless.Resources via the `make` factory
    val resources = invokeResourcesMake(loader, options, sessionName, sessionDirs) match {
      case Left(err) => return BootstrapFailure("resources-make", err, notes.toSeq)
      case Right(value) =>
        notes += "Headless.Resources.make succeeded"
        value
    }

    // Step 5: start_session — forks PolyML
    val session = invokeStartSession(loader, resources) match {
      case Left(err) => return BootstrapFailure("start-session", err, notes.toSeq)
      case Right(value) =>
        notes += "Headless.Resources.start_session succeeded"
        value
    }

    BootstrapSuccess(
      sessionInstance = session,
      optionsInstance = options,
      elapsedMs = System.currentTimeMillis() - startedAt,
      notes = notes.toSeq
    )
  }

  /** Stop a previously-bootstrapped session reflectively. Safe to call
    * multiple times — second call is a no-op. */
  def stopSession(session: AnyRef): Either[String, Unit] = {
    if (session == null) return Right(())
    try {
      val stopMethod = session.getClass.getMethods.find(m => m.getName == "stop" && m.getParameterCount == 0)
      stopMethod match {
        case Some(m) =>
          m.invoke(session)
          Right(())
        case None => Left("Session.stop() not found")
      }
    } catch {
      case t: Throwable => Left(describe(t))
    }
  }

  /** Cygwin root path on Windows; empty on POSIX. Helper for callers
    * who derive the value from `<home>/contrib/cygwin`. */
  def deriveCygwinRoot(home: Path, platform: String): String = {
    val lower = platform.toLowerCase
    if (!lower.startsWith("win")) {
      ""
    } else {
      val candidate = home.resolve("contrib").resolve("cygwin")
      if (Files.isDirectory(candidate)) candidate.toString else ""
    }
  }

  private def invokeEnvironmentInit(
    loader: ClassLoader,
    home: Path,
    cygwinRoot: String
  ): Either[String, Unit] = {
    try {
      val cls = Class.forName("isabelle.setup.Environment", true, loader)
      val method = cls.getMethod("init", classOf[String], classOf[String])
      method.invoke(null, home.toString, cygwinRoot)
      Right(())
    } catch {
      case t: Throwable => Left(describe(t))
    }
  }

  private def invokeIsabelleSystemInit(
    loader: ClassLoader,
    home: Path,
    cygwinRoot: String
  ): Either[String, Unit] = {
    try {
      val cls = Class.forName("isabelle.Isabelle_System$", true, loader)
      val module = cls.getField("MODULE$").get(null)
      val method = cls.getMethods.find(m => m.getName == "init" && m.getParameterCount == 2)
      method match {
        case Some(m) =>
          m.invoke(module, home.toString, cygwinRoot)
          Right(())
        case None => Left("Isabelle_System$.init(String,String) not found — Isabelle version mismatch?")
      }
    } catch {
      case t: Throwable => Left(describe(t))
    }
  }

  private def invokeOptionsInit(loader: ClassLoader): Either[String, AnyRef] = {
    try {
      val optionsCompanion = Class.forName("isabelle.Options$", true, loader)
      val module = optionsCompanion.getField("MODULE$").get(null)
      val nilCls = Class.forName("scala.collection.immutable.Nil$", true, loader)
      val nilModule = nilCls.getField("MODULE$").get(null)
      val initMethod = optionsCompanion.getMethods.find(m => m.getName == "init" && m.getParameterCount == 2)
        .getOrElse(return Left("isabelle.Options$.init(String, List) not found"))
      val result = initMethod.invoke(module, "", nilModule)
      Right(result)
    } catch {
      case t: Throwable => Left(describe(t))
    }
  }

  private def invokeResourcesMake(
    loader: ClassLoader,
    options: AnyRef,
    sessionName: String,
    sessionDirs: Seq[Path]
  ): Either[String, AnyRef] = {
    try {
      val cls = Class.forName("isabelle.Headless$Resources$", true, loader)
      val module = cls.getField("MODULE$").get(null)
      val makeMethod = cls.getMethods.find(_.getName == "make")
        .getOrElse(return Left("isabelle.Headless$Resources$.make not found"))

      // Resolve all default args via `make$default$N`
      val args = (1 to makeMethod.getParameterCount).map { idx =>
        try {
          val m = cls.getMethod(s"make$$default$$$idx")
          m.invoke(module)
        } catch {
          case _: Throwable => null
        }
      }.toArray
      // Positions 0 (options) and 1 (session name) are required.
      args(0) = options
      args(1) = sessionName
      if (sessionDirs.nonEmpty) {
        val sessionDirsList = isabellePathList(loader, sessionDirs) match {
          case Left(err) => return Left(err)
          case Right(value) => value
        }
        makeMethod.getParameterTypes.zipWithIndex
          .drop(2)
          .find { case (paramType, _) =>
            paramType.getName == "scala.collection.immutable.List" ||
              paramType.getName.startsWith("scala.collection.immutable.List")
          }
          .foreach { case (_, idx) =>
            args(idx) = sessionDirsList
          }
      }

      Right(makeMethod.invoke(module, args*))
    } catch {
      case t: Throwable => Left(describe(t))
    }
  }

  private def isabellePathList(loader: ClassLoader, sessionDirs: Seq[Path]): Either[String, AnyRef] = {
    try {
      val cls = Class.forName("isabelle.Path$", true, loader)
      val module = cls.getField("MODULE$").get(null)
      val explode = cls.getMethods.find(m =>
        m.getName == "explode" &&
          m.getParameterCount == 1 &&
          m.getParameterTypes()(0) == classOf[String]
      ).getOrElse(return Left("isabelle.Path$.explode(String) not found"))
      val values = sessionDirs.distinct.map { dir =>
        val native = dir.toString
        val standard = HeadlessFacade.toIsabellePath(loader, native).getOrElse(native)
        explode.invoke(module, standard).asInstanceOf[AnyRef]
      }
      Right(HeadlessFacade.scalaListOfValues(loader, values))
    } catch {
      case t: Throwable => Left(s"session-dirs: ${describe(t)}")
    }
  }

  private def invokeStartSession(
    loader: ClassLoader,
    resources: AnyRef
  ): Either[String, AnyRef] = {
    try {
      val cls = Class.forName("isabelle.Headless$Resources", true, loader)
      val startMethod = cls.getMethods.find(_.getName == "start_session")
        .getOrElse(return Left("isabelle.Headless$Resources.start_session not found"))
      val args = (1 to startMethod.getParameterCount).map { idx =>
        try {
          val m = cls.getMethod(s"start_session$$default$$$idx")
          m.invoke(resources)
        } catch {
          case _: Throwable => null
        }
      }.toArray
      Right(startMethod.invoke(resources, args*))
    } catch {
      case t: Throwable => Left(describe(t))
    }
  }

  private def describe(t: Throwable): String = {
    val msg = Option(t.getMessage).filter(_.nonEmpty).getOrElse(t.getClass.getSimpleName)
    val cause = Option(t.getCause).map(c => s" (cause: ${c.getClass.getSimpleName}: ${Option(c.getMessage).getOrElse("")})").getOrElse("")
    s"${t.getClass.getSimpleName}: $msg$cause"
  }
}
