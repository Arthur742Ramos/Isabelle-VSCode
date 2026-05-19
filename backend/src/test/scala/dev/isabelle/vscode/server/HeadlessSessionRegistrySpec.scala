package dev.isabelle.vscode.server

import java.net.{URL, URLClassLoader}
import java.nio.file.{Files, Paths}
import org.scalatest.funsuite.AnyFunSuite

final class HeadlessSessionRegistrySpec extends AnyFunSuite {
  /** Fake loader factory — returns an empty URLClassLoader so the
    * bootstrap will fail at the Environment.init step. That's
    * sufficient to test the cache lifecycle (a failed bootstrap
    * also exercises the loader.close() invariant). */
  private val emptyLoaderFactory: IsabelleClassLoaderFactory =
    (_: Seq[URL], parent: ClassLoader) => new URLClassLoader(Array.empty[URL], parent)

  test("acquireOrBuild returns BootstrapError when classpath is missing the Isabelle classes") {
    val registry = new HeadlessSessionRegistry(loaderFactory = emptyLoaderFactory)

    val tmpHome = Files.createTempDirectory("registry-spec-")
    val isabelleJar = tmpHome.resolve("lib/classes/isabelle.jar")
    Files.createDirectories(isabelleJar.getParent)
    Files.writeString(isabelleJar, "stub")
    val classpath = IsabellePideClasspath.Resolved(
      isabelleJar = isabelleJar,
      scalaContribDir = tmpHome,
      scalaJars = Seq.empty,
      otherContribJars = Seq.empty
    )

    val result = registry.acquireOrBuild(classpath, tmpHome, "", "HOL")

    assert(result.isLeft)
    val err = result.swap.toOption.get
    assert(err.isInstanceOf[HeadlessFacade.BootstrapError])
    // Cache must NOT retain the failed attempt.
    assert(registry.currentFingerprint.isEmpty)

    ScratchTheoryStore.deleteRecursively(tmpHome)
  }

  test("Fingerprint.compute changes when the session name changes") {
    val tmpJar = Files.createTempFile("registry-fp-", ".jar")
    try {
      val fp1 = HeadlessSessionRegistry.Fingerprint.compute(tmpJar.getParent, "HOL", tmpJar)
      val fp2 = HeadlessSessionRegistry.Fingerprint.compute(tmpJar.getParent, "Pure", tmpJar)
      assert(fp1.sessionName == "HOL")
      assert(fp2.sessionName == "Pure")
      assert(fp1 != fp2)
    } finally Files.deleteIfExists(tmpJar)
  }

  test("Fingerprint.compute changes when the isabelle.jar size changes") {
    val tmpJar = Files.createTempFile("registry-fp-size-", ".jar")
    try {
      Files.writeString(tmpJar, "a")
      val fp1 = HeadlessSessionRegistry.Fingerprint.compute(tmpJar.getParent, "HOL", tmpJar)
      Files.writeString(tmpJar, "abcdef")
      val fp2 = HeadlessSessionRegistry.Fingerprint.compute(tmpJar.getParent, "HOL", tmpJar)
      assert(fp1.isabelleJarSize != fp2.isabelleJarSize)
      assert(fp1 != fp2)
    } finally Files.deleteIfExists(tmpJar)
  }

  test("cancelInflightWarmup does not throw when no warmup is in flight") {
    val registry = new HeadlessSessionRegistry(loaderFactory = emptyLoaderFactory)
    registry.cancelInflightWarmup()
    assert(registry.currentFingerprint.isEmpty)
  }

  test("shutdown is idempotent") {
    val registry = new HeadlessSessionRegistry(loaderFactory = emptyLoaderFactory)
    registry.shutdown()
    registry.shutdown()
    assert(registry.currentFingerprint.isEmpty)
  }

  test("Phase 2b: cancelInflightWarmup shuts down the inflight facade and invalidates the cache") {
    val registry = new HeadlessSessionRegistry(loaderFactory = emptyLoaderFactory)
    val fakeFacade = new FakeShutdownTrackingFacade

    // Simulate an in-flight submission marking the facade.
    registry.markInflight(fakeFacade.facade)

    registry.cancelInflightWarmup()

    // Phase 2b polish: post-cancel teardown runs on the cleanup
    // executor (single daemon thread), so the test must poll for
    // the shutdown to land rather than asserting synchronously.
    val deadline = System.currentTimeMillis() + 2000
    while (!fakeFacade.facade.isShutDown && System.currentTimeMillis() < deadline) {
      Thread.sleep(20)
    }

    assert(fakeFacade.facade.isShutDown, "cancelled facade must report isShutDown=true within 2 s")
  }

  test("Phase 2b: markInflight / clearInflight are idempotent and clearing a never-marked registry is a no-op") {
    val registry = new HeadlessSessionRegistry(loaderFactory = emptyLoaderFactory)
    registry.clearInflight()
    registry.clearInflight()
    // No exception, and cancel is still safe.
    registry.cancelInflightWarmup()
  }
}

/** Test helper: a minimal facade whose [[HeadlessFacade.shutdown]]
  * we can observe. Built without going through the real bootstrap
  * chain since we just want to verify the registry lifecycle wiring. */
private final class FakeShutdownTrackingFacade {
  import java.lang.reflect.Constructor

  // Reflectively construct a HeadlessFacade with a minimal Session
  // proxy whose use_theories method is never called in this test —
  // we only care about isShutDown propagation.
  val facade: HeadlessFacade = {
    val ctor = classOf[HeadlessFacade].getDeclaredConstructors.head.asInstanceOf[Constructor[HeadlessFacade]]
    ctor.setAccessible(true)
    ctor.newInstance(
      new java.net.URLClassLoader(Array.empty[java.net.URL], getClass.getClassLoader),
      SymbolTranslator.Identity,
      new SessionStub: AnyRef,
      new Object(),
      java.nio.file.Paths.get("/fake/home"),
      "HOL",
      Seq("test-facade"),
      java.lang.Long.valueOf(0L)
    )
  }
}

/** Stub that responds to the reflective `use_theories` method lookup
  * the facade's constructor performs (otherwise the constructor
  * itself throws NoSuchMethodException). */
private final class SessionStub {
  def use_theories(): Object = new Object()
  def stop(): Object = new Object()
}
