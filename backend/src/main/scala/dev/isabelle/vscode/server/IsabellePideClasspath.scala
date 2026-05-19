package dev.isabelle.vscode.server

import java.net.URL
import java.nio.file.Path

/**
 * Builds the runtime classpath for the Isabelle/PIDE bridge.
 *
 * **License contract**: We never bundle any of these jars into our
 * fat jar or `.vsix`. They live in the user's local Isabelle install
 * and are loaded reflectively via a child `URLClassLoader`. See
 * `THIRD_PARTY_NOTICES.md` for the runtime-only Isabelle dependency
 * note.
 */
object IsabellePideClasspath {
  /** Path inside `<home>` to the main PIDE jar. */
  val IsabelleJarRelative: String = "lib/classes/isabelle.jar"

  /** Directory inside `<home>` that holds the bundled Scala runtime. */
  val ContribRelative: String = "contrib"

  /** Required jar name prefixes inside a candidate Scala contrib dir. */
  val Scala3LibraryPrefix: String = "scala3-library_3-"
  val Scala2LibraryPrefix: String = "scala-library-2.13."

  sealed trait ClasspathError extends Product with Serializable {
    def message: String
  }
  case object IsabelleJarMissing extends ClasspathError {
    override val message: String =
      "Isabelle PIDE jar not found at <home>/lib/classes/isabelle.jar."
  }
  case object ScalaRuntimeMissing extends ClasspathError {
    override val message: String =
      "No <home>/contrib/scala-* directory contains both a Scala 3 library and the Scala 2.13 library jar required at runtime."
  }

  final case class Resolved(
    isabelleJar: Path,
    scalaContribDir: Path,
    scalaJars: Seq[Path],
    otherContribJars: Seq[Path] = Seq.empty
  ) {
    /**
     * Full classpath in URL-load order: the main PIDE jar first, then
     * the Scala 3 runtime (so any duplicated transitive library — e.g.
     * jsoup — resolves to the version Scala was compiled against),
     * then every other Isabelle contrib jar (isabelle_setup, sqlite,
     * xz, zstd, …) alphabetically.
     */
    def allJars: Seq[Path] = (isabelleJar +: scalaJars) ++ otherContribJars
    def toUrls: Seq[URL] = allJars.map(_.toUri.toURL)
  }

  def build(home: Path, fs: IsabelleHomeFs): Either[ClasspathError, Resolved] = {
    val isabelleJar = home.resolve(IsabelleJarRelative)
    if (!fs.isRegularFile(isabelleJar)) {
      Left(IsabelleJarMissing)
    } else {
      pickScalaContribDir(home, fs) match {
        case None => Left(ScalaRuntimeMissing)
        case Some((contribDir, jars)) =>
          val other = collectOtherContribJars(home, contribDir, fs)
          Right(Resolved(
            isabelleJar = isabelleJar,
            scalaContribDir = contribDir,
            scalaJars = jars,
            otherContribJars = other
          ))
      }
    }
  }

  /**
   * Returns every `<home>/contrib/<component>/lib/*.jar` EXCEPT those
   * already covered by the selected Scala contrib dir. Sorted by
   * component name then jar name for determinism. Phase 2a needs more
   * than `isabelle.jar` + Scala: Isabelle's PIDE classes call into
   * `isabelle.setup.Environment` (in `contrib/isabelle_setup-*/`),
   * jsoup, sqlite-jdbc, xz, zstd-jni, slf4j, etc. The spike validated
   * 212 jars total against Isabelle2025-2. Rather than hard-coding the
   * list and chasing it across Isabelle versions, we include everything
   * under contrib/ and let Scala's own jars (added first) take
   * precedence in URLClassLoader's first-match resolution.
   *
   * License contract is preserved: these jars live on the user's local
   * disk; nothing here is ever bundled into our `.vsix` or fat jar.
   * `backend/scripts/check-license.js` is the enforcement gate.
   */
  private def collectOtherContribJars(
    home: Path,
    scalaContribDir: Path,
    fs: IsabelleHomeFs
  ): Seq[Path] = {
    val contribRoot = home.resolve(ContribRelative)
    if (!fs.isDirectory(contribRoot)) {
      return Seq.empty
    }

    val scalaContribComponent = scalaContribDir.getParent
    fs.listChildren(contribRoot)
      .filter(component => fs.isDirectory(component))
      .filter(component => component != scalaContribComponent)
      .sortBy(component => Option(component.getFileName).map(_.toString).getOrElse(""))
      .flatMap { component =>
        val libDir = component.resolve("lib")
        if (!fs.isDirectory(libDir)) Seq.empty
        else
          fs.listChildren(libDir)
            .filter(jar => fs.isRegularFile(jar) && Option(jar.getFileName).exists(_.toString.endsWith(".jar")))
            .sortBy(jar => Option(jar.getFileName).map(_.toString).getOrElse(""))
      }
  }

  private def pickScalaContribDir(home: Path, fs: IsabelleHomeFs): Option[(Path, Seq[Path])] = {
    val contrib = home.resolve(ContribRelative)
    if (!fs.isDirectory(contrib)) {
      return None
    }

    val candidates = fs.listChildren(contrib)
      .filter(child => child.getFileName != null && child.getFileName.toString.startsWith("scala-"))
      .map(child => child.resolve("lib"))
      .filter(libDir => fs.isDirectory(libDir))

    val qualified = candidates.flatMap { libDir =>
      val jars = fs.listChildren(libDir)
        .filter(p => p.getFileName != null && p.getFileName.toString.endsWith(".jar"))
      val hasScala3 = jars.exists(p => p.getFileName.toString.startsWith(Scala3LibraryPrefix))
      val hasScala2 = jars.exists(p => p.getFileName.toString.startsWith(Scala2LibraryPrefix))
      if (hasScala3 && hasScala2) Some(libDir -> jars)
      else None
    }

    // Sort by the Scala 3 library jar filename so a newer Scala 3 patch
    // release wins deterministically if the install has more than one
    // `contrib/scala-*` directory.
    qualified.sortBy { case (_, jars) =>
      jars
        .map(_.getFileName.toString)
        .find(_.startsWith(Scala3LibraryPrefix))
        .getOrElse("")
    }.lastOption
  }
}
