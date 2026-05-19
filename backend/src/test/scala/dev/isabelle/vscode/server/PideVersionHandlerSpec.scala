package dev.isabelle.vscode.server

import java.net.{URL, URLClassLoader}
import org.scalatest.funsuite.AnyFunSuite

final class PideVersionHandlerSpec extends AnyFunSuite {
  private val noopLoaderFactory: IsabelleClassLoaderFactory =
    (_: Seq[URL], parent: ClassLoader) => new URLClassLoader(Array.empty[URL], parent)

  test("returns home-not-found JSON when nothing resolves and no params are given") {
    val fs = new FakeIsabelleHomeFs()

    val json = PideVersionHandler.handle(
      params = None,
      env = Map.empty,
      platform = "Linux",
      fs = fs,
      loaderFactory = noopLoaderFactory
    ).obj

    assert(json("bridge").str == PideRuntimeStatus.LocalSyntax)
    assert(json("reason").str == PideRuntimeStatus.ReasonHomeNotFound)
    assert(json("version").str == "")
    assert(json("classloaderReady").bool == false)
  }

  test("threads the isabelleExecutablePath param through to the resolver") {
    val home = "/opt/Isabelle2025-2"
    val exe = s"$home/bin/isabelle"
    val fs = new FakeIsabelleHomeFs(
      directories = Set(home, s"$home/bin"),
      files = Set(s"$home/etc/ISABELLE_IDENTIFIER", exe)
    )

    val params = Some(ujson.Obj("isabelleExecutablePath" -> exe))
    val json = PideVersionHandler.handle(
      params = params,
      env = Map.empty,
      platform = "Linux",
      fs = fs,
      loaderFactory = noopLoaderFactory
    ).obj

    // Resolver finds the home; classpath build fails because no isabelle.jar in fake fs.
    assert(json("isabelleHome").str.replace('\\', '/') == home)
    assert(json("reason").str == PideRuntimeStatus.ReasonIsabelleJarMissing)
  }

  test("treats an empty isabelleExecutablePath as not supplied") {
    val fs = new FakeIsabelleHomeFs()

    val params = Some(ujson.Obj("isabelleExecutablePath" -> ""))
    val json = PideVersionHandler.handle(
      params = params,
      env = Map.empty,
      platform = "Linux",
      fs = fs,
      loaderFactory = noopLoaderFactory
    ).obj

    assert(json("reason").str == PideRuntimeStatus.ReasonHomeNotFound)
  }

  test("returns home-not-found JSON for malformed params (not an object)") {
    val fs = new FakeIsabelleHomeFs()

    val params = Some(ujson.Arr("oops"))
    val json = PideVersionHandler.handle(
      params = params,
      env = Map.empty,
      platform = "Linux",
      fs = fs,
      loaderFactory = noopLoaderFactory
    ).obj

    assert(json("reason").str == PideRuntimeStatus.ReasonHomeNotFound)
  }
}
