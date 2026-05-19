package dev.isabelle.vscode.server

import java.nio.file.Paths
import org.scalatest.funsuite.AnyFunSuite

final class IsabellePideClasspathSpec extends AnyFunSuite {
  private val Home = "/opt/Isabelle2025-2"

  private def fsWithLayout(
    extraFiles: Set[String] = Set.empty,
    extraChildren: Map[String, Seq[String]] = Map.empty,
    extraDirs: Set[String] = Set.empty
  ): FakeIsabelleHomeFs =
    new FakeIsabelleHomeFs(
      directories = extraDirs,
      files = extraFiles,
      children = extraChildren
    )

  test("returns IsabelleJarMissing when lib/classes/isabelle.jar is absent") {
    val fs = fsWithLayout()

    val result = IsabellePideClasspath.build(Paths.get(Home), fs)

    assert(result == Left(IsabellePideClasspath.IsabelleJarMissing))
  }

  test("returns ScalaRuntimeMissing when no contrib/scala-* dir has both stdlibs") {
    val fs = fsWithLayout(
      extraFiles = Set(s"$Home/lib/classes/isabelle.jar"),
      extraDirs = Set(s"$Home/contrib", s"$Home/contrib/scala-2.13.14/lib"),
      extraChildren = Map(
        s"$Home/contrib" -> Seq(s"$Home/contrib/scala-2.13.14"),
        s"$Home/contrib/scala-2.13.14/lib" -> Seq(
          s"$Home/contrib/scala-2.13.14/lib/scala-library-2.13.14.jar"
        )
      )
    )

    val result = IsabellePideClasspath.build(Paths.get(Home), fs)

    assert(result == Left(IsabellePideClasspath.ScalaRuntimeMissing))
  }

  test("picks a contrib/scala-* dir that contains both Scala 3 and Scala 2.13 jars") {
    val libDir = s"$Home/contrib/scala-3.3.4/lib"
    val scala3Jar = s"$libDir/scala3-library_3-3.3.4.jar"
    val scala2Jar = s"$libDir/scala-library-2.13.14.jar"
    val tastyJar = s"$libDir/tasty-core_3-3.3.4.jar"
    val isabelleJar = s"$Home/lib/classes/isabelle.jar"

    val fs = fsWithLayout(
      extraFiles = Set(isabelleJar, scala3Jar, scala2Jar, tastyJar),
      extraDirs = Set(s"$Home/contrib", s"$Home/contrib/scala-3.3.4", libDir),
      extraChildren = Map(
        s"$Home/contrib" -> Seq(s"$Home/contrib/scala-3.3.4"),
        libDir -> Seq(scala3Jar, scala2Jar, tastyJar)
      )
    )

    val result = IsabellePideClasspath.build(Paths.get(Home), fs)

    val resolved = result match {
      case Right(value) => value
      case Left(error)  => fail(s"expected Right, got Left($error)")
    }
    assert(resolved.isabelleJar.toString.replace('\\', '/') == isabelleJar)
    val jarNames = resolved.scalaJars.map(_.getFileName.toString)
    assert(jarNames.contains("scala3-library_3-3.3.4.jar"))
    assert(jarNames.contains("scala-library-2.13.14.jar"))
    assert(jarNames.contains("tasty-core_3-3.3.4.jar"))
  }

  test("prefers the contrib dir with the newest Scala 3 library version") {
    val olderLibDir = s"$Home/contrib/scala-3.3.0/lib"
    val newerLibDir = s"$Home/contrib/scala-3.3.4/lib"
    val isabelleJar = s"$Home/lib/classes/isabelle.jar"

    val olderScala3 = s"$olderLibDir/scala3-library_3-3.3.0.jar"
    val olderScala2 = s"$olderLibDir/scala-library-2.13.10.jar"
    val newerScala3 = s"$newerLibDir/scala3-library_3-3.3.4.jar"
    val newerScala2 = s"$newerLibDir/scala-library-2.13.14.jar"

    val fs = fsWithLayout(
      extraFiles = Set(isabelleJar, olderScala3, olderScala2, newerScala3, newerScala2),
      extraDirs = Set(
        s"$Home/contrib",
        s"$Home/contrib/scala-3.3.0",
        s"$Home/contrib/scala-3.3.4",
        olderLibDir,
        newerLibDir
      ),
      extraChildren = Map(
        s"$Home/contrib" -> Seq(s"$Home/contrib/scala-3.3.0", s"$Home/contrib/scala-3.3.4"),
        olderLibDir -> Seq(olderScala3, olderScala2),
        newerLibDir -> Seq(newerScala3, newerScala2)
      )
    )

    val resolved = IsabellePideClasspath.build(Paths.get(Home), fs).toOption.get

    assert(resolved.scalaContribDir.toString.replace('\\', '/') == newerLibDir)
  }

  test("toUrls maps every jar to a file: URL") {
    val libDir = s"$Home/contrib/scala-3.3.4/lib"
    val isabelleJar = s"$Home/lib/classes/isabelle.jar"
    val scala3Jar = s"$libDir/scala3-library_3-3.3.4.jar"
    val scala2Jar = s"$libDir/scala-library-2.13.14.jar"

    val fs = fsWithLayout(
      extraFiles = Set(isabelleJar, scala3Jar, scala2Jar),
      extraDirs = Set(s"$Home/contrib", s"$Home/contrib/scala-3.3.4", libDir),
      extraChildren = Map(
        s"$Home/contrib" -> Seq(s"$Home/contrib/scala-3.3.4"),
        libDir -> Seq(scala3Jar, scala2Jar)
      )
    )

    val resolved = IsabellePideClasspath.build(Paths.get(Home), fs).toOption.get
    val urls = resolved.toUrls

    assert(urls.size == 3)
    assert(urls.forall(_.getProtocol == "file"))
  }

  test("includes contrib/<other>/lib/*.jar in addition to Scala jars") {
    val scalaLib = s"$Home/contrib/scala-3.3.4/lib"
    val setupLib = s"$Home/contrib/isabelle_setup-20250613/lib"
    val sqliteLib = s"$Home/contrib/sqlite-3.51.0.0/lib"
    val cygwinLib = s"$Home/contrib/cygwin/lib"

    val isabelleJar = s"$Home/lib/classes/isabelle.jar"
    val scala3Jar = s"$scalaLib/scala3-library_3-3.3.4.jar"
    val scala2Jar = s"$scalaLib/scala-library-2.13.14.jar"
    val setupJar = s"$setupLib/isabelle_setup.jar"
    val sqliteJar = s"$sqliteLib/sqlite-jdbc-3.51.0.0.jar"
    val slf4jJar = s"$sqliteLib/slf4j-api-2.0.17.jar"
    // cygwin component has no lib/*.jar — should be skipped silently.

    val fs = fsWithLayout(
      extraFiles = Set(isabelleJar, scala3Jar, scala2Jar, setupJar, sqliteJar, slf4jJar),
      extraDirs = Set(
        s"$Home/contrib",
        s"$Home/contrib/scala-3.3.4", scalaLib,
        s"$Home/contrib/isabelle_setup-20250613", setupLib,
        s"$Home/contrib/sqlite-3.51.0.0", sqliteLib,
        s"$Home/contrib/cygwin"
      ),
      extraChildren = Map(
        s"$Home/contrib" -> Seq(
          s"$Home/contrib/scala-3.3.4",
          s"$Home/contrib/isabelle_setup-20250613",
          s"$Home/contrib/sqlite-3.51.0.0",
          s"$Home/contrib/cygwin"
        ),
        scalaLib -> Seq(scala3Jar, scala2Jar),
        setupLib -> Seq(setupJar),
        sqliteLib -> Seq(sqliteJar, slf4jJar)
      )
    )

    val resolved = IsabellePideClasspath.build(Paths.get(Home), fs).toOption.get

    val jarNames = resolved.allJars.map(_.getFileName.toString)
    assert(jarNames.contains("isabelle.jar"))
    assert(jarNames.contains("scala3-library_3-3.3.4.jar"))
    assert(jarNames.contains("scala-library-2.13.14.jar"))
    assert(jarNames.contains("isabelle_setup.jar"))
    assert(jarNames.contains("sqlite-jdbc-3.51.0.0.jar"))
    assert(jarNames.contains("slf4j-api-2.0.17.jar"))
    // isabelle.jar first
    assert(jarNames.head == "isabelle.jar")
    // Scala jars before other contrib jars (so URLClassLoader resolves
    // duplicated transitive libs like jsoup against the Scala-bundled
    // version that Scala was compiled against).
    val firstScalaIdx = jarNames.indexWhere(_.startsWith("scala"))
    val firstSetupIdx = jarNames.indexOf("isabelle_setup.jar")
    val firstSqliteIdx = jarNames.indexOf("sqlite-jdbc-3.51.0.0.jar")
    assert(firstScalaIdx < firstSetupIdx, "Scala jars must precede other contrib jars in URL order")
    assert(firstScalaIdx < firstSqliteIdx, "Scala jars must precede other contrib jars in URL order")
  }

  test("excludes the selected Scala contrib dir from otherContribJars") {
    val scalaLib = s"$Home/contrib/scala-3.3.4/lib"
    val setupLib = s"$Home/contrib/isabelle_setup-20250613/lib"

    val isabelleJar = s"$Home/lib/classes/isabelle.jar"
    val scala3Jar = s"$scalaLib/scala3-library_3-3.3.4.jar"
    val scala2Jar = s"$scalaLib/scala-library-2.13.14.jar"
    val setupJar = s"$setupLib/isabelle_setup.jar"

    val fs = fsWithLayout(
      extraFiles = Set(isabelleJar, scala3Jar, scala2Jar, setupJar),
      extraDirs = Set(
        s"$Home/contrib",
        s"$Home/contrib/scala-3.3.4", scalaLib,
        s"$Home/contrib/isabelle_setup-20250613", setupLib
      ),
      extraChildren = Map(
        s"$Home/contrib" -> Seq(s"$Home/contrib/scala-3.3.4", s"$Home/contrib/isabelle_setup-20250613"),
        scalaLib -> Seq(scala3Jar, scala2Jar),
        setupLib -> Seq(setupJar)
      )
    )

    val resolved = IsabellePideClasspath.build(Paths.get(Home), fs).toOption.get

    // The scala jars must appear in scalaJars only — NOT duplicated in otherContribJars.
    val otherNames = resolved.otherContribJars.map(_.getFileName.toString)
    assert(!otherNames.contains("scala3-library_3-3.3.4.jar"))
    assert(!otherNames.contains("scala-library-2.13.14.jar"))
    assert(otherNames.contains("isabelle_setup.jar"))
  }
}
