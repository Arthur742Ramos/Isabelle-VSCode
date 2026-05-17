ThisBuild / scalaVersion := "2.13.14"
ThisBuild / organization := "dev.isabelle"

lazy val backend = (project in file("."))
  .settings(
    name := "isabelle-vscode-server",
    Compile / mainClass := Some("dev.isabelle.vscode.server.Main"),
    Compile / packageBin / artifactName := { (_, _, _) => "isabelle-vscode-server.jar" },
    libraryDependencies ++= Seq(
      "com.lihaoyi" %% "ujson" % "3.3.1",
      "org.scalatest" %% "scalatest" % "3.2.19" % Test
    )
  )
