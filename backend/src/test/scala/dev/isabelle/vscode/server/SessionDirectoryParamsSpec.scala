package dev.isabelle.vscode.server

import java.nio.file.Paths
import org.scalatest.funsuite.AnyFunSuite

final class SessionDirectoryParamsSpec extends AnyFunSuite {
  test("parse returns valid sessionDirectories paths") {
    val json = ujson.Obj("sessionDirectories" -> ujson.Arr("examples", "more"))

    assert(SessionDirectoryParams.parse(json.obj) == Seq(Paths.get("examples"), Paths.get("more")))
  }

  test("parse drops empty, non-string, and invalid path entries") {
    val json = ujson.Obj("sessionDirectories" -> ujson.Arr("", 42, s"bad\u0000path", "examples"))

    assert(SessionDirectoryParams.parse(json.obj) == Seq(Paths.get("examples")))
  }

  test("parse returns empty when the field is absent or not an array") {
    assert(SessionDirectoryParams.parse(ujson.Obj().obj).isEmpty)
    assert(SessionDirectoryParams.parse(ujson.Obj("sessionDirectories" -> "examples").obj).isEmpty)
  }
}
