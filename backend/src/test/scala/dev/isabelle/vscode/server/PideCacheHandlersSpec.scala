package dev.isabelle.vscode.server

import org.scalatest.funsuite.AnyFunSuite

final class PideCacheHandlersSpec extends AnyFunSuite {
  private def registry: HeadlessSessionRegistry = new HeadlessSessionRegistry()

  test("warmup returns status=skipped reason=session-not-selected when params omit a session") {
    val json = PideCacheHandlers.warmup(
      params = None,
      registry = registry,
      env = Map.empty,
      platform = "Linux",
      fs = new FakeIsabelleHomeFs()
    ).obj
    assert(json("status").str == "skipped")
    assert(json("reason").str == "session-not-selected")
  }

  test("warmup returns status=skipped reason=home-not-found when Isabelle isn't resolvable") {
    val params = Some(ujson.Obj("session" -> "HOL"))
    val json = PideCacheHandlers.warmup(
      params = params,
      registry = registry,
      env = Map.empty,
      platform = "Linux",
      fs = new FakeIsabelleHomeFs()
    ).obj
    assert(json("status").str == "skipped")
    assert(json("reason").str == "home-not-found")
  }

  test("warmup returns status=failed reason=isabelle-jar-missing when classpath is incomplete") {
    val home = "/opt/Isabelle2025-2"
    val fs = new FakeIsabelleHomeFs(
      directories = Set(home),
      files = Set(s"$home/etc/ISABELLE_IDENTIFIER")
    )
    val params = Some(ujson.Obj("session" -> "HOL"))
    val json = PideCacheHandlers.warmup(
      params = params,
      registry = registry,
      env = Map("ISABELLE_HOME" -> home),
      platform = "Linux",
      fs = fs
    ).obj
    assert(json("status").str == "failed")
    assert(json("reason").str == "isabelle-jar-missing")
  }

  test("cacheState returns hasCachedFacade=false for an empty registry") {
    val r = registry
    val json = PideCacheHandlers.cacheState(r).obj
    assert(json("hasCachedFacade").bool == false)
    assert(json("hasInflightSubmission").bool == false)
    assert(!json.contains("fingerprint"))
  }

  test("invalidateCache reports invalidated=false when there was no cached facade") {
    val r = registry
    val json = PideCacheHandlers.invalidateCache(r).obj
    assert(json("invalidated").bool == false)
    assert(json("message").str == "No cached PIDE session to invalidate.")
  }
}
