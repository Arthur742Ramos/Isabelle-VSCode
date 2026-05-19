package dev.isabelle.vscode.server

import org.scalatest.funsuite.AnyFunSuite

final class SledgehammerWithPideHandlerSpec extends AnyFunSuite {

  test("returns unavailable text-missing when document not synced") {
    val docs = new DocumentStore(new LocalSyntaxPideBridge)
    val registry = new HeadlessSessionRegistry()
    val cache = new SnapshotCache()
    val params = Some(ujson.Obj(
      "requestId" -> "r1",
      "uri" -> "file:///not-open.thy",
      "session" -> "HOL",
      "position" -> ujson.Obj("line" -> 0, "character" -> 0)
    ))

    val json = SledgehammerWithPideHandler.handle(
      params = params,
      documents = docs,
      registry = registry,
      snapshotCache = cache,
      env = Map.empty,
      platform = "Linux"
    ).obj

    assert(json("status").str == "unavailable")
    assert(json("reason").str == "text-missing")
    assert(json("requestId").str == "r1")
    assert(json("suggestions").arr.isEmpty)
  }

  test("returns session-not-selected when session is omitted") {
    val docs = new DocumentStore(new LocalSyntaxPideBridge)
    docs.open(uri = "file:///a.thy", text = "theory A\nbegin\nend\n", version = 1, session = None)
    val registry = new HeadlessSessionRegistry()
    val cache = new SnapshotCache()
    val params = Some(ujson.Obj(
      "requestId" -> "r2",
      "uri" -> "file:///a.thy",
      "position" -> ujson.Obj("line" -> 0, "character" -> 0)
    ))

    val json = SledgehammerWithPideHandler.handle(
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

  test("returns home-not-found when ISABELLE_HOME absent") {
    val docs = new DocumentStore(new LocalSyntaxPideBridge)
    docs.open(uri = "file:///a.thy", text = "theory A\nbegin\nend\n", version = 1, session = Some("HOL"))
    val registry = new HeadlessSessionRegistry()
    val cache = new SnapshotCache()
    val params = Some(ujson.Obj(
      "requestId" -> "r3",
      "uri" -> "file:///a.thy",
      "session" -> "HOL",
      "position" -> ujson.Obj("line" -> 0, "character" -> 0)
    ))

    val json = SledgehammerWithPideHandler.handle(
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

  test("preserves the supplied requestId across all unavailable paths") {
    val docs = new DocumentStore(new LocalSyntaxPideBridge)
    val registry = new HeadlessSessionRegistry()
    val cache = new SnapshotCache()
    val params = Some(ujson.Obj(
      "requestId" -> "abcdef-1234",
      "uri" -> "file:///never-opened.thy",
      "session" -> "HOL",
      "position" -> ujson.Obj("line" -> 0, "character" -> 0)
    ))

    val json = SledgehammerWithPideHandler.handle(
      params = params,
      documents = docs,
      registry = registry,
      snapshotCache = cache,
      env = Map.empty,
      platform = "Linux"
    ).obj

    assert(json("requestId").str == "abcdef-1234")
  }
}
