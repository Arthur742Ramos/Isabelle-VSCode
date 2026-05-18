ThisBuild / scalaVersion := "2.13.14"
ThisBuild / organization := "dev.isabelle"

lazy val backend = (project in file("."))
  .settings(
    name := "isabelle-vscode-server",
    Compile / mainClass := Some("dev.isabelle.vscode.server.Main"),
    Compile / packageBin / artifactName := { (_, _, _) => "isabelle-vscode-server.jar" },
    assembly / mainClass := Some("dev.isabelle.vscode.server.Main"),
    assembly / assemblyJarName := "isabelle-vscode-server.jar",
    assembly / assemblyMergeStrategy := {
      case PathList("META-INF", xs @ _*) =>
        xs.map(_.toLowerCase) match {
          case "manifest.mf" :: Nil => MergeStrategy.discard
          case ps if ps.lastOption.exists(p => p.endsWith(".sf") || p.endsWith(".dsa") || p.endsWith(".rsa")) =>
            MergeStrategy.discard
          case _ => MergeStrategy.first
        }
      case "module-info.class" => MergeStrategy.discard
      case _ => MergeStrategy.first
    },
    libraryDependencies ++= Seq(
      "com.lihaoyi" %% "ujson" % "3.3.1",
      "org.scalatest" %% "scalatest" % "3.2.19" % Test
    )
  )
