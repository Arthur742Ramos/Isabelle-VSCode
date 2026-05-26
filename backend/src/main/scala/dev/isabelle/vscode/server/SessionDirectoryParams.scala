package dev.isabelle.vscode.server

import java.nio.file.{Path, Paths}
import scala.collection.mutable
import scala.util.control.NonFatal

object SessionDirectoryParams {
  def parse(obj: mutable.Map[String, ujson.Value]): Seq[Path] =
    obj.get("sessionDirectories")
      .flatMap(_.arrOpt)
      .map(_.flatMap(_.strOpt).flatMap(safePath).toSeq)
      .getOrElse(Seq.empty)

  private def safePath(raw: String): Option[Path] =
    if (raw.isEmpty) None
    else {
      try Some(Paths.get(raw))
      catch { case NonFatal(_) => None }
    }
}
