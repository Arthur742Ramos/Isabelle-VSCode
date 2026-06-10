export interface IsabelleCommandInfo {
  keyword: string;
  description: string;
  category: IsabelleCommandCategory;
  declaresName?: boolean;
}

export type IsabelleCommandCategory =
  | "theory"
  | "declaration"
  | "statement"
  | "proof"
  | "proofTerminal"
  | "context"
  | "diagnostic"
  | "ml";

export interface IsabelleSymbolInfo {
  name: string;
  glyph: string;
  description: string;
}

const COMMANDS: IsabelleCommandInfo[] = [
  // ── Theory header & structure ───────────────────────────────────────────
  { keyword: "theory", description: "Starts a theory declaration.", category: "theory" },
  { keyword: "imports", description: "Declares imported theories.", category: "theory" },
  { keyword: "keywords", description: "Declares outer-syntax keywords for the theory.", category: "theory" },
  { keyword: "abbrevs", description: "Declares theory-local syntax abbreviations.", category: "theory" },
  { keyword: "begin", description: "Starts the body of a theory, locale, or context.", category: "theory" },
  { keyword: "end", description: "Closes the current theory or context.", category: "theory" },
  // ── Document markup ─────────────────────────────────────────────────────
  { keyword: "chapter", description: "Starts a document chapter.", category: "theory" },
  { keyword: "section", description: "Starts a document section.", category: "theory" },
  { keyword: "subsection", description: "Starts a document subsection.", category: "theory" },
  { keyword: "subsubsection", description: "Starts a document subsubsection.", category: "theory" },
  { keyword: "paragraph", description: "Starts a document paragraph heading.", category: "theory" },
  { keyword: "subparagraph", description: "Starts a document subparagraph heading.", category: "theory" },
  { keyword: "text", description: "Adds formal document text.", category: "theory" },
  { keyword: "txt", description: "Adds document text inside a proof body.", category: "theory" },
  { keyword: "text_raw", description: "Adds raw LaTeX document source.", category: "theory" },
  // ── Specifications & declarations ───────────────────────────────────────
  { keyword: "definition", description: "Introduces a constant definition.", category: "declaration", declaresName: true },
  { keyword: "abbreviation", description: "Introduces an abbreviation.", category: "declaration", declaresName: true },
  { keyword: "fun", description: "Defines recursive functions by pattern matching.", category: "declaration", declaresName: true },
  { keyword: "function", description: "Defines general recursive functions.", category: "declaration", declaresName: true },
  { keyword: "primrec", description: "Defines primitive recursive functions.", category: "declaration", declaresName: true },
  { keyword: "primcorec", description: "Defines primitively corecursive functions.", category: "declaration", declaresName: true },
  { keyword: "fun_cases", description: "Derives elimination rules for a recursive function.", category: "declaration", declaresName: true },
  { keyword: "inductive", description: "Defines inductive predicates.", category: "declaration", declaresName: true },
  { keyword: "inductive_set", description: "Defines inductive sets.", category: "declaration", declaresName: true },
  { keyword: "coinductive", description: "Defines coinductive predicates.", category: "declaration", declaresName: true },
  { keyword: "coinductive_set", description: "Defines coinductive sets.", category: "declaration", declaresName: true },
  { keyword: "datatype", description: "Defines datatypes.", category: "declaration", declaresName: true },
  { keyword: "codatatype", description: "Defines codatatypes.", category: "declaration", declaresName: true },
  { keyword: "type_synonym", description: "Introduces a type abbreviation.", category: "declaration", declaresName: true },
  { keyword: "typedecl", description: "Declares an uninterpreted type constructor.", category: "declaration", declaresName: true },
  { keyword: "typedef", description: "Defines a type as a non-empty subset of an existing type.", category: "declaration", declaresName: true },
  { keyword: "record", description: "Defines records.", category: "declaration", declaresName: true },
  { keyword: "lift_definition", description: "Defines a constant on a quotient or subtype.", category: "declaration", declaresName: true },
  { keyword: "consts", description: "Declares uninterpreted constants.", category: "declaration" },
  { keyword: "axiomatization", description: "Introduces constants and axioms (use sparingly — bypasses definitional safety).", category: "declaration" },
  { keyword: "lemmas", description: "Binds a name to existing facts.", category: "declaration", declaresName: true },
  { keyword: "theorems", description: "Binds a name to existing facts (alias of lemmas).", category: "declaration", declaresName: true },
  { keyword: "named_theorems", description: "Declares a dynamic named fact collection.", category: "declaration", declaresName: true },
  { keyword: "declare", description: "Applies attributes to facts in the current context.", category: "declaration" },
  { keyword: "declaration", description: "Installs a context declaration written in ML.", category: "declaration" },
  { keyword: "notation", description: "Adds mixfix notation for existing constants.", category: "declaration" },
  { keyword: "no_notation", description: "Removes mixfix notation for existing constants.", category: "declaration" },
  { keyword: "syntax", description: "Declares raw inner-syntax grammar productions.", category: "declaration" },
  { keyword: "no_syntax", description: "Removes raw inner-syntax grammar productions.", category: "declaration" },
  { keyword: "translations", description: "Declares syntactic translation rules.", category: "declaration" },
  { keyword: "no_translations", description: "Removes syntactic translation rules.", category: "declaration" },
  { keyword: "hide_const", description: "Hides constant names from the global name space.", category: "declaration" },
  { keyword: "hide_type", description: "Hides type names from the global name space.", category: "declaration" },
  { keyword: "hide_fact", description: "Hides fact names from the global name space.", category: "declaration" },
  { keyword: "hide_class", description: "Hides type-class names from the global name space.", category: "declaration" },
  { keyword: "default_sort", description: "Sets the default sort for type inference.", category: "declaration" },
  { keyword: "setup", description: "Runs a theory-setup function written in ML.", category: "declaration" },
  { keyword: "method_setup", description: "Defines a proof method via ML.", category: "declaration", declaresName: true },
  { keyword: "attribute_setup", description: "Defines a fact attribute via ML.", category: "declaration", declaresName: true },
  { keyword: "simproc_setup", description: "Defines a simplification procedure via ML.", category: "declaration", declaresName: true },
  { keyword: "bundle", description: "Defines a named bundle of declarations.", category: "declaration", declaresName: true },
  { keyword: "unbundle", description: "Activates the declarations of named bundles.", category: "declaration" },
  // ── Goal statements ─────────────────────────────────────────────────────
  { keyword: "lemma", description: "States a named or anonymous lemma.", category: "statement", declaresName: true },
  { keyword: "theorem", description: "States a named or anonymous theorem.", category: "statement", declaresName: true },
  { keyword: "corollary", description: "States a named or anonymous corollary.", category: "statement", declaresName: true },
  { keyword: "proposition", description: "States a named or anonymous proposition.", category: "statement", declaresName: true },
  { keyword: "schematic_goal", description: "States a schematic goal.", category: "statement", declaresName: true },
  { keyword: "termination", description: "Opens the termination proof of a recursive function.", category: "statement", declaresName: true },
  // ── Type classes & locales ──────────────────────────────────────────────
  { keyword: "locale", description: "Defines a locale.", category: "context", declaresName: true },
  { keyword: "experiment", description: "Opens an anonymous locale for throw-away development.", category: "context" },
  { keyword: "class", description: "Defines an axiomatic type class.", category: "context", declaresName: true },
  { keyword: "instantiation", description: "Opens a context to instantiate a type class.", category: "context" },
  { keyword: "instance", description: "States a type-class instance proof obligation.", category: "statement" },
  { keyword: "subclass", description: "States that one type class is a subclass of another.", category: "statement", declaresName: true },
  { keyword: "interpretation", description: "Interprets a locale in the current context.", category: "statement" },
  { keyword: "interpret", description: "Interprets a locale within a proof.", category: "proof" },
  { keyword: "global_interpretation", description: "Interprets a locale at the theory top level.", category: "statement" },
  { keyword: "sublocale", description: "Interprets one locale within another.", category: "statement" },
  { keyword: "context", description: "Opens a local proof context.", category: "context" },
  // ── Isar proof structure ────────────────────────────────────────────────
  { keyword: "proof", description: "Starts an Isar proof block.", category: "proof" },
  { keyword: "apply", description: "Applies a proof method to the current goal.", category: "proof" },
  { keyword: "apply_end", description: "Applies a proof method at the end of an Isar block.", category: "proof" },
  { keyword: "supply", description: "Adds facts to the local proof context.", category: "proof", declaresName: true },
  { keyword: "subgoal", description: "Focuses on a single subgoal in a proof script.", category: "proof" },
  { keyword: "using", description: "Adds facts to the next proof step.", category: "proof" },
  { keyword: "unfolding", description: "Unfolds definitions for the next proof step.", category: "proof" },
  { keyword: "include", description: "Activates bundle declarations within a proof.", category: "proof" },
  { keyword: "including", description: "Activates bundle declarations for the next step.", category: "proof" },
  { keyword: "from", description: "Starts a proof step from facts.", category: "proof" },
  { keyword: "with", description: "Starts a proof step with facts and current facts.", category: "proof" },
  { keyword: "then", description: "Chains facts into the next proof step.", category: "proof" },
  { keyword: "have", description: "States an intermediate proof claim.", category: "proof", declaresName: true },
  { keyword: "show", description: "States a claim that solves a pending goal.", category: "proof", declaresName: true },
  { keyword: "hence", description: "Chains facts into an intermediate claim.", category: "proof", declaresName: true },
  { keyword: "thus", description: "Chains facts into a goal-solving claim.", category: "proof", declaresName: true },
  { keyword: "fix", description: "Fixes variables in an Isar proof.", category: "proof" },
  { keyword: "assume", description: "Introduces assumptions in an Isar proof.", category: "proof", declaresName: true },
  { keyword: "presume", description: "Introduces presumptions in an Isar proof.", category: "proof", declaresName: true },
  { keyword: "define", description: "Introduces a local definition in an Isar proof.", category: "proof", declaresName: true },
  { keyword: "consider", description: "Introduces a case split in an Isar proof.", category: "proof" },
  { keyword: "obtain", description: "Obtains witnesses or facts in an Isar proof.", category: "proof", declaresName: true },
  { keyword: "guess", description: "Guesses witnesses in an Isar proof.", category: "proof" },
  { keyword: "let", description: "Introduces local abbreviations in an Isar proof.", category: "proof" },
  { keyword: "write", description: "Adds temporary notation within a proof.", category: "proof" },
  { keyword: "note", description: "Names or recalls facts in an Isar proof.", category: "proof", declaresName: true },
  { keyword: "case", description: "Opens a proof case.", category: "proof", declaresName: true },
  { keyword: "next", description: "Starts the next proof case.", category: "proof" },
  { keyword: "also", description: "Starts or continues a calculation.", category: "proof" },
  { keyword: "moreover", description: "Accumulates facts for a calculation.", category: "proof" },
  { keyword: "ultimately", description: "Combines accumulated facts for a proof step.", category: "proof" },
  { keyword: "finally", description: "Finishes a calculation.", category: "proof" },
  { keyword: "qed", description: "Completes an Isar proof.", category: "proofTerminal" },
  { keyword: "by", description: "Completes a proof with a proof method.", category: "proofTerminal" },
  { keyword: "done", description: "Completes an apply-style proof.", category: "proofTerminal" },
  { keyword: "sorry", description: "Admits the current proof obligation.", category: "proofTerminal" },
  { keyword: "oops", description: "Abandons the current proof.", category: "proofTerminal" },
  // ── Diagnostic / exploratory commands ───────────────────────────────────
  { keyword: "value", description: "Evaluates a term and prints its result.", category: "diagnostic" },
  { keyword: "term", description: "Type-checks and prints a term.", category: "diagnostic" },
  { keyword: "prop", description: "Type-checks and prints a proposition.", category: "diagnostic" },
  { keyword: "typ", description: "Reads and prints a type.", category: "diagnostic" },
  { keyword: "thm", description: "Prints the named theorems.", category: "diagnostic" },
  { keyword: "prf", description: "Prints the proof term of a theorem.", category: "diagnostic" },
  { keyword: "full_prf", description: "Prints the full proof term of a theorem.", category: "diagnostic" },
  { keyword: "find_theorems", description: "Searches for theorems matching given criteria.", category: "diagnostic" },
  { keyword: "find_consts", description: "Searches for constants matching given criteria.", category: "diagnostic" },
  { keyword: "print_theorems", description: "Prints theorems of the current context.", category: "diagnostic" },
  { keyword: "print_statement", description: "Prints facts in long statement form.", category: "diagnostic" },
  { keyword: "print_locale", description: "Prints the specified locale expression.", category: "diagnostic" },
  { keyword: "print_classes", description: "Prints the known type classes.", category: "diagnostic" },
  { keyword: "sledgehammer", description: "Searches for a proof using external automatic provers.", category: "diagnostic" },
  { keyword: "nitpick", description: "Searches for counterexamples using a model finder.", category: "diagnostic" },
  { keyword: "quickcheck", description: "Searches for counterexamples by random/exhaustive testing.", category: "diagnostic" },
  { keyword: "try", description: "Tries a combination of proof methods and tools.", category: "diagnostic" },
  { keyword: "try0", description: "Tries standard proof methods (auto, blast, …).", category: "diagnostic" },
  { keyword: "solve_direct", description: "Checks whether the goal is already a known fact.", category: "diagnostic" },
  { keyword: "export_code", description: "Generates executable code for the given constants.", category: "diagnostic" },
  // ── Embedded ML ─────────────────────────────────────────────────────────
  { keyword: "ML", description: "Evaluates Isabelle/ML source in the theory context.", category: "ml" },
  { keyword: "ML_file", description: "Evaluates an Isabelle/ML source file.", category: "ml" },
  { keyword: "ML_val", description: "Evaluates an Isabelle/ML expression and prints the result.", category: "ml" },
  { keyword: "ML_prf", description: "Evaluates Isabelle/ML source within a proof.", category: "ml" }
];

export const ISABELLE_COMMANDS: ReadonlyMap<string, IsabelleCommandInfo> = new Map(
  COMMANDS.map((command) => [command.keyword, command])
);

export const ISABELLE_SYMBOLS: ReadonlyMap<string, IsabelleSymbolInfo> = new Map(
  [
    ["forall", "∀", "Universal quantifier"],
    ["exists", "∃", "Existential quantifier"],
    ["lambda", "λ", "Lambda abstraction"],
    ["Longrightarrow", "⟹", "Meta implication"],
    ["longrightarrow", "⟶", "Object implication"],
    ["Rightarrow", "⇒", "Function type"],
    ["And", "⋀", "Meta universal quantifier"],
    ["equiv", "≡", "Meta equality"],
    ["noteq", "≠", "Disequality"],
    ["in", "∈", "Set membership"],
    ["notin", "∉", "Negated set membership"],
    ["subseteq", "⊆", "Subset or equal"],
    ["union", "∪", "Set union"],
    ["inter", "∩", "Set intersection"]
  ].map(([name, glyph, description]) => [name as string, { name, glyph, description }])
);

export function getCommandInfo(keyword: string): IsabelleCommandInfo | undefined {
  return ISABELLE_COMMANDS.get(keyword);
}

export function isCommandKeyword(keyword: string): boolean {
  return ISABELLE_COMMANDS.has(keyword);
}

export function isTheoryStructureCommand(keyword: string): boolean {
  return getCommandInfo(keyword)?.category === "theory";
}

export function isDeclarationCommand(keyword: string): boolean {
  return getCommandInfo(keyword)?.category === "declaration";
}

export function isProofStatementCommand(keyword: string): boolean {
  return getCommandInfo(keyword)?.category === "statement";
}

export function isProofStepCommand(keyword: string): boolean {
  return getCommandInfo(keyword)?.category === "proof";
}

export function isProofTerminalCommand(keyword: string): boolean {
  return getCommandInfo(keyword)?.category === "proofTerminal";
}

export function isDiagnosticCommand(keyword: string): boolean {
  return getCommandInfo(keyword)?.category === "diagnostic";
}

export function isMlCommand(keyword: string): boolean {
  return getCommandInfo(keyword)?.category === "ml";
}

export function getSymbolInfo(source: string): IsabelleSymbolInfo | undefined {
  const match = /^\\<([^>]+)>$/.exec(source);
  return match ? ISABELLE_SYMBOLS.get(match[1]) : undefined;
}
