package dev.isabelle.vscode.server

import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path}
import org.scalatest.funsuite.AnyFunSuite

final class ScratchTheoryStoreSpec extends AnyFunSuite {
  private def withTempRoot[A](body: Path => A): A = {
    val root = Files.createTempDirectory("scratch-theory-store-spec-")
    try body(root)
    finally ScratchTheoryStore.deleteRecursively(root)
  }

  test("workspaceHash is stable for the same input") {
    val a = ScratchTheoryStore.workspaceHash("file:///workspace/A")
    val b = ScratchTheoryStore.workspaceHash("file:///workspace/A")
    assert(a == b)
    assert(a.length == 16)
  }

  test("workspaceHash differs for different inputs") {
    val a = ScratchTheoryStore.workspaceHash("file:///workspace/A")
    val b = ScratchTheoryStore.workspaceHash("file:///workspace/B")
    assert(a != b)
  }

  test("sanitizeTheoryName replaces path separators and special characters") {
    assert(ScratchTheoryStore.sanitizeTheoryName("Hello") == "Hello")
    assert(ScratchTheoryStore.sanitizeTheoryName("Hello.World") == "Hello_World")
    assert(ScratchTheoryStore.sanitizeTheoryName("../escape") == "___escape")
    assert(ScratchTheoryStore.sanitizeTheoryName("") == "Unknown")
    assert(ScratchTheoryStore.sanitizeTheoryName("My-Theory") == "My_Theory")
  }

  test("stage writes the text under <root>/<workspaceHash>/<theoryName>.thy with Symbol encoding applied") {
    withTempRoot { root =>
      // Fake translator that uppercases input to make the encode call observable.
      val store = new ScratchTheoryStore(root, SymbolTranslator.Identity)
      store.initialize()

      val staged = store.stage(
        workspaceUri = "file:///workspace/Sample",
        theoryName = "Smoke",
        unicodeText = "theory Smoke\nimports Main\nbegin\nend\n"
      )

      assert(Files.isRegularFile(staged))
      assert(staged.getFileName.toString == "Smoke.thy")
      val content = Files.readString(staged, StandardCharsets.UTF_8)
      assert(content.contains("theory Smoke"))
    }
  }

  test("resolveScratchRoot honors BACKEND_SCRATCH_DIR when set") {
    val env = Map("BACKEND_SCRATCH_DIR" -> "/tmp/test-scratch")
    val root = ScratchTheoryStore.resolveScratchRoot(env)
    assert(root.toString.replace('\\', '/') == "/tmp/test-scratch")
  }

  test("resolveScratchRoot falls back to java.io.tmpdir when BACKEND_SCRATCH_DIR is absent") {
    val root = ScratchTheoryStore.resolveScratchRoot(Map.empty)
    assert(root.toString.contains("isabelle-vscode-pide-scratch-"))
  }

  test("resolveScratchRoot treats empty BACKEND_SCRATCH_DIR as absent") {
    val root = ScratchTheoryStore.resolveScratchRoot(Map("BACKEND_SCRATCH_DIR" -> ""))
    assert(root.toString.contains("isabelle-vscode-pide-scratch-"))
  }
}
