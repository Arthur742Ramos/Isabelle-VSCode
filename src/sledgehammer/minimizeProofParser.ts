// Phase 5: pure parser that extracts a proof method and the fact list
// from an Isabelle proof body. The TS-side `Isabelle: Minimize
// Sledgehammer Proof at Cursor` command uses this to convert a line
// like `by (metis foo bar baz)` into `{ method: "metis", facts: ["foo",
// "bar", "baz"] }` so the backend can re-run Sledgehammer with `onlyFacts`
// and `minimize=true` to find a smaller equivalent.
//
// Pure / vscode-free / no I/O. Tested under
// `test/sledgehammer/minimizeProofParser.test.ts`.

export interface ParsedProofBody {
  method: string;
  facts: string[];
  /** The trailing `using fact1 fact2` clause (often present before `by`). */
  usingFacts: string[];
}

/**
 * Parse an Isabelle proof line of the form:
 *
 *   using fact1 fact2 by (metis fact3 fact4)
 *   using assms by metis
 *   by (metis foo bar baz)
 *   by metis
 *   apply (metis foo)
 *
 * Returns `null` if the line doesn't look like one of these forms.
 */
export function parseProofBody(text: string): ParsedProofBody | null {
  if (!text || typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  // Capture the optional `using <facts>` prefix.
  const usingMatch = /^using\s+([^)]*?)\s+(?=by|apply)/i.exec(trimmed);
  const usingFacts = usingMatch ? splitFactList(usingMatch[1]) : [];
  const rest = usingMatch ? trimmed.slice(usingMatch[0].length).trim() : trimmed;

  // `by (method fact1 fact2)` or `by method` or `apply (method ...)` or
  // `apply method`. The method body must be Isabelle-tactic-like.
  const parenMatch = /^(?:by|apply)\s*\(\s*([a-zA-Z_][\w]*)\s*([^)]*)\)\s*$/.exec(rest);
  if (parenMatch) {
    return {
      method: parenMatch[1],
      facts: splitFactList(parenMatch[2]),
      usingFacts
    };
  }
  const bareMatch = /^(?:by|apply)\s+([a-zA-Z_][\w]*)\s*$/.exec(rest);
  if (bareMatch) {
    return {
      method: bareMatch[1],
      facts: [],
      usingFacts
    };
  }
  return null;
}

/**
 * Split an Isabelle fact list, respecting that fact names with
 * subscripts/brackets stay together. For Phase 5 we keep this very
 * simple — whitespace-separated, drop empties, drop common trailing
 * punctuation. Quoted fact names are preserved as-is.
 */
function splitFactList(raw: string): string[] {
  if (!raw) return [];
  // First pass: tokenize handling quoted strings.
  const tokens: string[] = [];
  let i = 0;
  let buf = "";
  while (i < raw.length) {
    const c = raw[i];
    if (c === '"') {
      // Capture quoted string verbatim.
      let j = i + 1;
      while (j < raw.length && raw[j] !== '"') j++;
      tokens.push(raw.slice(i + 1, j));
      i = j + 1;
      continue;
    }
    if (/\s/.test(c)) {
      if (buf) { tokens.push(buf); buf = ""; }
      i++;
      continue;
    }
    buf += c;
    i++;
  }
  if (buf) tokens.push(buf);
  return tokens.map(t => t.trim()).filter(t => t.length > 0);
}
