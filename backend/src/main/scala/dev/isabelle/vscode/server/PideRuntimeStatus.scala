package dev.isabelle.vscode.server

import java.nio.file.Path

/**
 * Structured diagnostic for the Isabelle/PIDE runtime classpath
 * bridge. Built by [[PideBridgeSelector]] and serialized as the
 * `isabelle/pideVersion` JSON-RPC result. Kept as a separate model
 * (rather than collapsing into the trait) so the diagnostic surface
 * can grow without forcing every `PideBridge` implementation to
 * implement diagnostic concerns.
 */
final case class PideRuntimeStatus(
  bridge: String,
  version: String,
  isabelleHome: Option[Path],
  source: String,
  classloaderReady: Boolean,
  proofOfLife: String,
  reason: Option[String],
  message: String
) {
  def toJson: ujson.Value = {
    val obj = ujson.Obj(
      "bridge" -> bridge,
      "version" -> version,
      "source" -> source,
      "classloaderReady" -> classloaderReady,
      "proofOfLife" -> proofOfLife,
      "message" -> message
    )
    isabelleHome.foreach(home => obj("isabelleHome") = home.toString)
    reason.foreach(value => obj("reason") = value)
    obj
  }
}

object PideRuntimeStatus {
  // bridge values
  val PideEnabled: String = "pide-enabled"
  val LocalSyntax: String = "local-syntax"

  // source values
  val SourceModule: String = "isabelle_system-module"
  val SourceIdentifierFile: String = "etc-identifier-file"
  val SourceUnavailable: String = "unavailable"

  // proofOfLife values
  val ProofModule: String = "module-loaded"
  val ProofClassOnly: String = "class-only"
  val ProofNone: String = "none"

  // reason values
  val ReasonHomeNotFound: String = "home-not-found"
  val ReasonIsabelleJarMissing: String = "isabelle-jar-missing"
  val ReasonScalaRuntimeMissing: String = "scala-runtime-missing"
  val ReasonClassLoadFailed: String = "class-load-failed"
  val ReasonModuleInitFailed: String = "module-init-failed"

  /**
   * Standard "no Isabelle resolvable" status. Used both when there is
   * no Isabelle install on the machine AND when the user has not
   * configured `isabelle.executablePath` or `ISABELLE_HOME` yet.
   */
  def homeNotFound(): PideRuntimeStatus =
    PideRuntimeStatus(
      bridge = LocalSyntax,
      version = "",
      isabelleHome = None,
      source = SourceUnavailable,
      classloaderReady = false,
      proofOfLife = ProofNone,
      reason = Some(ReasonHomeNotFound),
      message = "No Isabelle install detected. Set ISABELLE_HOME or configure isabelle.executablePath, then restart the backend so the env var is re-read."
    )
}
