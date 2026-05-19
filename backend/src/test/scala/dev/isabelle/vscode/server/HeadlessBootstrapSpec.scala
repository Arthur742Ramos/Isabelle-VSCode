package dev.isabelle.vscode.server

import java.nio.file.{Files, Paths}
import org.scalatest.funsuite.AnyFunSuite

final class HeadlessBootstrapSpec extends AnyFunSuite {
  test("deriveCygwinRoot returns the contrib/cygwin path on Windows") {
    val tmp = Files.createTempDirectory("headless-bootstrap-spec-")
    try {
      val cygwin = tmp.resolve("contrib").resolve("cygwin")
      Files.createDirectories(cygwin)
      val derived = HeadlessBootstrap.deriveCygwinRoot(tmp, "Windows 11")
      assert(derived == cygwin.toString)
    } finally ScratchTheoryStore.deleteRecursively(tmp)
  }

  test("deriveCygwinRoot returns empty string on POSIX") {
    val tmp = Files.createTempDirectory("headless-bootstrap-spec-")
    try {
      assert(HeadlessBootstrap.deriveCygwinRoot(tmp, "Linux") == "")
      assert(HeadlessBootstrap.deriveCygwinRoot(tmp, "Mac OS X") == "")
    } finally ScratchTheoryStore.deleteRecursively(tmp)
  }

  test("deriveCygwinRoot returns empty string on Windows when contrib/cygwin is absent") {
    val tmp = Files.createTempDirectory("headless-bootstrap-spec-")
    try {
      assert(HeadlessBootstrap.deriveCygwinRoot(tmp, "Windows 11") == "")
    } finally ScratchTheoryStore.deleteRecursively(tmp)
  }

  test("bootstrap reports BootstrapFailure(environment-init) when classes are not loadable") {
    val tmp = Files.createTempDirectory("headless-bootstrap-spec-")
    try {
      val loader = new java.net.URLClassLoader(Array.empty[java.net.URL], getClass.getClassLoader)
      val result = HeadlessBootstrap.bootstrap(loader, tmp, "", "HOL")
      assert(result.isInstanceOf[HeadlessBootstrap.BootstrapFailure])
      val failure = result.asInstanceOf[HeadlessBootstrap.BootstrapFailure]
      assert(failure.step == "environment-init")
      assert(failure.reason.nonEmpty)
    } finally ScratchTheoryStore.deleteRecursively(tmp)
  }

  test("stopSession is a no-op on a null session reference") {
    val result = HeadlessBootstrap.stopSession(null)
    assert(result.isRight)
  }
}
