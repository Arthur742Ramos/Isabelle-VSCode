package dev.isabelle.vscode.server

import java.net.URLClassLoader
import java.nio.file.{Files, Path}
import java.util.concurrent.atomic.AtomicBoolean
import scala.util.control.NonFatal

/**
 * Cache the long-lived [[HeadlessFacade]] keyed by a fingerprint that
 * triggers invalidation on:
 *
 *   - `isabelle.executablePath` change (different canonical home),
 *   - `isabelle.session.active` change (different session name),
 *   - `isabelle.jar` mtime + size change (Isabelle install upgraded
 *     in place).
 *
 * Each `acquireOrBuild` call computes the current fingerprint; if it
 * matches the cache, returns the cached facade; otherwise tears down
 * the previous facade and builds a new one. Backend dispose calls
 * [[shutdown]] which gracefully tears down whatever facade is live.
 *
 * Single-threaded by construction: the JSON-RPC dispatcher already
 * serializes requests, and the worker thread that handles
 * `document/checkWithPide` is single-instance. No cross-thread
 * synchronization required for Phase 2a.
 */
final class HeadlessSessionRegistry(
  loaderFactory: IsabelleClassLoaderFactory = IsabelleClassLoaderFactory.Real,
  symbolTranslatorLoader: ClassLoader => Either[String, SymbolTranslator] = SymbolTranslator.load
) {
  private var cached: Option[(HeadlessSessionRegistry.Fingerprint, HeadlessFacade)] = None
  private val cancelFlag = new AtomicBoolean(false)
  /** Phase 2b: tracks the facade currently inside a `use_theories`
    * call so [[cancelInflightWarmup]] can interrupt the blocking JNI
    * call by tearing down the `Headless.Session`. Cleared by
    * [[clearInflight]] when the call completes (success or failure). */
  private val inflightFacade = new java.util.concurrent.atomic.AtomicReference[Option[HeadlessFacade]](None)

  /**
   * Acquire the live facade for the given home + session, building it
   * if the fingerprint changed since the last call. Caller must
   * supply a fresh AtomicBoolean for cancellation — the registry
   * propagates `cancelInflightWarmup()` writes into the flag that
   * the build path checks between bootstrap steps.
   */
  def acquireOrBuild(
    classpath: IsabellePideClasspath.Resolved,
    home: Path,
    cygwinRoot: String,
    sessionName: String
  ): Either[HeadlessFacade.BuildError, HeadlessFacade] = {
    val fp = HeadlessSessionRegistry.Fingerprint.compute(home, sessionName, classpath.isabelleJar)

    cached match {
      case Some((existingFp, facade)) if existingFp == fp =>
        Right(facade)
      case Some((_, stale)) =>
        try stale.shutdown() catch { case NonFatal(_) => () }
        cached = None
        buildFresh(classpath, home, cygwinRoot, sessionName, fp)
      case None =>
        buildFresh(classpath, home, cygwinRoot, sessionName, fp)
    }
  }

  /**
   * Phase 2b: mark the supplied facade as the in-flight target for
   * cancellation. Caller must clear via [[clearInflight]] in a
   * `finally` block so the registry never holds a reference to a
   * facade that has already returned from `use_theories`.
   */
  def markInflight(facade: HeadlessFacade): Unit = {
    inflightFacade.set(Some(facade))
  }

  /** Phase 2b: clear the in-flight marker. Idempotent. */
  def clearInflight(): Unit = {
    inflightFacade.set(None)
  }

  /**
   * Caller-facing cancellation signal. Phase 2a: sets the warmup
   * cancel flag the bootstrap loop checks between steps. Phase 2b:
   * ALSO tears down the in-flight `Headless.Session` (if any) via
   * `Session.stop()` so the blocking `use_theories` JNI call returns
   * with an `Interrupt`-wrapped exception. The cached facade is
   * invalidated as a side effect so the next call re-bootstraps a
   * fresh session (~20 s cost on the next call; acceptable for the
   * rare cancellation case).
   *
   * Concurrency note: this method is called from the dispatcher's
   * main thread while the worker thread is potentially mid-call
   * inside `use_theories`. `Session.stop()` is designed to be safe
   * to call from another thread (it sends a Stop signal to the
   * Isabelle session actor); the worst-case outcome is a race that
   * surfaces as a `Throwable` in the worker, which
   * [[HeadlessFacade.submitTheory]] already catches.
   */
  def cancelInflightWarmup(): Unit = {
    cancelFlag.set(true)
    inflightFacade.getAndSet(None).foreach { facade =>
      try facade.shutdown() catch { case NonFatal(_) => () }
    }
    // The shutdown above tore down the cached facade if it matched
    // the in-flight one — but `cached` still holds a reference.
    // Clear it so the next acquireOrBuild call re-bootstraps cleanly.
    cached.foreach { case (_, facade) =>
      if (facade.isShutDown) {
        cached = None
      }
    }
  }

  /** Shutdown the live facade (if any). Idempotent. */
  def shutdown(): Unit = {
    cached.foreach { case (_, facade) =>
      try facade.shutdown() catch { case NonFatal(_) => () }
    }
    cached = None
  }

  /** Diagnostic: returns the fingerprint of the currently-cached
    * facade or `None` if no facade is live. Used by tests + the
    * `Isabelle: Show PIDE Document Status` command. */
  def currentFingerprint: Option[HeadlessSessionRegistry.Fingerprint] = cached.map(_._1)

  private def buildFresh(
    classpath: IsabellePideClasspath.Resolved,
    home: Path,
    cygwinRoot: String,
    sessionName: String,
    fp: HeadlessSessionRegistry.Fingerprint
  ): Either[HeadlessFacade.BuildError, HeadlessFacade] = {
    cancelFlag.set(false)
    val loader = loaderFactory.newLoader(classpath.toUrls, getClass.getClassLoader)
    val translator = symbolTranslatorLoader(loader).getOrElse(SymbolTranslator.Identity)

    HeadlessFacade.build(loader, home, cygwinRoot, sessionName, translator, cancelFlag) match {
      case Right(facade) =>
        cached = Some((fp, facade))
        Right(facade)
      case Left(err) =>
        // build() already closed the loader on failure.
        cached = None
        Left(err)
    }
  }
}

object HeadlessSessionRegistry {

  /** Stable cache key. Equality drives invalidation. */
  final case class Fingerprint(
    canonicalHome: String,
    sessionName: String,
    isabelleJarSize: Long,
    isabelleJarMtimeMillis: Long
  )

  object Fingerprint {
    def compute(home: Path, sessionName: String, isabelleJar: Path): Fingerprint = {
      val canonical = try home.toRealPath().toString catch { case _: Throwable => home.toAbsolutePath.normalize().toString }
      val (size, mtime) =
        try {
          val attrs = Files.readAttributes(isabelleJar, classOf[java.nio.file.attribute.BasicFileAttributes])
          (attrs.size(), attrs.lastModifiedTime().toMillis)
        } catch {
          case _: Throwable => (0L, 0L)
        }
      Fingerprint(canonical, sessionName, size, mtime)
    }
  }
}
