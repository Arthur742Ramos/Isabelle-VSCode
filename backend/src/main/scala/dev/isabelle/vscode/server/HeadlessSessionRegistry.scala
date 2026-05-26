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
    sessionName: String,
    sessionDirs: Seq[Path] = Seq.empty
  ): Either[HeadlessFacade.BuildError, HeadlessFacade] = {
    val fp = HeadlessSessionRegistry.Fingerprint.compute(home, sessionName, classpath.isabelleJar, sessionDirs)

    cached match {
      case Some((existingFp, facade)) if existingFp == fp =>
        Right(facade)
      case Some((_, stale)) =>
        try stale.shutdown() catch { case NonFatal(_) => () }
        cached = None
        buildFresh(classpath, home, cygwinRoot, sessionName, sessionDirs, fp)
      case None =>
        buildFresh(classpath, home, cygwinRoot, sessionName, sessionDirs, fp)
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
   * Phase 2b polish: the actual `Session.stop()` / loader close
   * runs on a dedicated cleanup executor so the dispatcher's main
   * thread returns immediately (the user sees an instant cancel
   * acknowledgement; the heavy teardown happens in the background).
   * `inflightFacade.getAndSet(None)` makes the signal idempotent —
   * a second cancel sees `None` and does nothing, so no risk of
   * stacked tear-downs from rapid multi-clicks.
   *
   * Concurrency note: `Session.stop()` is designed to be safe to
   * call from another thread (it sends a Stop signal to the
   * Isabelle session actor); the worst-case outcome is a race that
   * surfaces as a `Throwable` in the worker, which
   * [[HeadlessFacade.submitTheory]] already catches.
   */
  def cancelInflightWarmup(): Unit = {
    cancelFlag.set(true)
    // Atomic swap → second cancel finds None, no double-teardown.
    inflightFacade.getAndSet(None).foreach { facade =>
      HeadlessSessionRegistry.cleanupExecutor.submit(new Runnable {
        override def run(): Unit = {
          try facade.shutdown() catch { case NonFatal(_) => () }
          // Also invalidate the cache if the cached facade was the
          // one we just tore down. Single-threaded dispatcher
          // guarantees we don't race with a concurrent acquireOrBuild.
          cached.foreach { case (_, cachedFacade) =>
            if (cachedFacade.isShutDown) {
              cached = None
            }
          }
        }
      })
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

  /** Phase 3 diagnostic: returns the classloader of the currently
    * cached facade if any. Used by `ProofStateWithPideHandler` to
    * reflect on `isabelle.XML` when extracting markup from a cached
    * snapshot (the original facade may be the one to use even when
    * a different fingerprint is requested, since cached snapshots
    * may have been produced by an earlier `acquireOrBuild` call). */
  def currentFacadeLoader: Option[ClassLoader] = cached.map(_._2.reflectionLoader)

  /**
   * Phase 2c diagnostic: rich snapshot of the cache state for
   * surfacing via the `pide/cacheState` JSON-RPC method. Includes
   * the live fingerprint (if any) and lifecycle counters that help
   * users understand why their next call might be slow (e.g.
   * "facade was just invalidated by a cancel, next call will
   * re-bootstrap"). Read-only — does NOT mutate cache state.
   */
  def cacheStateSnapshot: HeadlessSessionRegistry.CacheStateSnapshot = {
    val fp = currentFingerprint
    val inflight = inflightFacade.get().isDefined
    HeadlessSessionRegistry.CacheStateSnapshot(
      hasCachedFacade = fp.isDefined,
      fingerprint = fp,
      hasInflightSubmission = inflight,
      lastBootstrapElapsedMs = cached.map(_._2.bootstrapElapsedMs)
    )
  }

  /**
   * Phase 2c power-user invalidation: force-evicts the cached
   * facade (and tears down its Session). Useful when the user has
   * updated their Isabelle install or wants to clear stuck state
   * without restarting the backend. Safe to call when no facade is
   * cached.
   */
  def invalidateCache(): Unit = {
    cached.foreach { case (_, facade) =>
      try facade.shutdown() catch { case NonFatal(_) => () }
    }
    cached = None
    inflightFacade.set(None)
  }

  private def buildFresh(
    classpath: IsabellePideClasspath.Resolved,
    home: Path,
    cygwinRoot: String,
    sessionName: String,
    sessionDirs: Seq[Path],
    fp: HeadlessSessionRegistry.Fingerprint
  ): Either[HeadlessFacade.BuildError, HeadlessFacade] = {
    cancelFlag.set(false)
    val loader = loaderFactory.newLoader(classpath.toUrls, getClass.getClassLoader)
    val translator = symbolTranslatorLoader(loader).getOrElse(SymbolTranslator.Identity)

    HeadlessFacade.build(loader, home, cygwinRoot, sessionName, sessionDirs, translator, cancelFlag) match {
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
  /**
   * Phase 2b polish: dedicated single-thread executor for the
   * post-cancel `Session.stop()` + loader.close() teardown. Keeps
   * the dispatcher's main thread free to acknowledge the cancel
   * request immediately while the heavy teardown (~100ms-1s for
   * `Session.stop()` to acknowledge the Stop signal) runs in the
   * background. Daemon thread so a hung teardown does not block
   * JVM shutdown.
   */
  private[server] val cleanupExecutor: java.util.concurrent.ExecutorService =
    java.util.concurrent.Executors.newSingleThreadExecutor(r => {
      val t = new Thread(r, "pide-cleanup")
      t.setDaemon(true)
      t
    })

  /** Stable cache key. Equality drives invalidation. */
  final case class Fingerprint(
    canonicalHome: String,
    sessionName: String,
    sessionDirs: Seq[String],
    isabelleJarSize: Long,
    isabelleJarMtimeMillis: Long
  ) {
    /** JSON serialization for the `pide/cacheState` diagnostic. */
    def toJson: ujson.Value = ujson.Obj(
      "canonicalHome" -> canonicalHome,
      "sessionName" -> sessionName,
      "sessionDirs" -> ujson.Arr(sessionDirs.map(ujson.Str(_))*),
      "isabelleJarSize" -> isabelleJarSize,
      "isabelleJarMtimeMillis" -> isabelleJarMtimeMillis
    )
  }

  /** Phase 2c read-only diagnostic returned by
    * [[HeadlessSessionRegistry.cacheStateSnapshot]]. Serialized as
    * the result of the new `pide/cacheState` JSON-RPC method. */
  final case class CacheStateSnapshot(
    hasCachedFacade: Boolean,
    fingerprint: Option[Fingerprint],
    hasInflightSubmission: Boolean,
    lastBootstrapElapsedMs: Option[Long]
  ) {
    def toJson: ujson.Value = {
      val obj = ujson.Obj(
        "hasCachedFacade" -> hasCachedFacade,
        "hasInflightSubmission" -> hasInflightSubmission
      )
      fingerprint.foreach(fp => obj("fingerprint") = fp.toJson)
      lastBootstrapElapsedMs.foreach(ms => obj("lastBootstrapElapsedMs") = ms)
      obj
    }
  }

  object Fingerprint {
    def compute(
      home: Path,
      sessionName: String,
      isabelleJar: Path,
      sessionDirs: Seq[Path] = Seq.empty
    ): Fingerprint = {
      val canonical = try home.toRealPath().toString catch { case _: Throwable => home.toAbsolutePath.normalize().toString }
      val canonicalDirs = sessionDirs.distinct.map { dir =>
        try dir.toRealPath().toString catch { case _: Throwable => dir.toAbsolutePath.normalize().toString }
      }
      val (size, mtime) =
        try {
          val attrs = Files.readAttributes(isabelleJar, classOf[java.nio.file.attribute.BasicFileAttributes])
          (attrs.size(), attrs.lastModifiedTime().toMillis)
        } catch {
          case _: Throwable => (0L, 0L)
        }
      Fingerprint(canonical, sessionName, canonicalDirs, size, mtime)
    }
  }
}
