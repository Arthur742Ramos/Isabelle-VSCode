package dev.isabelle.vscode.server

import java.nio.file.{Path, Paths}
import org.scalatest.funsuite.AnyFunSuite

/**
 * Fake [[IsabelleHomeFs]] for tests. Backed by an in-memory set of
 * directories and files keyed by canonical path strings — no real
 * filesystem touched.
 */
final class FakeIsabelleHomeFs(
  directories: Set[String] = Set.empty,
  files: Set[String] = Set.empty,
  children: Map[String, Seq[String]] = Map.empty,
  userHome: Option[String] = Some("/home/agent")
) extends IsabelleHomeFs {
  private def norm(path: Path): String = path.toString.replace('\\', '/')

  override def isDirectory(path: Path): Boolean = directories.contains(norm(path))
  override def isRegularFile(path: Path): Boolean = files.contains(norm(path))
  override def listChildren(path: Path): Seq[Path] =
    children.getOrElse(norm(path), Seq.empty).map(child => Paths.get(child))
  override def toRealPath(path: Path): Path = path
  override def expandUserHome(raw: String): Option[Path] =
    if (raw.isEmpty) None
    else if (raw.startsWith("~"))
      userHome.map(home => Paths.get(home + raw.drop(1)))
    else Some(Paths.get(raw))
}

final class IsabelleHomeSpec extends AnyFunSuite {
  private val Identifier = "etc/ISABELLE_IDENTIFIER"

  test("resolves from ISABELLE_HOME env when the directory contains etc/ISABELLE_IDENTIFIER") {
    val home = "/opt/Isabelle2025-2"
    val fs = new FakeIsabelleHomeFs(
      directories = Set(home),
      files = Set(s"$home/$Identifier")
    )

    val resolved = IsabelleHome.resolve(Map("ISABELLE_HOME" -> home), None, "Linux", fs)

    assert(resolved.contains(Paths.get(home)))
  }

  test("ignores ISABELLE_HOME pointing at a directory without the identifier file") {
    val home = "/opt/not-isabelle"
    val fs = new FakeIsabelleHomeFs(
      directories = Set(home),
      files = Set.empty
    )

    val resolved = IsabelleHome.resolve(Map("ISABELLE_HOME" -> home), None, "Linux", fs)

    assert(resolved.isEmpty)
  }

  test("derives the home from an executable path one directory above") {
    val home = "/opt/Isabelle2025-2"
    val exe = s"$home/bin/isabelle"
    val fs = new FakeIsabelleHomeFs(
      directories = Set(home, s"$home/bin"),
      files = Set(s"$home/$Identifier", exe)
    )

    val resolved = IsabelleHome.resolve(Map.empty, Some(exe), "Linux", fs)

    assert(resolved.contains(Paths.get(home)))
  }

  test("derives the home by walking multiple ancestor levels (macOS app-bundle Resources nesting)") {
    val home = "/Applications/Isabelle2025-2.app/Isabelle/Isabelle2025-2"
    val exe = s"$home/bin/isabelle"
    val fs = new FakeIsabelleHomeFs(
      directories = Set(home, s"$home/bin"),
      files = Set(s"$home/$Identifier", exe)
    )

    val resolved = IsabelleHome.resolve(Map.empty, Some(exe), "Mac OS X", fs)

    assert(resolved.contains(Paths.get(home)))
  }

  test("env-resolved home wins over executable-derived home when both are valid") {
    val envHome = "/opt/IsabelleEnv"
    val exeHome = "/opt/IsabelleExe"
    val exe = s"$exeHome/bin/isabelle"
    val fs = new FakeIsabelleHomeFs(
      directories = Set(envHome, exeHome, s"$exeHome/bin"),
      files = Set(s"$envHome/$Identifier", s"$exeHome/$Identifier", exe)
    )

    val resolved = IsabelleHome.resolve(Map("ISABELLE_HOME" -> envHome), Some(exe), "Linux", fs)

    assert(resolved.contains(Paths.get(envHome)))
  }

  test("falls back to a platform-default install on Windows when env and exec are missing") {
    // The IsabelleHome resolver calls Paths.get("C:\\Tools") which on a
    // POSIX JVM is a single-segment relative path; on Windows JVMs it is
    // an absolute path. In both cases the FakeIsabelleHomeFs's `norm`
    // helper replaces backslashes with forward slashes, so the directory
    // entries in the fake must use the slash-form to match.
    val tools = "C:/Tools"
    val home = s"$tools/Isabelle2025-2"
    val fs = new FakeIsabelleHomeFs(
      directories = Set(tools, home),
      files = Set(s"$home/$Identifier"),
      children = Map(
        tools -> Seq(home)
      )
    )

    val resolved = IsabelleHome.resolve(Map.empty, None, "Windows 11", fs)

    assert(resolved.isDefined)
    assert(resolved.get.toString.replace('\\', '/').endsWith("Isabelle2025-2"))
  }

  test("returns None cleanly when nothing resolves") {
    val fs = new FakeIsabelleHomeFs(directories = Set.empty, files = Set.empty)

    val resolved = IsabelleHome.resolve(Map.empty, None, "Linux", fs)

    assert(resolved.isEmpty)
  }

  test("picks the highest-versioned platform-default candidate") {
    val homeA = "C:/Tools/Isabelle2024-1"
    val homeB = "C:/Tools/Isabelle2025-2"
    val fs = new FakeIsabelleHomeFs(
      directories = Set("C:/Tools", homeA, homeB),
      files = Set(s"$homeA/$Identifier", s"$homeB/$Identifier"),
      children = Map(
        "C:/Tools" -> Seq(homeA, homeB)
      )
    )

    val resolved = IsabelleHome.resolve(Map.empty, None, "Windows", fs)

    assert(resolved.isDefined)
    assert(resolved.get.toString.replace('\\', '/').endsWith("Isabelle2025-2"))
  }

  test("ignores empty ISABELLE_HOME values") {
    val fs = new FakeIsabelleHomeFs()

    val resolved = IsabelleHome.resolve(Map("ISABELLE_HOME" -> ""), None, "Linux", fs)

    assert(resolved.isEmpty)
  }
}
