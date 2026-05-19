package dev.isabelle.vscode.server

import java.lang.reflect.Method
import scala.util.control.NonFatal

/**
 * Reflective wrapper around Isabelle's `isabelle.Symbol` translation
 * table. Editor text uses Unicode (`λ`, `∀`, `⟹`, …); Isabelle's
 * parser uses backslash-escaped names (`\<lambda>`, `\<forall>`,
 * `\<Longrightarrow>`). The PIDE bridge MUST round-trip in both
 * directions or `use_theories` would emit "undefined symbol" errors
 * for every Unicode glyph.
 *
 * - [[encode]] : Unicode → backslash form (call before staging theory
 *   text to disk for `use_theories`).
 * - [[decode]] : backslash → Unicode (call when rendering errors /
 *   command names back to the editor).
 *
 * Both calls are pure and use a cached `Method` reference so per-call
 * overhead is a single JNI hop. Throws nothing — on reflective
 * failure, returns the input string unchanged and surfaces the
 * failure via the returned [[Either]].
 */
final class SymbolTranslator private (
  encodeMethod: Method,
  decodeMethod: Method,
  symbolModule: AnyRef,
  identity: Boolean = false
) {
  def encode(unicode: String): String =
    if (identity) unicode
    else
      try encodeMethod.invoke(symbolModule, unicode).asInstanceOf[String]
      catch { case _: Throwable => unicode }

  def decode(backslashed: String): String =
    if (identity) backslashed
    else
      try decodeMethod.invoke(symbolModule, backslashed).asInstanceOf[String]
      catch { case _: Throwable => backslashed }
}

object SymbolTranslator {
  /**
   * Load the translator reflectively from the supplied classloader.
   * Returns `Left(reason)` if `isabelle.Symbol$` is not on the
   * classpath OR if its `encode`/`decode` methods cannot be resolved
   * — callers must treat that as "PIDE bridge unavailable, fall back
   * to local-syntax" rather than as a hard error.
   *
   * Catches `Throwable` (not just `NonFatal`) because Isabelle's
   * static initializers throw `LinkageError` subclasses that NonFatal
   * does NOT cover (see AGENTS.md §12).
   */
  def load(loader: ClassLoader): Either[String, SymbolTranslator] = {
    try {
      val cls = Class.forName("isabelle.Symbol$", true, loader)
      val module = cls.getField("MODULE$").get(null)

      val encodeMethod = cls.getMethods.find(m =>
        m.getName == "encode" && m.getParameterCount == 1 && m.getParameterTypes()(0) == classOf[String]
      ).getOrElse(return Left("isabelle.Symbol.encode(String) not found"))

      val decodeMethod = cls.getMethods.find(m =>
        m.getName == "decode" && m.getParameterCount == 1 && m.getParameterTypes()(0) == classOf[String]
      ).getOrElse(return Left("isabelle.Symbol.decode(String) not found"))

      Right(new SymbolTranslator(encodeMethod, decodeMethod, module))
    } catch {
      case t: Throwable =>
        val cause = Option(t.getCause).map(c => s" (cause: ${c.getClass.getSimpleName})").getOrElse("")
        Left(s"${t.getClass.getSimpleName}: ${Option(t.getMessage).getOrElse("")}$cause")
    }
  }

  /** Identity translator used by tests and by code paths that have no
    * loader yet — input == output for both directions. */
  val Identity: SymbolTranslator = new SymbolTranslator(null, null, null, identity = true)
}
