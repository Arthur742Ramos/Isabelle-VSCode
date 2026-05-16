package dev.isabelle.vscode.server

import java.io.{BufferedInputStream, BufferedOutputStream}
import scala.sys.process.Process
import scala.util.control.NonFatal

object Main {
  private val documents = new DocumentStore

  def main(args: Array[String]): Unit = {
    val in = new BufferedInputStream(System.in)
    val out = new BufferedOutputStream(System.out)
    val framing = new ContentLengthFraming(in, out)

    Iterator.continually(framing.read()).takeWhile(_.isDefined).flatten.foreach { request =>
      val response =
        try handle(request)
        catch {
          case NonFatal(error) =>
            Protocol.error(request.id, -32000, error.getMessage)
        }

      framing.write(response.json)
    }
  }

  private def handle(request: Protocol.Request): Protocol.Response =
    if (request.protocolVersion != Protocol.ProtocolVersion) {
      Protocol.error(
        request.id,
        -32600,
        s"Unsupported protocol version ${request.protocolVersion}; expected ${Protocol.ProtocolVersion}"
      )
    } else {
    request.method match {
      case "server/health" =>
        val executable = request.params.flatMap(_.objOpt.flatMap(_.get("isabelleExecutablePath"))).map(_.str).getOrElse("isabelle")
        Protocol.success(request.id, ujson.Obj(
          "protocolVersion" -> Protocol.ProtocolVersion,
          "backend" -> ujson.Obj(
            "status" -> "ok",
            "implementation" -> "scala"
          ),
          "isabelle" -> healthFor(executable)
        ))

      case "isabelle/version" =>
        val executable = request.params.flatMap(_.objOpt.flatMap(_.get("isabelleExecutablePath"))).map(_.str).getOrElse("isabelle")
        val version = IsabelleCli.version(executable)
        Protocol.success(request.id, ujson.Obj(
          "executablePath" -> executable,
          "version" -> version.summary,
          "raw" -> version.raw
        ))

      case "session/discover" =>
        Protocol.success(request.id, ujson.Obj("sessions" -> ujson.Arr()))

      case "document/openTheory" =>
        val params = request.requiredParams
        Protocol.success(request.id, documents.open(
          uri = params("uri").str,
          text = params("text").str,
          version = params("version").num.toInt,
          session = params.get("session").flatMap(_.strOpt)
        ))

      case "document/update" =>
        val params = request.requiredParams
        Protocol.success(request.id, documents.update(
          uri = params("uri").str,
          text = params("text").str,
          version = params("version").num.toInt
        ))

      case "document/close" =>
        val params = request.requiredParams
        Protocol.success(request.id, documents.close(params("uri").str))

      case other =>
        Protocol.error(request.id, -32601, s"Unsupported method: $other")
    }
    }

  private def healthFor(executable: String): ujson.Value =
    try {
      val version = IsabelleCli.version(executable)
      ujson.Obj(
        "status" -> "ok",
        "executablePath" -> executable,
        "version" -> version.summary
      )
    } catch {
      case NonFatal(error) =>
        val reason = Option(error.getMessage).filter(_.nonEmpty).getOrElse(error.getClass.getSimpleName)
        ujson.Obj(
          "status" -> "unavailable",
          "executablePath" -> executable,
          "reason" -> reason
        )
    }
}

final case class IsabelleVersion(raw: String, summary: String)

object IsabelleCli {
  def version(executable: String): IsabelleVersion = {
    val output = Process(Seq(executable, "version")).!!
    val raw = output.trim
    val summary = raw.linesIterator.find(_.trim.nonEmpty).getOrElse(raw)
    IsabelleVersion(raw, summary)
  }
}
