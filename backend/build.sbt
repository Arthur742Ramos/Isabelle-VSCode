ThisBuild / scalaVersion := "2.13.14"
ThisBuild / organization := "dev.isabelle"

lazy val backend = (project in file("."))
  .settings(
    name := "isabelle-vscode-server",
    Compile / mainClass := Some("dev.isabelle.vscode.server.Main"),
    Compile / packageBin / artifactName := { (_, _, _) => "isabelle-vscode-server.jar" },
    libraryDependencies ++= Seq(
      "com.lihaoyi" %% "ujson" % "3.3.1",
      // scala-isabelle is the compile-time seam for the future
      // ScalaIsabellePideBridge. The library itself only requires a
      // running Isabelle installation (Linux/macOS, Isabelle 2019+) at
      // runtime; compilation and the existing tests do not need
      // Isabelle on PATH. See ScalaIsabellePideBridge.scala.
      "de.unruh" %% "scala-isabelle" % "0.4.5",
      "org.scalatest" %% "scalatest" % "3.2.19" % Test
    )
  )
