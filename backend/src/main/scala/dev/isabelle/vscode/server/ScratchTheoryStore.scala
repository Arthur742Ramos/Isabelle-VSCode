package dev.isabelle.vscode.server

import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path, Paths, StandardOpenOption}
import scala.util.control.NonFatal

/**
 * Manages the on-disk staging area where in-memory theory text is
 * written so that `isabelle.Headless.Session.use_theories(...)` can
 * read it as a `<TheoryName>.thy` file.
 *
 * Storage layout:
 *
 *   <scratchRoot>/                  ← from BACKEND_SCRATCH_DIR env var
 *     <workspaceHash>/              ← stable hash of the workspace folder
 *       <TheoryName>.thy            ← latest staged text for this theory
 *
 * `<scratchRoot>` is `context.globalStorageUri.fsPath` on the VS Code
 * side (per-extension, cross-platform, auto-cleaned on uninstall —
 * NOT the OS temp dir, which gets nuked on schedules we can't
 * control).
 *
 * Theory text is encoded through [[SymbolTranslator.encode]] before
 * being written so Isabelle's parser sees `\<lambda>` instead of `λ`.
 *
 * All filesystem operations are side-effecting; failures throw the
 * underlying [[java.io.IOException]] so callers can decide whether to
 * surface a user-visible error or fall back to local-syntax bridge.
 */
final class ScratchTheoryStore(
  scratchRoot: Path,
  symbolTranslator: SymbolTranslator
) {
  /** Ensures the scratch root exists. Idempotent. */
  def initialize(): Unit = {
    Files.createDirectories(scratchRoot)
  }

  /**
   * Resolve the directory where a given workspace's theory files live.
   * Workspace hash keeps multiple workspaces from clobbering each
   * other inside the shared globalStorage scratch root.
   */
  def workspaceDir(workspaceUri: String): Path = {
    val sub = scratchRoot.resolve(ScratchTheoryStore.workspaceHash(workspaceUri))
    Files.createDirectories(sub)
    sub
  }

  /**
   * Encode the theory's Unicode text and write it under
   * `<workspaceDir>/<theoryName>.thy`. Returns the absolute path of
   * the staged file (the master_dir that `use_theories` needs).
   */
  def stage(
    workspaceUri: String,
    theoryName: String,
    unicodeText: String
  ): Path = {
    val dir = workspaceDir(workspaceUri)
    val target = dir.resolve(ScratchTheoryStore.sanitizeTheoryName(theoryName) + ".thy")
    val encoded = symbolTranslator.encode(unicodeText)
    Files.writeString(
      target,
      encoded,
      StandardCharsets.UTF_8,
      StandardOpenOption.CREATE,
      StandardOpenOption.TRUNCATE_EXISTING
    )
    target
  }

  /**
   * Best-effort cleanup of the scratch root. Called from backend
   * shutdown so the on-disk staging area does not survive across
   * backend restarts unnecessarily (VS Code's globalStorage cleanup
   * handles the cross-install case).
   */
  def shutdown(): Unit = {
    try {
      if (Files.exists(scratchRoot)) {
        ScratchTheoryStore.deleteRecursively(scratchRoot)
      }
    } catch { case NonFatal(_) => () }
  }
}

object ScratchTheoryStore {
  /** Stable 16-character SHA-1 fragment so different workspaces map
    * to predictably-disjoint subdirectories. */
  def workspaceHash(workspaceUri: String): String = {
    val digest = java.security.MessageDigest.getInstance("SHA-1")
    val bytes = digest.digest(workspaceUri.getBytes(StandardCharsets.UTF_8))
    bytes.take(8).map(b => "%02x".format(b)).mkString
  }

  /** Strip path separators / parent traversals so a user-supplied
    * theory name cannot escape the workspace subdirectory. */
  def sanitizeTheoryName(theoryName: String): String = {
    val cleaned = theoryName.replaceAll("[^A-Za-z0-9_]", "_")
    if (cleaned.isEmpty) "Unknown" else cleaned
  }

  /** Recursive delete that ignores I/O errors (best-effort cleanup). */
  def deleteRecursively(path: Path): Unit = {
    if (Files.isDirectory(path)) {
      val stream = Files.list(path)
      try stream.forEach(deleteRecursively)
      finally stream.close()
    }
    try Files.deleteIfExists(path) catch { case _: Throwable => () }
  }

  /**
   * Resolve the scratch root path from process environment. Reads the
   * `BACKEND_SCRATCH_DIR` env var (set by `BackendManager.spawn` from
   * `context.globalStorageUri.fsPath`); falls back to
   * `<java.io.tmpdir>/isabelle-vscode-pide-scratch-<pid>` only if the
   * env var is absent or empty (developer-mode launches).
   */
  def resolveScratchRoot(env: Map[String, String]): Path = {
    env.get("BACKEND_SCRATCH_DIR").filter(_.nonEmpty) match {
      case Some(value) => Paths.get(value)
      case None =>
        val tmp = Option(System.getProperty("java.io.tmpdir")).getOrElse(".")
        val pid =
          try ProcessHandle.current().pid().toString
          catch { case _: Throwable => "0" }
        Paths.get(tmp, s"isabelle-vscode-pide-scratch-$pid")
    }
  }
}
