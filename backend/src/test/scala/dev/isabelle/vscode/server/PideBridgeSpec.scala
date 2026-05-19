package dev.isabelle.vscode.server

import org.scalatest.funsuite.AnyFunSuite

final class PideBridgeSpec extends AnyFunSuite {
  test("LocalSyntaxPideBridge.isabelleVersion returns the empty string") {
    val bridge = new LocalSyntaxPideBridge

    assert(bridge.isabelleVersion() == "")
  }

  test("PideEnabledBridge.isabelleVersion returns the version supplied at construction") {
    val bridge = new PideEnabledBridge("Isabelle2025-2")

    assert(bridge.isabelleVersion() == "Isabelle2025-2")
  }

  test("PideEnabledBridge.documentResult delegates to the local-syntax bridge") {
    val bridge = new PideEnabledBridge("Isabelle2025-2")
    val document = TheoryDocument(
      uri = "file:///workspace/Demo.thy",
      text = "theory Demo\nimports Main\nbegin\nend\n",
      version = 1,
      session = None
    )

    val json = bridge.documentResult(document).obj

    assert(json("uri").str == "file:///workspace/Demo.thy")
    assert(json("version").num == 1)
    val commandKinds = json("commandSpans").arr.map(span => span.obj("kind").str)
    assert(commandKinds == Seq("theory", "imports", "begin", "end"))
  }

  test("PideEnabledBridge.proofState delegates to the local-syntax bridge") {
    val bridge = new PideEnabledBridge("Isabelle2025-2")
    val document = TheoryDocument(
      uri = "file:///workspace/Demo.thy",
      text = "theory Demo\nimports Main\nbegin\nend\n",
      version = 1,
      session = None
    )

    val json = bridge.proofState(document, 0, 0).obj

    assert(json("status").str == "unavailable")
  }
}
