package dev.isabelle.vscode.server

import org.scalatest.funsuite.AnyFunSuite

/**
 * Verifies the [[ScalaIsabellePideBridge]] scaffold behavior. These
 * tests do not require Isabelle to be installed: the bridge is in its
 * `Unavailable` state by construction and delegates to the supplied
 * fallback for the document-result shape.
 */
final class ScalaIsabellePideBridgeSpec extends AnyFunSuite {

  private val config = ScalaIsabelleConfig(
    isabelleHome = "/opt/Isabelle2024",
    userDir = None,
    sessionName = None,
    logicSession = None,
    workingDirectory = None
  )

  private val document = TheoryDocument(
    uri = "file:///workspace/Demo.thy",
    text = "theory Demo\nimports Main\nbegin\nlemma demo: \"True\" by simp\nend\n",
    version = 1,
    session = Some("HOL")
  )

  test("starts in an Unavailable state with a scaffold-specific reason") {
    val bridge = new ScalaIsabellePideBridge(config, new LocalSyntaxPideBridge)
    bridge.stateSnapshot match {
      case ScalaIsabelleBridgeState.Unavailable(reason) =>
        assert(reason.contains("ScalaIsabellePideBridge"))
        assert(reason.contains("docs/PIDE_INTEGRATION.md"))
      case other =>
        fail(s"Expected Unavailable state, got $other")
    }
  }

  test("documentResult mirrors the fallback shape exactly") {
    val fallback = new LocalSyntaxPideBridge
    val bridge = new ScalaIsabellePideBridge(config, fallback)
    val expected = fallback.documentResult(document)
    val actual = bridge.documentResult(document)
    assert(actual == expected, "documentResult must not diverge from the fallback shape")
  }

  test("proofState preserves the fallback shape but overrides message") {
    val fallback = new LocalSyntaxPideBridge
    val bridge = new ScalaIsabellePideBridge(config, fallback)
    val baseline = fallback.proofState(document, line = 3, character = 0)
    val result = bridge.proofState(document, line = 3, character = 0).obj

    assert(result("status").str == "unavailable")
    assert(result("uri").str == document.uri)
    assert(result("version").num.toInt == document.version)
    assert(result.contains("command"))
    assert(result.contains("context"))
    assert(result.contains("goals"))
    assert(result.contains("raw"))

    val message = result("message").str
    assert(message.contains("ScalaIsabellePideBridge stub"))
    assert(message.contains("docs/PIDE_INTEGRATION.md"))

    val baselineKeys = baseline.obj.keys.toSet
    val resultKeys = result.keys.toSet
    assert(
      baselineKeys.subsetOf(resultKeys),
      s"Stub dropped fallback keys: ${baselineKeys -- resultKeys}"
    )
  }

  test("sledgehammer preserves the fallback shape but overrides message") {
    val fallback = new LocalSyntaxPideBridge
    val bridge = new ScalaIsabellePideBridge(config, fallback)
    val request = SledgehammerRequest(
      requestId = "req-1",
      document = document,
      line = 3,
      character = 0,
      session = Some("HOL"),
      isabelleExecutablePath = Some("isabelle")
    )
    val baseline = fallback.sledgehammer(request)
    val result = bridge.sledgehammer(request).obj

    assert(result("status").str == "unavailable")
    assert(result("requestId").str == "req-1")
    assert(result("uri").str == document.uri)
    assert(result("suggestions").arr.isEmpty)

    val message = result("message").str
    assert(message.contains("ScalaIsabellePideBridge stub"))
    assert(message.contains("Sledgehammer"))

    val baselineKeys = baseline.obj.keys.toSet
    val resultKeys = result.keys.toSet
    assert(
      baselineKeys.subsetOf(resultKeys),
      s"Stub dropped fallback keys: ${baselineKeys -- resultKeys}"
    )
  }
}
