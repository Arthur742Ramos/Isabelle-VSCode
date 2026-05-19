package dev.isabelle.vscode.server

import scala.jdk.CollectionConverters.MapHasAsScala

/**
 * Pure JSON-RPC handler for the `isabelle/pideVersion` method. Lives
 * outside [[Main]] so the params-parsing and selector dispatch can be
 * unit-tested without spinning up the framed protocol loop.
 */
object PideVersionHandler {
  def handle(
    params: Option[ujson.Value],
    env: Map[String, String],
    platform: String,
    fs: IsabelleHomeFs = RealIsabelleHomeFs,
    loaderFactory: IsabelleClassLoaderFactory = IsabelleClassLoaderFactory.Real
  ): ujson.Value = {
    val executablePath = params
      .flatMap(_.objOpt)
      .flatMap(_.get("isabelleExecutablePath"))
      .flatMap(_.strOpt)
      .filter(_.nonEmpty)

    val (_, status) = PideBridgeSelector.select(env, executablePath, platform, fs, loaderFactory)
    status.toJson
  }

  /**
   * Convenience wrapper that reads the current process environment +
   * `os.name` system property. Used by [[Main]] in production; tests
   * call [[handle]] directly with a controlled env map.
   */
  def handleWithSystemEnv(
    params: Option[ujson.Value],
    fs: IsabelleHomeFs = RealIsabelleHomeFs,
    loaderFactory: IsabelleClassLoaderFactory = IsabelleClassLoaderFactory.Real
  ): ujson.Value =
    handle(
      params = params,
      env = System.getenv().asScala.toMap,
      platform = Option(System.getProperty("os.name")).getOrElse(""),
      fs = fs,
      loaderFactory = loaderFactory
    )
}
