package dev.isabelle.vscode.server

import org.scalatest.funsuite.AnyFunSuite

final class SymbolTranslatorSpec extends AnyFunSuite {
  test("Identity translator returns inputs unchanged in both directions") {
    val t = SymbolTranslator.Identity

    assert(t.encode("λx. x") == "λx. x")
    assert(t.decode("\\<lambda>x. x") == "\\<lambda>x. x")
    assert(t.encode("") == "")
    assert(t.decode("") == "")
  }

  test("load returns Left for a classloader that does not have isabelle.Symbol") {
    val result = SymbolTranslator.load(getClass.getClassLoader)
    assert(result.isLeft)
    val reason = result.swap.toOption.get
    // ClassNotFoundException or similar — verify it's a graceful error, not a thrown exception.
    assert(reason.nonEmpty)
  }
}
