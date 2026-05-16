package dev.isabelle.vscode.server

import java.io.{BufferedInputStream, BufferedOutputStream}
import java.nio.charset.StandardCharsets

final class ContentLengthFraming(in: BufferedInputStream, out: BufferedOutputStream) {
  def read(): Option[Protocol.Request] = {
    val header = readHeader()
    if (header.isEmpty) {
      return None
    }

    val contentLength = header
      .split("\r\n")
      .collectFirst {
        case line if line.toLowerCase.startsWith("content-length:") =>
          line.dropWhile(_ != ':').drop(1).trim.toInt
      }
      .getOrElse(throw new IllegalArgumentException("Missing Content-Length header"))

    val body = in.readNBytes(contentLength)
    if (body.length != contentLength) {
      None
    } else {
      Some(Protocol.parse(ujson.read(new String(body, StandardCharsets.UTF_8))))
    }
  }

  def write(value: ujson.Value): Unit = {
    val body = value.render().getBytes(StandardCharsets.UTF_8)
    val header = s"Content-Length: ${body.length}\r\n\r\n".getBytes(StandardCharsets.US_ASCII)
    out.write(header)
    out.write(body)
    out.flush()
  }

  private def readHeader(): String = {
    val bytes = Vector.newBuilder[Byte]
    var previous = Vector.empty[Byte]
    var current = in.read()

    while (current != -1) {
      val byte = current.toByte
      bytes += byte
      previous = (previous :+ byte).takeRight(4)
      if (previous == Vector('\r'.toByte, '\n'.toByte, '\r'.toByte, '\n'.toByte)) {
        val allBytes = bytes.result().dropRight(4).toArray
        return new String(allBytes, StandardCharsets.US_ASCII)
      }
      current = in.read()
    }

    ""
  }
}
