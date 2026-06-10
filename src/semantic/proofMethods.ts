/**
 * Canonical Isabelle proof-method metadata.
 *
 * Proof methods are the vocabulary that follows `apply`, `by`, `proof`, and the
 * `...` of `unfolding ... by ...`. Unlike outer-syntax *commands* (handled by
 * `isabelleSyntax.ts`), methods live in the *inner* method language. This table
 * powers a hover that explains the method under the cursor — `simp`, `auto`,
 * `induct`, `metis`, and the rest — entirely offline, with no running prover.
 *
 * The set is the core HOL method vocabulary from the Isar reference and the
 * Simplifier / Classical-reasoner / Sledgehammer manuals; it is intentionally
 * curated to the methods a working proof author meets daily rather than an
 * exhaustive enumeration of every method any session might define. Descriptions
 * are one line, faithful to the manuals, and avoid claiming more than the method
 * does (e.g. `sorry`-like behaviour is never implied).
 *
 * This module is free of any `vscode` import so it can be unit-tested under
 * vitest; the thin hover wiring lives in `IsabelleHoverProvider.ts`.
 */

export type IsabelleMethodCategory =
  | "simplification"
  | "classical"
  | "automation"
  | "induction"
  | "rule"
  | "terminal"
  | "structural";

export interface IsabelleMethodInfo {
  readonly name: string;
  readonly description: string;
  readonly category: IsabelleMethodCategory;
}

const METHODS: IsabelleMethodInfo[] = [
  // ── Simplification ──────────────────────────────────────────────────────
  { name: "simp", description: "Simplifies the goal with the Simplifier and the default simp set.", category: "simplification" },
  { name: "simp_all", description: "Applies the Simplifier to all subgoals.", category: "simplification" },
  { name: "unfold", description: "Rewrites the goal by unfolding the given definitions (left to right).", category: "simplification" },
  { name: "fold", description: "Rewrites the goal by folding the given equations (right to left).", category: "simplification" },
  // ── Classical reasoning ─────────────────────────────────────────────────
  { name: "blast", description: "Classical tableau prover; fast for predicate-logic goals (no rewriting).", category: "classical" },
  { name: "fast", description: "Classical depth-first reasoner; succeeds where blast's search shape does not.", category: "classical" },
  { name: "slow", description: "Like fast but with a more thorough, slower search.", category: "classical" },
  { name: "best", description: "Classical best-first reasoner guided by goal size.", category: "classical" },
  { name: "deepen", description: "Classical iterative-deepening reasoner.", category: "classical" },
  { name: "clarify", description: "Applies safe classical rules without splitting the goal.", category: "classical" },
  { name: "safe", description: "Applies all safe classical rules, possibly splitting into subgoals.", category: "classical" },
  // ── Combined automation ─────────────────────────────────────────────────
  { name: "auto", description: "Combines simplification and classical reasoning on all subgoals.", category: "automation" },
  { name: "force", description: "Aggressively proves a single goal with simp + classical reasoning.", category: "automation" },
  { name: "fastforce", description: "force-strength reasoning tuned to be faster; proves one goal.", category: "automation" },
  { name: "clarsimp", description: "Interleaves clarify and the Simplifier without splitting goals.", category: "automation" },
  { name: "bestsimp", description: "Best-first classical search combined with simplification.", category: "automation" },
  // ── Arithmetic & decision procedures ────────────────────────────────────
  { name: "arith", description: "Decision procedure for linear arithmetic over the goal.", category: "automation" },
  { name: "presburger", description: "Decision procedure for Presburger (linear integer) arithmetic.", category: "automation" },
  { name: "linarith", description: "Proves linear arithmetic goals over ordered fields.", category: "automation" },
  { name: "algebra", description: "Proves goals in commutative rings via Gröbner-basis reasoning.", category: "automation" },
  // ── Resolution / rule application ───────────────────────────────────────
  { name: "rule", description: "Applies a single introduction/elimination rule by higher-order unification.", category: "rule" },
  { name: "rule_tac", description: "Like rule, with explicit instantiation of rule variables.", category: "rule" },
  { name: "erule", description: "Applies an elimination rule to the goal and a premise.", category: "rule" },
  { name: "drule", description: "Applies a destruction rule, replacing a premise with its consequences.", category: "rule" },
  { name: "frule", description: "Like drule but keeps the original premise as well.", category: "rule" },
  { name: "intro", description: "Repeatedly applies the given introduction rules.", category: "rule" },
  { name: "elim", description: "Repeatedly applies the given elimination rules.", category: "rule" },
  { name: "rules", description: "Applies the given rules as intro/elim steps.", category: "rule" },
  { name: "subst", description: "Rewrites the goal once using an equation as a substitution.", category: "rule" },
  { name: "unfold_locales", description: "Discharges a locale's assumptions to establish an interpretation.", category: "rule" },
  // ── Induction & case analysis ───────────────────────────────────────────
  { name: "induct", description: "Performs structural / rule induction on the given variables or rule.", category: "induction" },
  { name: "induction", description: "Like induct, but names the cases and emphasises Isar-style proofs.", category: "induction" },
  { name: "induct_tac", description: "Tactic-style structural induction on a variable.", category: "induction" },
  { name: "coinduct", description: "Performs coinduction on the given goal.", category: "induction" },
  { name: "cases", description: "Case analysis on a term, datatype, or rule.", category: "induction" },
  { name: "case_tac", description: "Tactic-style case analysis on a term.", category: "induction" },
  // ── Terminal / closing methods ──────────────────────────────────────────
  { name: "metis", description: "Resolution prover that proves the goal from the given facts (used by Sledgehammer).", category: "terminal" },
  { name: "meson", description: "Model-elimination prover for first-order goals.", category: "terminal" },
  { name: "smt", description: "Discharges the goal via an external SMT solver (e.g. Z3, cvc5).", category: "terminal" },
  { name: "assumption", description: "Closes the goal by matching it against one of its premises.", category: "terminal" },
  { name: "this", description: "Proves the goal using exactly the currently chained facts.", category: "terminal" },
  { name: "fact", description: "Proves the goal by matching it against a single given fact.", category: "terminal" },
  { name: "sledgehammer", description: "Proof-method form of Sledgehammer's reconstructed proof.", category: "terminal" },
  // ── Structural / control methods ────────────────────────────────────────
  { name: "standard", description: "Applies the standard introduction rule(s) to start a structured proof.", category: "structural" },
  { name: "rule_format", description: "Normalises object-level rules into the meta-logic.", category: "structural" },
  { name: "succeed", description: "Identity method: succeeds without changing the goal.", category: "structural" },
  { name: "fail", description: "Always fails; useful for testing method combinators.", category: "structural" },
  { name: "-", description: "Null method: defers the goal to the structured Isar proof body.", category: "structural" },
  { name: "tactic", description: "Runs a raw Isabelle/ML tactic against the goal.", category: "structural" },
  { name: "raw_tactic", description: "Runs a raw ML tactic with no goal preprocessing.", category: "structural" }
];

const BY_NAME = new Map<string, IsabelleMethodInfo>();
for (const method of METHODS) {
  // The source list has unique names; the guard is a defensive safety net so a
  // future duplicate keeps its first (canonical) definition rather than the
  // last silently overwriting it.
  if (!BY_NAME.has(method.name)) {
    BY_NAME.set(method.name, method);
  }
}

/** Every known proof method keyed by name. */
export const ISABELLE_METHODS: ReadonlyMap<string, IsabelleMethodInfo> = BY_NAME;

/** Look up a proof method by its exact name (e.g. `simp`, `auto`, `induct`). */
export function getMethodInfo(name: string): IsabelleMethodInfo | undefined {
  return BY_NAME.get(name);
}

/** Whether `name` is a known Isabelle proof method. */
export function isProofMethod(name: string): boolean {
  return BY_NAME.has(name);
}

const CATEGORY_LABELS: Record<IsabelleMethodCategory, string> = {
  simplification: "simplification method",
  classical: "classical reasoning method",
  automation: "automated method",
  induction: "induction / case-analysis method",
  rule: "rule-application method",
  terminal: "terminal proof method",
  structural: "structural method"
};

/**
 * Build a Markdown hover description for a proof method: the method name, a
 * role label derived from its category, and the one-line description.
 */
export function buildMethodHoverMarkdown(method: IsabelleMethodInfo): string {
  return [`**Isabelle proof method** \`${method.name}\` — ${CATEGORY_LABELS[method.category]}`, "", method.description].join("\n");
}

// Outer-syntax keywords that introduce a method language fragment. A word is in
// "method position" when one of these precedes it on the line (the method
// follows `apply`, `by`, `proof`, or an `unfolding`/`using ... by` chain).
const METHOD_INTRODUCERS: ReadonlySet<string> = new Set([
  "apply",
  "apply_end",
  "by",
  "proof",
  "unfolding",
  "supply"
]);

const LEADING_WORD = /[A-Za-z_][A-Za-z0-9_']*/g;

/**
 * Heuristic: is the word starting at UTF-16 offset `wordStart` in `lineText` in
 * *method position* — i.e. does a method-introducing keyword (`apply`, `by`,
 * `proof`, `unfolding`, …) occur earlier on the same line?
 *
 * This is deliberately conservative and line-local: it exists only to gate the
 * proof-method hover so a bare identifier such as `rule` or `cases` appearing
 * in a term is not described as a proof method. It does not attempt to parse
 * the inner method grammar. A method word that is *itself* an introducer
 * (`by simp` — `simp` follows `by`) is in context; the introducer word itself
 * is not (it is an outer-syntax command, handled separately).
 */
export function isMethodPosition(lineText: string, wordStart: number): boolean {
  LEADING_WORD.lastIndex = 0;
  let match: RegExpExecArray | null;
  let sawIntroducer = false;
  while ((match = LEADING_WORD.exec(lineText)) !== null) {
    if (match.index >= wordStart) {
      break;
    }
    if (METHOD_INTRODUCERS.has(match[0])) {
      sawIntroducer = true;
    }
  }
  return sawIntroducer;
}
