package dev.isabelle.vscode.server

import org.scalatest.funsuite.AnyFunSuite

final class CheckWithPideHandlerSpec extends AnyFunSuite {
  private def registry = new HeadlessSessionRegistry()

  test("returns pide-unavailable with reason text-missing when the document is not synced") {
    val docs = new DocumentStore(new LocalSyntaxPideBridge)
    val params = Some(ujson.Obj("uri" -> "file:///not/open.thy"))

    val json = CheckWithPideHandler.handle(
      params = params,
      documents = docs,
      registry = registry,
      env = Map.empty,
      platform = "Linux"
    ).obj

    assert(json("status").str == "pide-unavailable")
    assert(json("reason").str == "text-missing")
    assert(json("bridge").str == "local-syntax")
  }

  test("returns pide-unavailable with reason session-not-selected when no session is supplied") {
    val docs = new DocumentStore(new LocalSyntaxPideBridge)
    docs.open(uri = "file:///workspace/Demo.thy", text = "theory Demo\nbegin\nend\n", version = 1, session = None)
    val params = Some(ujson.Obj("uri" -> "file:///workspace/Demo.thy"))

    val json = CheckWithPideHandler.handle(
      params = params,
      documents = docs,
      registry = registry,
      env = Map.empty,
      platform = "Linux"
    ).obj

    assert(json("status").str == "pide-unavailable")
    assert(json("reason").str == "session-not-selected")
  }

  test("returns pide-unavailable with reason home-not-found when ISABELLE_HOME is absent and no exec path") {
    val docs = new DocumentStore(new LocalSyntaxPideBridge)
    docs.open(uri = "file:///workspace/Demo.thy", text = "theory Demo\nbegin\nend\n", version = 1, session = Some("HOL"))
    val params = Some(ujson.Obj("uri" -> "file:///workspace/Demo.thy", "session" -> "HOL"))

    val emptyFs = new FakeIsabelleHomeFs()
    val json = CheckWithPideHandler.handle(
      params = params,
      documents = docs,
      registry = registry,
      env = Map.empty,
      platform = "Linux",
      fs = emptyFs
    ).obj

    assert(json("status").str == "pide-unavailable")
    assert(json("reason").str == "home-not-found")
    assert(json("session").str == "HOL")
  }

  test("derives theoryName from the uri when params omit it") {
    val docs = new DocumentStore(new LocalSyntaxPideBridge)
    docs.open(uri = "file:///workspace/Smoke.thy", text = "theory Smoke\nbegin\nend\n", version = 1, session = Some("HOL"))
    val params = Some(ujson.Obj("uri" -> "file:///workspace/Smoke.thy", "session" -> "HOL"))

    val json = CheckWithPideHandler.handle(
      params = params,
      documents = docs,
      registry = registry,
      env = Map.empty,
      platform = "Linux",
      fs = new FakeIsabelleHomeFs()
    ).obj

    assert(json("theoryName").str == "Smoke")
  }

  test("falls back to Unknown when neither params nor uri provide a theory name") {
    val docs = new DocumentStore(new LocalSyntaxPideBridge)
    docs.open(uri = "", text = "theory Anon\nbegin\nend\n", version = 1, session = Some("HOL"))
    val params = Some(ujson.Obj("uri" -> "", "session" -> "HOL"))

    val json = CheckWithPideHandler.handle(
      params = params,
      documents = docs,
      registry = registry,
      env = Map.empty,
      platform = "Linux",
      fs = new FakeIsabelleHomeFs()
    ).obj

    assert(json("theoryName").str == "Unknown")
  }
}
