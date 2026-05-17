package dev.isabelle.vscode.server

import java.io.{BufferedReader, File, IOException, InputStream, InputStreamReader}
import java.nio.charset.StandardCharsets
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * Experimental second [[PideBridge]] implementation that targets the
 * `isabelle` command-line tool rather than the in-process scala-isabelle
 * PIDE library. Its intent is cross-platform real-Isabelle reachability:
 * the `isabelle` launcher works on Linux, macOS, and Windows (via
 * Isabelle's bundled Cygwin layer), whereas the scala-isabelle bridge is
 * currently Linux/macOS only.
 *
 * Today this bridge does only one real thing: at construction it runs
 * `isabelle version` synchronously, bounded by a strict timeout, and
 * records whether the configured Isabelle is reachable. All trait
 * responses still delegate to a fallback bridge (typically
 * [[LocalSyntaxPideBridge]]); the only divergence is that proof-state
 * and Sledgehammer responses carry a bridge-state-aware `message` field
 * so the eventual UI can surface "Isabelle CLI: reachable" or
 * "unreachable: <reason>" without changing the JSON-RPC protocol.
 *
 * Real CLI / ML-driven document semantics, snapshot-based proof state,
 * and Sledgehammer extraction are intentionally deferred to follow-up
 * PRs. This file is the scaffold those PRs will plug into.
 *
 * This bridge is opt-in. The default backend bridge in `Main.scala`
 * remains [[LocalSyntaxPideBridge]] and is not changed by this scaffold.
 */
final case class IsabelleCliConfig(
  executablePath: String,
  sessionName: Option[String] = None,
  workingDirectory: Option[String] = None,
  verifyTimeoutMillis: Long = 10000L
)

sealed trait IsabelleCliBridgeState

object IsabelleCliBridgeState {
  case object Unverified extends IsabelleCliBridgeState
  final case class Reachable(version: String) extends IsabelleCliBridgeState
  final case class Unreachable(reason: String) extends IsabelleCliBridgeState
}

/**
 * Small helper around `isabelle version` that is robust on Linux, macOS,
 * and Windows. Uses [[java.lang.ProcessBuilder]] directly (still argv
 * form, never a shell string) so the probe can call
 * `Process.waitFor(timeout)` and `destroyForcibly()` to enforce
 * [[IsabelleCliConfig.verifyTimeoutMillis]] without leaking a child
 * process on a misconfigured executable path.
 *
 * The existing [[IsabelleCli]] object in `Main.scala` is intentionally
 * left untouched: it is unbounded and throws on failure, which today's
 * `server/health` and `isabelle/version` handlers depend on. The bridge
 * probe needs different (bounded, total) semantics, so it spawns its own
 * subprocess instead of widening [[IsabelleCli]]'s contract.
 */
private[server] object IsabelleCliRunner {
  def probeVersion(config: IsabelleCliConfig): IsabelleCliBridgeState = {
    val timeoutMs = math.max(1L, config.verifyTimeoutMillis)
    val argv = new java.util.ArrayList[String]()
    argv.add(config.executablePath)
    argv.add("version")

    val pb = new java.lang.ProcessBuilder(argv)
    config.workingDirectory.filter(_.nonEmpty).foreach { dir =>
      pb.directory(new File(dir))
    }
    // Capture stderr separately so we can include it in Unreachable reasons.
    pb.redirectErrorStream(false)

    val process =
      try pb.start()
      catch {
        case t: Throwable =>
          return IsabelleCliBridgeState.Unreachable(
            s"Failed to spawn '${config.executablePath} version': ${describe(t)}"
          )
      }

    // Close stdin so a misbehaving child can't block waiting for input.
    try process.getOutputStream.close()
    catch { case _: IOException => () }

    val stdoutCapture = drainAsync(process.getInputStream, "isabelle-cli-stdout-drain")
    val stderrCapture = drainAsync(process.getErrorStream, "isabelle-cli-stderr-drain")

    val exitedInTime =
      try process.waitFor(timeoutMs, TimeUnit.MILLISECONDS)
      catch {
        case _: InterruptedException =>
          Thread.currentThread().interrupt()
          false
      }

    if (!exitedInTime) {
      // Kill the full process tree, not just the immediate launcher.
      // Isabelle's `isabelle` entry point is often a shell/bat wrapper
      // around bash/Cygwin and Poly/ML; killing only the parent can leak
      // grandchildren on Linux/macOS/Windows alike.
      killProcessTree(process)
      val killCompleted =
        try process.waitFor(500L, TimeUnit.MILLISECONDS)
        catch { case _: Throwable => false }
      // Force-close the parent's read-ends of stdout/stderr so any drain
      // thread still blocked in read() observes EOF and exits even if a
      // pipe handle survived the kill.
      closeQuietly(process.getInputStream)
      closeQuietly(process.getErrorStream)
      val killStderr = stderrCapture.await(500L).trim
      stdoutCapture.await(500L) // bounded join so no daemon thread is left spinning
      val stillAlive =
        try process.isAlive
        catch { case _: Throwable => false }
      val killNote =
        if (!killCompleted || stillAlive) "; forced-kill did not complete within grace period"
        else ""
      val extra = if (killStderr.nonEmpty) s"; stderr: ${truncate(killStderr)}" else ""
      return IsabelleCliBridgeState.Unreachable(
        s"Isabelle '${config.executablePath} version' did not complete within ${timeoutMs}ms$killNote$extra."
      )
    }

    val exit = process.exitValue()
    val stdout = stdoutCapture.await(500L).trim
    val stderr = stderrCapture.await(500L).trim

    if (exit != 0) {
      val detail =
        if (stderr.nonEmpty) s"exit $exit: ${truncate(stderr)}"
        else if (stdout.nonEmpty) s"exit $exit: ${truncate(stdout)}"
        else s"exit $exit"
      return IsabelleCliBridgeState.Unreachable(
        s"Isabelle '${config.executablePath} version' failed ($detail)."
      )
    }

    val version = stdout.linesIterator.map(_.trim).find(_.nonEmpty).getOrElse("")
    if (version.isEmpty) {
      IsabelleCliBridgeState.Unreachable(
        s"Isabelle '${config.executablePath} version' produced no output."
      )
    } else {
      IsabelleCliBridgeState.Reachable(version)
    }
  }

  private def describe(t: Throwable): String =
    Option(t.getMessage).map(_.trim).filter(_.nonEmpty).getOrElse(t.getClass.getSimpleName)

  private def closeQuietly(closeable: java.io.Closeable): Unit =
    try closeable.close()
    catch { case _: Throwable => () }

  // Best-effort process-tree kill. Uses java.lang.ProcessHandle (Java 9+);
  // if the runtime does not support it (or anything else throws), we still
  // fall through to destroyForcibly on the parent, which is the minimum
  // guarantee.
  private def killProcessTree(process: java.lang.Process): Unit = {
    try {
      val handle = process.toHandle
      handle.descendants().forEach(new java.util.function.Consumer[java.lang.ProcessHandle] {
        override def accept(h: java.lang.ProcessHandle): Unit = {
          try { h.destroyForcibly(); () }
          catch { case _: Throwable => () }
        }
      })
    } catch {
      case _: Throwable => ()
    }
    try { process.destroyForcibly(); () }
    catch { case _: Throwable => () }
  }

  private def truncate(value: String): String = {
    val flattened = value.replace('\n', ' ').replace('\r', ' ').trim
    if (flattened.length <= 240) flattened else flattened.substring(0, 240) + "..."
  }

  private trait StreamCapture {
    def await(extraMs: Long): String
  }

  private def drainAsync(in: InputStream, name: String): StreamCapture = {
    val buffer = new AtomicReference[String]("")
    val thread = new Thread(new Runnable {
      override def run(): Unit = {
        val sb = new StringBuilder
        try {
          val reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))
          val cbuf = new Array[Char](4096)
          var n = reader.read(cbuf)
          while (n != -1) {
            sb.append(cbuf, 0, n)
            n = reader.read(cbuf)
          }
        } catch {
          case _: IOException => () // stream closed / process killed
          case _: Throwable => ()
        } finally {
          buffer.set(sb.toString)
          try in.close()
          catch { case _: Throwable => () }
        }
      }
    }, name)
    thread.setDaemon(true)
    thread.start()
    new StreamCapture {
      override def await(extraMs: Long): String = {
        try thread.join(math.max(0L, extraMs))
        catch {
          case _: InterruptedException =>
            Thread.currentThread().interrupt()
        }
        buffer.get()
      }
    }
  }
}

/**
 * Cross-platform CLI-backed [[PideBridge]]. Delegates all real
 * responses to the configured `fallback` bridge so the JSON-RPC shape
 * stays exactly compatible with today's TypeScript consumers; the only
 * thing this bridge contributes today is the reachability state
 * recorded at construction, surfaced through the `message` field of
 * proof-state and Sledgehammer responses.
 *
 * The constructor is total: any failure of the `isabelle version` probe
 * (spawn failure, non-zero exit, timeout, parse failure, unexpected
 * exception) is captured as [[IsabelleCliBridgeState.Unreachable]]
 * instead of being thrown. This lets a wrapping caller construct the
 * bridge speculatively without crashing backend startup on a
 * misconfigured executable path.
 */
final class IsabelleCliPideBridge(
  config: IsabelleCliConfig,
  fallback: PideBridge
) extends PideBridge {

  private val state: IsabelleCliBridgeState =
    try IsabelleCliRunner.probeVersion(config)
    catch {
      case t: Throwable =>
        val msg = Option(t.getMessage).map(_.trim).filter(_.nonEmpty)
          .getOrElse(t.getClass.getSimpleName)
        IsabelleCliBridgeState.Unreachable(s"Probe initialization failed: $msg")
    }

  /** Exposed for diagnostics and tests; never returns `Unverified` today. */
  def stateSnapshot: IsabelleCliBridgeState = state

  override def documentResult(document: TheoryDocument): ujson.Value =
    fallback.documentResult(document)

  override def proofState(document: TheoryDocument, line: Int, character: Int): ujson.Value =
    overrideMessage(
      fallback.proofState(document, line, character),
      proofStateBridgeMessage
    )

  override def sledgehammer(request: SledgehammerRequest): ujson.Value =
    overrideMessage(
      fallback.sledgehammer(request),
      sledgehammerBridgeMessage
    )

  // The fallback's responses are freshly constructed on every call (see
  // LocalSyntaxPideBridge), so mutating the underlying map in place is
  // safe and avoids an extra copy. If a future fallback returns a
  // non-object (or shares state across calls), we fall back to returning
  // the original value unchanged rather than crashing.
  private def overrideMessage(base: ujson.Value, message: String): ujson.Value =
    base.objOpt match {
      case Some(map) =>
        map("message") = ujson.Str(message)
        base
      case None =>
        base
    }

  private def proofStateBridgeMessage: String = state match {
    case IsabelleCliBridgeState.Reachable(version) =>
      s"IsabelleCliPideBridge: reachable ($version); CLI-snapshot proof state is not yet wired. See docs/PIDE_INTEGRATION.md."
    case IsabelleCliBridgeState.Unreachable(reason) =>
      s"IsabelleCliPideBridge: Isabelle CLI unreachable ($reason); falling back to local syntax. See docs/PIDE_INTEGRATION.md."
    case IsabelleCliBridgeState.Unverified =>
      "IsabelleCliPideBridge: bridge state has not been verified; falling back to local syntax. See docs/PIDE_INTEGRATION.md."
  }

  private def sledgehammerBridgeMessage: String = state match {
    case IsabelleCliBridgeState.Reachable(version) =>
      s"IsabelleCliPideBridge: reachable ($version); CLI-snapshot Sledgehammer is not yet wired. See docs/PIDE_INTEGRATION.md."
    case IsabelleCliBridgeState.Unreachable(reason) =>
      s"IsabelleCliPideBridge: Isabelle CLI unreachable ($reason); Sledgehammer proof search remains unavailable. See docs/PIDE_INTEGRATION.md."
    case IsabelleCliBridgeState.Unverified =>
      "IsabelleCliPideBridge: bridge state has not been verified; Sledgehammer proof search remains unavailable. See docs/PIDE_INTEGRATION.md."
  }
}
