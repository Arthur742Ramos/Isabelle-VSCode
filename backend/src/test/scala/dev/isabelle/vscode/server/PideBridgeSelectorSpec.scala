package dev.isabelle.vscode.server

import java.net.{URL, URLClassLoader}
import java.nio.file.{Files, Path, Paths}
import org.scalatest.funsuite.AnyFunSuite

/**
 * Selector specs cover the four observable paths the JSON-RPC handler
 * can produce: home-not-found, isabelle-jar-missing, scala-runtime-missing,
 * and class-load-failed. The "module-loaded" success path needs a real
 * Isabelle install, so we cover it via the Tier-2 live smoke test in
 * PR notes rather than a unit case.
 */
final class PideBridgeSelectorSpec extends AnyFunSuite {
  private val Identifier = "etc/ISABELLE_IDENTIFIER"

  /** A loader factory that always returns an empty `URLClassLoader`,
   * which will fail to find any Isabelle class. Used to assert the
   * class-load-failed branch. */
  private val emptyLoaderFactory: IsabelleClassLoaderFactory =
    (_: Seq[URL], parent: ClassLoader) => new URLClassLoader(Array.empty[URL], parent)

  test("home-not-found status when nothing resolves") {
    val fs = new FakeIsabelleHomeFs()

    val (bridge, status) = PideBridgeSelector.select(Map.empty, None, "Linux", fs, emptyLoaderFactory)

    assert(bridge.isInstanceOf[LocalSyntaxPideBridge])
    assert(status.bridge == PideRuntimeStatus.LocalSyntax)
    assert(status.reason.contains(PideRuntimeStatus.ReasonHomeNotFound))
    assert(status.version == "")
    assert(status.classloaderReady == false)
  }

  test("isabelle-jar-missing status when ISABELLE_HOME resolves but the PIDE jar is absent") {
    val home = "/opt/Isabelle2025-2"
    val fs = new FakeIsabelleHomeFs(
      directories = Set(home),
      files = Set(s"$home/$Identifier")
    )

    val (bridge, status) = PideBridgeSelector.select(
      Map("ISABELLE_HOME" -> home),
      None,
      "Linux",
      fs,
      emptyLoaderFactory
    )

    assert(bridge.isInstanceOf[LocalSyntaxPideBridge])
    assert(status.reason.contains(PideRuntimeStatus.ReasonIsabelleJarMissing))
    assert(status.isabelleHome.exists(_.toString.replace('\\', '/') == home))
  }

  test("scala-runtime-missing status when contrib/scala-* dir exists but lacks the required jars") {
    val home = "/opt/Isabelle2025-2"
    val fs = new FakeIsabelleHomeFs(
      directories = Set(home, s"$home/contrib", s"$home/contrib/scala-2.13.14/lib"),
      files = Set(
        s"$home/$Identifier",
        s"$home/lib/classes/isabelle.jar",
        s"$home/contrib/scala-2.13.14/lib/scala-library-2.13.14.jar"
      ),
      children = Map(
        s"$home/contrib" -> Seq(s"$home/contrib/scala-2.13.14"),
        s"$home/contrib/scala-2.13.14/lib" -> Seq(
          s"$home/contrib/scala-2.13.14/lib/scala-library-2.13.14.jar"
        )
      )
    )

    val (bridge, status) = PideBridgeSelector.select(
      Map("ISABELLE_HOME" -> home),
      None,
      "Linux",
      fs,
      emptyLoaderFactory
    )

    assert(bridge.isInstanceOf[LocalSyntaxPideBridge])
    assert(status.reason.contains(PideRuntimeStatus.ReasonScalaRuntimeMissing))
  }

  test("class-load-failed status when classpath builds but isabelle.Isabelle_System$ is not on the loader") {
    val tmpHome = Files.createTempDirectory("pide-bridge-selector-spec-")
    val identifier = tmpHome.resolve("etc/ISABELLE_IDENTIFIER")
    Files.createDirectories(identifier.getParent)
    Files.writeString(identifier, "Isabelle-Test-1")
    val isabelleJar = tmpHome.resolve("lib/classes/isabelle.jar")
    Files.createDirectories(isabelleJar.getParent)
    Files.writeString(isabelleJar, "not really a jar")
    val libDir = tmpHome.resolve("contrib/scala-3.3.4/lib")
    Files.createDirectories(libDir)
    val scala3 = libDir.resolve("scala3-library_3-3.3.4.jar")
    val scala2 = libDir.resolve("scala-library-2.13.14.jar")
    Files.writeString(scala3, "stub")
    Files.writeString(scala2, "stub")

    try {
      val (bridge, status) = PideBridgeSelector.select(
        Map("ISABELLE_HOME" -> tmpHome.toString),
        None,
        "Linux"
        // default real fs + real loader factory; the empty stub jars
        // will not satisfy Class.forName("isabelle.Isabelle_System$")
      )

      assert(bridge.isInstanceOf[LocalSyntaxPideBridge])
      assert(status.reason.contains(PideRuntimeStatus.ReasonClassLoadFailed))
      assert(status.isabelleHome.exists(_.toString.replace('\\', '/').endsWith(tmpHome.getFileName.toString)))
    } finally {
      // cleanup
      deleteRecursively(tmpHome)
    }
  }

  test("JSON serialization includes every status field") {
    val status = PideRuntimeStatus(
      bridge = PideRuntimeStatus.PideEnabled,
      version = "Isabelle2025-2",
      isabelleHome = Some(Paths.get("/opt/Isabelle2025-2")),
      source = PideRuntimeStatus.SourceIdentifierFile,
      classloaderReady = true,
      proofOfLife = PideRuntimeStatus.ProofModule,
      reason = None,
      message = "ready"
    )

    val json = status.toJson.obj
    assert(json("bridge").str == PideRuntimeStatus.PideEnabled)
    assert(json("version").str == "Isabelle2025-2")
    assert(json("source").str == PideRuntimeStatus.SourceIdentifierFile)
    assert(json("classloaderReady").bool)
    assert(json("proofOfLife").str == PideRuntimeStatus.ProofModule)
    assert(json("message").str == "ready")
    assert(json("isabelleHome").str.replace('\\', '/') == "/opt/Isabelle2025-2")
    assert(!json.contains("reason"))
  }

  private def deleteRecursively(path: Path): Unit = {
    if (Files.isDirectory(path)) {
      val stream = Files.list(path)
      try stream.forEach(deleteRecursively)
      finally stream.close()
    }
    try Files.deleteIfExists(path) catch { case _: Throwable => () }
  }
}
