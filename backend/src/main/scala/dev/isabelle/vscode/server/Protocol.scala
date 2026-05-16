package dev.isabelle.vscode.server

object Protocol {
  val ProtocolVersion: Int = 1

  final case class Request(id: String, method: String, protocolVersion: Int, params: Option[ujson.Value])
  {
    def requiredParams =
      params.map(_.obj).getOrElse(throw new IllegalArgumentException(s"Missing params for $method"))
  }

  final case class Response(json: ujson.Value)

  def parse(value: ujson.Value): Request = {
    val obj = value.obj
    Request(
      id = obj("id").str,
      method = obj("method").str,
      protocolVersion = obj.get("protocolVersion").map(_.num.toInt).getOrElse(0),
      params = obj.get("params")
    )
  }

  def success(id: String, result: ujson.Value): Response =
    Response(ujson.Obj(
      "jsonrpc" -> "2.0",
      "id" -> id,
      "result" -> result
    ))

  def error(id: String, code: Int, message: String): Response =
    Response(ujson.Obj(
      "jsonrpc" -> "2.0",
      "id" -> id,
      "error" -> ujson.Obj(
        "code" -> code,
        "message" -> message
      )
    ))
}
