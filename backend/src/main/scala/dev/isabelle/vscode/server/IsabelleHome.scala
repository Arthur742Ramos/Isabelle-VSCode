package dev.isabelle.vscode.server

import java.nio.file.{Path, Paths}
import scala.util.control.NonFatal

/**
 * Minimal filesystem interface used by [[IsabelleHome]] and
 * [[IsabellePideClasspath]]. Injected so the resolvers stay
 * vscode-style "pure modules with injected dependencies" — Scala-side
 * specs can supply a fake without touching the real filesystem.
 *
 * All methods are total and never throw — they swallow IO failures and
 * return safe defaults (false / None / Seq.empty), so callers can chain
 * candidate paths without try/catch.
 */
trait IsabelleHomeFs {
  def isDirectory(path: Path): Boolean
  def isRegularFile(path: Path): Boolean
  def listChildren(path: Path): Seq[Path]
  def toRealPath(path: Path): Path
  def expandUserHome(raw: String): Option[Path]
}

object RealIsabelleHomeFs extends IsabelleHomeFs {
  import java.nio.file.Files

  override def isDirectory(path: Path): Boolean =
    try Files.isDirectory(path)
    catch { case NonFatal(_) => false }

  override def isRegularFile(path: Path): Boolean =
    try Files.isRegularFile(path)
    catch { case NonFatal(_) => false }

  override def listChildren(path: Path): Seq[Path] =
    try {
      val stream = Files.list(path)
      try {
        val builder = Seq.newBuilder[Path]
        stream.forEach(p => builder += p)
        builder.result()
      } finally stream.close()
    } catch { case NonFatal(_) => Seq.empty }

  override def toRealPath(path: Path): Path =
    try path.toRealPath()
    catch { case NonFatal(_) => path.toAbsolutePath.normalize() }

  override def expandUserHome(raw: String): Option[Path] =
    if (raw.isEmpty) None
    else if (raw == "~" || raw.startsWith("~/") || raw.startsWith("~\\")) {
      Option(System.getProperty("user.home"))
        .filter(_.nonEmpty)
        .map(home => Paths.get(home, raw.drop(1).stripPrefix("/").stripPrefix("\\")))
    } else {
      try Some(Paths.get(raw)) catch { case NonFatal(_) => None }
    }
}

/**
 * Pure resolver for the location of an Isabelle distribution on disk.
 *
 * Resolution order (first hit wins):
 *
 *   1. `env("ISABELLE_HOME")` if it points to a directory containing
 *      `etc/ISABELLE_IDENTIFIER`.
 *   2. Derive from a configured Isabelle launcher path. We resolve any
 *      symlink with `toRealPath` and then walk up to five parent
 *      directories looking for `etc/ISABELLE_IDENTIFIER`. This handles
 *      `<home>/bin/isabelle.ps1` (Windows), `<home>/bin/isabelle`
 *      (POSIX), macOS app-bundle Resources layouts, Nix store paths,
 *      and Snap wrappers.
 *   3. Platform-standard install locations — each candidate is checked
 *      for `etc/ISABELLE_IDENTIFIER` and the lexicographically last
 *      match wins (Isabelle versions are `YYYY-N` so this approximates
 *      "newest available"; agents may want to revisit if a `YYYY-10`
 *      release ever ships).
 *
 * Returns `None` cleanly when nothing resolves — callers must treat
 * that as "no Isabelle on this machine, stay on the local-syntax
 * bridge" rather than as an error.
 */
object IsabelleHome {
  private val IdentifierRelativePath = "etc/ISABELLE_IDENTIFIER"
  private val MaxAncestorWalk = 5

  def resolve(
    env: Map[String, String],
    executablePath: Option[String],
    platform: String,
    fs: IsabelleHomeFs
  ): Option[Path] =
    fromEnv(env, fs)
      .orElse(fromExecutable(executablePath, fs))
      .orElse(fromPlatformDefaults(platform, env, fs))

  private def fromEnv(env: Map[String, String], fs: IsabelleHomeFs): Option[Path] =
    env.get("ISABELLE_HOME")
      .filter(_.nonEmpty)
      .flatMap(raw => safePath(raw))
      .filter(path => containsIdentifier(path, fs))
      .map(path => fs.toRealPath(path))

  private def fromExecutable(executablePath: Option[String], fs: IsabelleHomeFs): Option[Path] =
    executablePath
      .filter(_.nonEmpty)
      .flatMap(raw => safePath(raw))
      .map(path => fs.toRealPath(path))
      .flatMap(real => ancestorWithIdentifier(real, fs))

  private def fromPlatformDefaults(
    platform: String,
    env: Map[String, String],
    fs: IsabelleHomeFs
  ): Option[Path] = {
    val candidates = platformCandidates(platform, env, fs)
    val matches = candidates.flatMap(parent => listMatchingChildren(parent, fs))
    matches.sortBy(_.getFileName.toString).lastOption
  }

  private def platformCandidates(
    platform: String,
    env: Map[String, String],
    fs: IsabelleHomeFs
  ): Seq[Path] = {
    val home = env.get("HOME").orElse(env.get("USERPROFILE")).filter(_.nonEmpty)
    platform.toLowerCase match {
      case p if p.startsWith("win") =>
        Seq(
          safePath("C:\\Tools"),
          env.get("LOCALAPPDATA").filter(_.nonEmpty).flatMap(raw => safePath(raw)).map(_.resolve("Programs"))
        ).flatten
      case p if p.contains("mac") || p.contains("darwin") =>
        Seq(
          safePath("/Applications"),
          home.flatMap(raw => safePath(raw)).map(_.resolve("Applications"))
        ).flatten
      case _ =>
        Seq(
          safePath("/opt"),
          safePath("/usr/local"),
          home.flatMap(raw => safePath(raw))
        ).flatten
    }
  }

  private def listMatchingChildren(parent: Path, fs: IsabelleHomeFs): Seq[Path] =
    if (!fs.isDirectory(parent)) Seq.empty
    else
      fs.listChildren(parent)
        .filter(child => child.getFileName != null && child.getFileName.toString.startsWith("Isabelle"))
        .flatMap(child => candidateAndNested(child, fs))
        .filter(path => containsIdentifier(path, fs))
        .map(path => fs.toRealPath(path))

  /**
   * macOS ships Isabelle as `Isabelle2025-2.app/Isabelle/Isabelle2025-2/`,
   * so for each `Isabelle*` child we also probe the nested `Isabelle*`
   * grandchild before giving up.
   */
  private def candidateAndNested(child: Path, fs: IsabelleHomeFs): Seq[Path] = {
    val base = Seq(child)
    if (!fs.isDirectory(child)) base
    else {
      val nested = fs.listChildren(child)
        .filter(grand => grand.getFileName != null && grand.getFileName.toString.startsWith("Isabelle"))
        .flatMap { grand =>
          val deeper = fs.listChildren(grand)
            .filter(g2 => g2.getFileName != null && g2.getFileName.toString.startsWith("Isabelle"))
          grand +: deeper
        }
      base ++ nested
    }
  }

  private def ancestorWithIdentifier(start: Path, fs: IsabelleHomeFs): Option[Path] = {
    var current: Path = start
    var depth = 0
    while (current != null && depth <= MaxAncestorWalk) {
      if (containsIdentifier(current, fs)) {
        return Some(current)
      }
      current = current.getParent
      depth += 1
    }
    None
  }

  private def containsIdentifier(home: Path, fs: IsabelleHomeFs): Boolean =
    fs.isDirectory(home) && fs.isRegularFile(home.resolve(IdentifierRelativePath))

  private def safePath(raw: String): Option[Path] =
    try Some(Paths.get(raw)) catch { case NonFatal(_) => None }
}
