package dev.isabelle.vscode.server

import java.io.IOException
import java.net.{URL, URLClassLoader}
import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path}
import scala.util.control.NonFatal

/**
 * Factory for the JVM classloader that loads Isabelle's PIDE jars at
 * runtime. Injected into [[PideBridgeSelector]] so specs can supply a
 * deterministic fake (no real filesystem, no zip-handle leaks).
 *
 * The real implementation builds a child `URLClassLoader` with the
 * parent set to the caller's classloader so Scala stdlib classes from
 * our backend's own fat jar resolve first (their binary version
 * matches Isabelle's bundled Scala because Phase 0 aligned us on
 * Scala 3.3.4).
 */
trait IsabelleClassLoaderFactory {
  def newLoader(urls: Seq[URL], parent: ClassLoader): URLClassLoader
}

object IsabelleClassLoaderFactory {
  val Real: IsabelleClassLoaderFactory = new IsabelleClassLoaderFactory {
    override def newLoader(urls: Seq[URL], parent: ClassLoader): URLClassLoader =
      new URLClassLoader(urls.toArray, parent)
  }
}

/**
 * Selects the active [[PideBridge]] for a given request and produces a
 * matching [[PideRuntimeStatus]] for the `isabelle/pideVersion`
 * JSON-RPC handler.
 *
 * Per-call lifecycle (intentional, Phase 1 only):
 *
 *   1. Resolve `IsabelleHome` from env + executablePath + platform
 *      defaults.
 *   2. Build the classpath jar list. Fail fast with a structured
 *      reason if the install lacks `lib/classes/isabelle.jar` or a
 *      matching `contrib/scala-*` runtime.
 *   3. Construct a fresh `URLClassLoader`.
 *   4. Reflectively probe `isabelle.Isabelle_System$.MODULE$` to prove
 *      bytes findable AND Scala 3 module initialization works AND the
 *      `MODULE$` reflection pattern is reachable from our backend.
 *   5. Read `<home>/etc/ISABELLE_IDENTIFIER` for the displayed version
 *      string (cheap, no JVM round-trip).
 *   6. **Close the loader** before returning so we never pin
 *      Isabelle's jar handles on Windows. Phase 2 will introduce
 *      lifetime-managed caching when documents actively depend on the
 *      loader.
 *
 * Returns both a `PideBridge` (for downstream calls that might use
 * the trait's `isabelleVersion()` method) and a richer
 * [[PideRuntimeStatus]] for the JSON response.
 */
object PideBridgeSelector {
  private val IdentifierRelativePath = "etc/ISABELLE_IDENTIFIER"

  def select(
    env: Map[String, String],
    executablePath: Option[String],
    platform: String,
    fs: IsabelleHomeFs = RealIsabelleHomeFs,
    loaderFactory: IsabelleClassLoaderFactory = IsabelleClassLoaderFactory.Real
  ): (PideBridge, PideRuntimeStatus) = {
    IsabelleHome.resolve(env, executablePath, platform, fs) match {
      case None =>
        (new LocalSyntaxPideBridge, PideRuntimeStatus.homeNotFound())

      case Some(home) =>
        IsabellePideClasspath.build(home, fs) match {
          case Left(error) =>
            val reason = error match {
              case IsabellePideClasspath.IsabelleJarMissing    => PideRuntimeStatus.ReasonIsabelleJarMissing
              case IsabellePideClasspath.ScalaRuntimeMissing   => PideRuntimeStatus.ReasonScalaRuntimeMissing
            }
            val status = PideRuntimeStatus(
              bridge = PideRuntimeStatus.LocalSyntax,
              version = "",
              isabelleHome = Some(home),
              source = PideRuntimeStatus.SourceUnavailable,
              classloaderReady = false,
              proofOfLife = PideRuntimeStatus.ProofNone,
              reason = Some(reason),
              message =
                s"Isabelle home resolved (${home}) but the runtime classpath is incomplete: ${error.message}"
            )
            (new LocalSyntaxPideBridge, status)

          case Right(resolved) =>
            probeAndBuild(home, resolved, loaderFactory)
        }
    }
  }

  private def probeAndBuild(
    home: Path,
    classpath: IsabellePideClasspath.Resolved,
    loaderFactory: IsabelleClassLoaderFactory
  ): (PideBridge, PideRuntimeStatus) = {
    val loader = loaderFactory.newLoader(classpath.toUrls, getClass.getClassLoader)
    try {
      val probe = probeIsabelleSystem(loader)
      val version = readIdentifierFile(home)
      val versionPresent = version.nonEmpty

      probe match {
        case ProbeResult.ModuleLoaded =>
          val displayVersion = if (versionPresent) version else "(version file missing)"
          val bridge = new PideEnabledBridge(displayVersion)
          val status = PideRuntimeStatus(
            bridge = PideRuntimeStatus.PideEnabled,
            version = displayVersion,
            isabelleHome = Some(home),
            source =
              if (versionPresent) PideRuntimeStatus.SourceIdentifierFile
              else PideRuntimeStatus.SourceModule,
            classloaderReady = true,
            proofOfLife = PideRuntimeStatus.ProofModule,
            reason = None,
            message =
              s"Isabelle runtime classpath: ready. Document backend: local syntax (Phase 2 will swap in PIDE-backed bridges)."
          )
          (bridge, status)

        case ProbeResult.ClassLoadFailed(reason) =>
          val status = PideRuntimeStatus(
            bridge = PideRuntimeStatus.LocalSyntax,
            version = "",
            isabelleHome = Some(home),
            source = PideRuntimeStatus.SourceUnavailable,
            classloaderReady = false,
            proofOfLife = PideRuntimeStatus.ProofNone,
            reason = Some(PideRuntimeStatus.ReasonClassLoadFailed),
            message =
              s"Isabelle home resolved (${home}) but isabelle.Isabelle_System could not be loaded: $reason"
          )
          (new LocalSyntaxPideBridge, status)

        case ProbeResult.ModuleInitFailed(reason) =>
          val status = PideRuntimeStatus(
            bridge = PideRuntimeStatus.LocalSyntax,
            version =
              if (versionPresent) version else "",
            isabelleHome = Some(home),
            source =
              if (versionPresent) PideRuntimeStatus.SourceIdentifierFile
              else PideRuntimeStatus.SourceUnavailable,
            classloaderReady = false,
            proofOfLife = PideRuntimeStatus.ProofClassOnly,
            reason = Some(PideRuntimeStatus.ReasonModuleInitFailed),
            message =
              s"Isabelle classes load but isabelle.Isabelle_System module init failed: $reason"
          )
          (new LocalSyntaxPideBridge, status)
      }
    } finally {
      try loader.close()
      catch { case NonFatal(_) => () }
    }
  }

  private sealed trait ProbeResult
  private object ProbeResult {
    case object ModuleLoaded extends ProbeResult
    final case class ClassLoadFailed(message: String) extends ProbeResult
    final case class ModuleInitFailed(message: String) extends ProbeResult
  }

  private def probeIsabelleSystem(loader: URLClassLoader): ProbeResult = {
    // Step 1: locate the class bytes. Use Class.forName with initialize=false
    // so we can distinguish "class not found" from "static initializer failed".
    val classOpt =
      try {
        Some(Class.forName("isabelle.Isabelle_System$", false, loader))
      } catch {
        case NonFatal(error) =>
          return ProbeResult.ClassLoadFailed(describe(error))
      }

    // Step 2: trigger initialization and read MODULE$. This proves the
    // Scala 3 module pattern works and that Isabelle's static initializer
    // does not throw on our JVM. Static-init failures usually surface as
    // ExceptionInInitializerError wrapping the real cause.
    try {
      val cls = classOpt.get
      Class.forName("isabelle.Isabelle_System$", true, loader)
      val moduleField = cls.getField("MODULE$")
      val module = moduleField.get(null)
      if (module == null) {
        ProbeResult.ModuleInitFailed("MODULE$ field resolved but value is null")
      } else {
        ProbeResult.ModuleLoaded
      }
    } catch {
      case NonFatal(error) => ProbeResult.ModuleInitFailed(describe(error))
    }
  }

  private def describe(error: Throwable): String = {
    val msg = Option(error.getMessage).filter(_.nonEmpty).getOrElse(error.getClass.getSimpleName)
    val cause = Option(error.getCause).map(c => s" (cause: ${c.getClass.getSimpleName})").getOrElse("")
    s"${error.getClass.getSimpleName}: $msg$cause"
  }

  private def readIdentifierFile(home: Path): String = {
    val path = home.resolve(IdentifierRelativePath)
    try {
      if (Files.isRegularFile(path)) Files.readString(path, StandardCharsets.UTF_8).trim
      else ""
    } catch {
      case _: IOException        => ""
      case NonFatal(_)           => ""
    }
  }
}
