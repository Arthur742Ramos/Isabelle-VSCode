ThisBuild / scalaVersion := "3.3.4"
ThisBuild / organization := "dev.isabelle"

lazy val backend = (project in file("."))
  .settings(
    name := "isabelle-vscode-server",
    Compile / mainClass := Some("dev.isabelle.vscode.server.Main"),
    Compile / packageBin / artifactName := { (_, _, _) => "isabelle-vscode-server.jar" },
    assembly / mainClass := Some("dev.isabelle.vscode.server.Main"),
    assembly / assemblyJarName := "isabelle-vscode-server.jar",
    // Pin the fat-jar output to a stable, Scala-version-independent path so
    // `package.json`'s backend:package script and `BackendManager.ts`'s
    // development-jar lookup do not have to track sbt's per-Scala-version
    // target subdirectory (Scala 3.3.4 emits to `target/scala-3.3.4/`).
    assembly / assemblyOutputPath := baseDirectory.value / "target" / (assembly / assemblyJarName).value,
    assembly / assemblyMergeStrategy := {
      case PathList("META-INF", xs @ _*) =>
        xs.map(_.toLowerCase) match {
          case "manifest.mf" :: Nil => MergeStrategy.discard
          case "index.list" :: Nil => MergeStrategy.discard
          case "dependencies" :: Nil => MergeStrategy.discard
          case ps if ps.lastOption.exists(p => p.endsWith(".sf") || p.endsWith(".dsa") || p.endsWith(".rsa")) =>
            MergeStrategy.discard
          case "services" :: _ => MergeStrategy.concat
          case _ => MergeStrategy.discard
        }
      case "module-info.class" => MergeStrategy.discard
      case "reference.conf" => MergeStrategy.concat
      case _ => MergeStrategy.deduplicate
    },
    libraryDependencies ++= Seq(
      "com.lihaoyi" %% "ujson" % "3.3.1",
      "org.scalatest" %% "scalatest" % "3.2.19" % Test
    )
  )
