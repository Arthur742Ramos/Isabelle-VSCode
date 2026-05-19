package dev.isabelle.vscode.server

import org.scalatest.funsuite.AnyFunSuite

final class ProofStateWithPideHandlerSpec extends AnyFunSuite {

  test("returns unavailable with reason text-missing when the document is not synced") {
    val docs = new DocumentStore(new LocalSyntaxPideBridge)
    val registry = new HeadlessSessionRegistry()
    val cache = new SnapshotCache()
    val params = Some(ujson.Obj(
      "uri" -> "file:///not-open.thy",
      "session" -> "HOL",
      "position" -> ujson.Obj("line" -> 0, "character" -> 0)
    ))

    val json = ProofStateWithPideHandler.handle(
      params = params,
      documents = docs,
      registry = registry,
      snapshotCache = cache,
      env = Map.empty,
      platform = "Linux"
    ).obj

    assert(json("status").str == "unavailable")
    assert(json("reason").str == "text-missing")
    assert(json("bridge").str == "local-syntax")
  }

  test("returns unavailable with reason session-not-selected when session is omitted") {
    val docs = new DocumentStore(new LocalSyntaxPideBridge)
    docs.open(uri = "file:///a.thy", text = "theory A\nbegin\nend\n", version = 1, session = None)
    val registry = new HeadlessSessionRegistry()
    val cache = new SnapshotCache()
    val params = Some(ujson.Obj(
      "uri" -> "file:///a.thy",
      "position" -> ujson.Obj("line" -> 0, "character" -> 0)
    ))

    val json = ProofStateWithPideHandler.handle(
      params = params,
      documents = docs,
      registry = registry,
      snapshotCache = cache,
      env = Map.empty,
      platform = "Linux"
    ).obj

    assert(json("status").str == "unavailable")
    assert(json("reason").str == "session-not-selected")
  }

  test("returns unavailable with reason home-not-found when ISABELLE_HOME is absent") {
    val docs = new DocumentStore(new LocalSyntaxPideBridge)
    docs.open(uri = "file:///a.thy", text = "theory A\nbegin\nend\n", version = 1, session = Some("HOL"))
    val registry = new HeadlessSessionRegistry()
    val cache = new SnapshotCache()
    val params = Some(ujson.Obj(
      "uri" -> "file:///a.thy",
      "session" -> "HOL",
      "position" -> ujson.Obj("line" -> 0, "character" -> 0)
    ))

    val json = ProofStateWithPideHandler.handle(
      params = params,
      documents = docs,
      registry = registry,
      snapshotCache = cache,
      env = Map.empty,
      platform = "Linux",
      fs = new FakeIsabelleHomeFs()
    ).obj

    assert(json("status").str == "unavailable")
    assert(json("reason").str == "home-not-found")
  }

  test("derives theoryName from uri when omitted") {
    val docs = new DocumentStore(new LocalSyntaxPideBridge)
    docs.open(uri = "file:///workspace/Foo.thy", text = "theory Foo\nbegin\nend\n", version = 1, session = Some("HOL"))
    val registry = new HeadlessSessionRegistry()
    val cache = new SnapshotCache()
    val params = Some(ujson.Obj(
      "uri" -> "file:///workspace/Foo.thy",
      "session" -> "HOL",
      "position" -> ujson.Obj("line" -> 1, "character" -> 0)
    ))

    val json = ProofStateWithPideHandler.handle(
      params = params,
      documents = docs,
      registry = registry,
      snapshotCache = cache,
      env = Map.empty,
      platform = "Linux",
      fs = new FakeIsabelleHomeFs()
    ).obj

    // home-not-found path; just verify the derivation chain didn't crash.
    assert(json("status").str == "unavailable")
  }
}
