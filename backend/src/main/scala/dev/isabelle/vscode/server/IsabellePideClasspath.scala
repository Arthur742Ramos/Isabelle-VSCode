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
    scalaJars: Seq[Path]
  ) {
    def allJars: Seq[Path] = isabelleJar +: scalaJars
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
          Right(Resolved(isabelleJar = isabelleJar, scalaContribDir = contribDir, scalaJars = jars))
      }
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
