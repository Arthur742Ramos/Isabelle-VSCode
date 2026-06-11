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
  { keyword: "nonterminal", description: "Declares an inner-syntax nonterminal symbol.", category: "declaration", declaresName: true },
  { keyword: "judgment", description: "Declares the inner-syntax judgment embedding the object logic into Pure.", category: "declaration", declaresName: true },
  { keyword: "alias", description: "Introduces an alternative name for an existing constant.", category: "declaration", declaresName: true },
  { keyword: "type_alias", description: "Introduces an alternative name for an existing type constructor.", category: "declaration", declaresName: true },
  { keyword: "oracle", description: "Declares an ML oracle that may create theorems outside the kernel (use with care).", category: "declaration", declaresName: true },
  { keyword: "type_notation", description: "Adds mixfix notation for existing type constructors.", category: "declaration" },
  { keyword: "no_type_notation", description: "Removes mixfix notation for existing type constructors.", category: "declaration" },
  { keyword: "syntax_consts", description: "Associates inner-syntax constants with logical constants.", category: "declaration" },
  { keyword: "syntax_types", description: "Associates inner-syntax types with logical type constructors.", category: "declaration" },
  { keyword: "syntax_declaration", description: "Declares inner-syntax productions without logical content.", category: "declaration" },
  { keyword: "parse_translation", description: "Installs an ML parse translation for inner syntax.", category: "declaration" },
  { keyword: "print_translation", description: "Installs an ML print translation for inner syntax.", category: "declaration" },
  { keyword: "parse_ast_translation", description: "Installs an ML parse AST translation for inner syntax.", category: "declaration" },
  { keyword: "print_ast_translation", description: "Installs an ML print AST translation for inner syntax.", category: "declaration" },
  { keyword: "typed_print_translation", description: "Installs an ML typed print translation for inner syntax.", category: "declaration" },
  { keyword: "code_datatype", description: "Registers the constructors used by the code generator for a type.", category: "declaration" },
  { keyword: "adhoc_overloading", description: "Declares ad-hoc overloading: one constant standing for several typed variants.", category: "declaration" },
  { keyword: "no_adhoc_overloading", description: "Removes ad-hoc overloading variants for a constant.", category: "declaration" },
  { keyword: "local_setup", description: "Runs an ML setup function in the local theory context.", category: "declaration" },
  { keyword: "open_bundle", description: "Defines a bundle and immediately includes it in the current context.", category: "declaration" },
  { keyword: "generate_file", description: "Generates a file from embedded content in the theory.", category: "declaration" },
  { keyword: "external_file", description: "Declares a dependency on an external file.", category: "declaration" },
  { keyword: "bibtex_file", description: "Declares a BibTeX database file for document preparation.", category: "declaration" },
  { keyword: "ROOTS_file", description: "Declares a dependency on a ROOTS file.", category: "declaration" },
  { keyword: "realizers", description: "Declares realisers for axioms/theorems (program extraction).", category: "declaration" },
  { keyword: "realizability", description: "Declares realisability clauses for program extraction.", category: "declaration" },
  { keyword: "extract_type", description: "Declares a realisability type for program extraction.", category: "declaration" },
  { keyword: "extract", description: "Extracts a program from a proof (program-extraction package).", category: "declaration" },
  { keyword: "setup_lifting", description: "Sets up the Lifting package for a type from a quotient or typedef theorem.", category: "declaration" },
  { keyword: "lifting_forget", description: "Removes Lifting-package setup for a type in the current context.", category: "declaration" },
  { keyword: "lifting_update", description: "Refreshes the Lifting package's transfer rules for a type.", category: "declaration" },
  { keyword: "parametric_constant", description: "Proves and registers parametricity of a constant for the Transfer package.", category: "declaration" },
  { keyword: "coinduction_upto", description: "Derives an up-to coinduction principle for a codatatype.", category: "declaration" },
  { keyword: "bnf_axiomatization", description: "Axiomatizes a bounded natural functor without proof obligations.", category: "declaration" },
  { keyword: "copy_bnf", description: "Registers a type copy as a bounded natural functor (BNF).", category: "declaration" },
  { keyword: "datatype_compat", description: "Derives an old-style datatype view of a (co)datatype for compatibility.", category: "declaration" },
  { keyword: "datatype_record", description: "Defines a record as a datatype with named selectors.", category: "declaration", declaresName: true },
  { keyword: "corec", description: "Defines a corecursive function via the corecursion package.", category: "declaration", declaresName: true },
  { keyword: "sledgehammer_params", description: "Sets default parameters for Sledgehammer.", category: "declaration" },
  { keyword: "nitpick_params", description: "Sets default parameters for Nitpick.", category: "declaration" },
  { keyword: "quickcheck_params", description: "Sets default parameters for Quickcheck.", category: "declaration" },
  { keyword: "nunchaku_params", description: "Sets default parameters for Nunchaku.", category: "declaration" },
  { keyword: "quickcheck_generator", description: "Declares a custom Quickcheck data generator for a type.", category: "declaration" },
  // ── Goal statements ─────────────────────────────────────────────────────
  { keyword: "lemma", description: "States a named or anonymous lemma.", category: "statement", declaresName: true },
  { keyword: "theorem", description: "States a named or anonymous theorem.", category: "statement", declaresName: true },
  { keyword: "corollary", description: "States a named or anonymous corollary.", category: "statement", declaresName: true },
  { keyword: "proposition", description: "States a named or anonymous proposition.", category: "statement", declaresName: true },
  { keyword: "schematic_goal", description: "States a schematic goal.", category: "statement", declaresName: true },
  { keyword: "termination", description: "Opens the termination proof of a recursive function.", category: "statement", declaresName: true },
  { keyword: "quotient_type", description: "Defines a quotient type by an equivalence relation, with proof obligations.", category: "statement", declaresName: true },
  { keyword: "quotient_definition", description: "Defines a constant on a quotient type, with a respectfulness proof obligation.", category: "statement" },
  { keyword: "bnf", description: "Registers a type as a bounded natural functor, with proof obligations.", category: "statement" },
  { keyword: "lift_bnf", description: "Registers a subtype or quotient as a bounded natural functor (BNF).", category: "statement" },
  { keyword: "free_constructors", description: "Registers constructors as free, with distinctness/injectivity obligations.", category: "statement" },
  { keyword: "corecursive", description: "Defines a corecursive function, with proof obligations.", category: "statement", declaresName: true },
  { keyword: "primcorecursive", description: "Defines a primitively corecursive function, with proof obligations.", category: "statement", declaresName: true },
  { keyword: "friend_of_corec", description: "Registers a function as a friend for the corecursion package.", category: "statement" },
  { keyword: "code_pred", description: "Sets up code generation for an inductive predicate (predicate compiler).", category: "statement" },
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
  { keyword: "notepad", description: "Opens a scratch context for Isar proof text without stating a theorem.", category: "context" },
  { keyword: "overloading", description: "Opens a context to define constants by overloaded specification.", category: "context" },
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
  { keyword: "defer", description: "Moves the current subgoal to the end of the goal list.", category: "proof" },
  { keyword: "prefer", description: "Moves the numbered subgoal to the front of the goal list.", category: "proof" },
  { keyword: "back", description: "Backtracks to the previous proof state, enumerating alternative results.", category: "proof" },
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
  { keyword: "print_state", description: "Prints the current proof state.", category: "diagnostic" },
  { keyword: "print_context", description: "Prints the logical context: fixed variables, assumptions, and local facts.", category: "diagnostic" },
  { keyword: "print_theory", description: "Prints the logical content of the current theory (verbose).", category: "diagnostic" },
  { keyword: "print_definitions", description: "Prints the constant definitions of the current context.", category: "diagnostic" },
  { keyword: "print_defn_rules", description: "Prints the definitional rewrite rules used to unfold definitions.", category: "diagnostic" },
  { keyword: "print_syntax", description: "Prints the inner-syntax grammar of the current context (verbose).", category: "diagnostic" },
  { keyword: "print_abbrevs", description: "Prints the term abbreviations active in the current context.", category: "diagnostic" },
  { keyword: "print_facts", description: "Prints the local facts available in the current context.", category: "diagnostic" },
  { keyword: "print_cases", description: "Prints the named cases available in the current proof.", category: "diagnostic" },
  { keyword: "print_term_bindings", description: "Prints the schematic term bindings in effect in the current proof.", category: "diagnostic" },
  { keyword: "print_locales", description: "Prints the locales declared in the current theory.", category: "diagnostic" },
  { keyword: "print_interps", description: "Prints the interpretations of the given locale in the current theory.", category: "diagnostic" },
  { keyword: "print_attributes", description: "Prints the attributes (fact transformers) known in the current context.", category: "diagnostic" },
  { keyword: "print_simpset", description: "Prints the Simplifier context: rewrite rules, congruences, and procedures.", category: "diagnostic" },
  { keyword: "print_rules", description: "Prints the intro/elim/dest rules declared for the classical reasoner.", category: "diagnostic" },
  { keyword: "print_trans_rules", description: "Prints the transitivity rules used by calculational reasoning.", category: "diagnostic" },
  { keyword: "print_methods", description: "Prints the proof methods available in the current context.", category: "diagnostic" },
  { keyword: "print_options", description: "Prints the configuration options and their values in the context.", category: "diagnostic" },
  { keyword: "print_bundles", description: "Prints the declaration bundles available in the current context.", category: "diagnostic" },
  { keyword: "print_codesetup", description: "Prints the code-generator setup of the current theory.", category: "diagnostic" },
  { keyword: "print_commands", description: "Prints all outer-syntax commands known to the current theory.", category: "diagnostic" },
  { keyword: "print_antiquotations", description: "Prints the document antiquotations available in the current context.", category: "diagnostic" },
  { keyword: "print_ML_antiquotations", description: "Prints the Isabelle/ML antiquotations available in the current context.", category: "diagnostic" },
  { keyword: "thy_deps", description: "Visualises the theory import graph as a dependency graph.", category: "diagnostic" },
  { keyword: "locale_deps", description: "Visualises the locale hierarchy as a dependency graph.", category: "diagnostic" },
  { keyword: "class_deps", description: "Visualises the type-class hierarchy as a dependency graph.", category: "diagnostic" },
  { keyword: "thm_deps", description: "Shows the theorem dependency graph of the given facts.", category: "diagnostic" },
  { keyword: "thm_oracles", description: "Shows the oracles that the given theorems depend on.", category: "diagnostic" },
  { keyword: "unused_thms", description: "Finds named theorems in the current theory that are never used.", category: "diagnostic" },
  { keyword: "help", description: "Lists outer-syntax commands whose name matches the given patterns.", category: "diagnostic" },
  { keyword: "welcome", description: "Prints the Isabelle/Isar welcome message.", category: "diagnostic" },
  { keyword: "export_generated_files", description: "Writes files generated in the current theory into the session exports.", category: "diagnostic" },
  { keyword: "compile_generated_files", description: "Compiles files generated in the current theory (e.g. exported code).", category: "diagnostic" },
  { keyword: "scala_build_generated_files", description: "Builds generated sources using the Isabelle/Scala build tool.", category: "diagnostic" },
  { keyword: "values", description: "Enumerates values satisfying an inductive predicate.", category: "diagnostic" },
  { keyword: "find_unused_assms", description: "Finds assumptions of a theorem that are never used in its proof.", category: "diagnostic" },
  { keyword: "nunchaku", description: "Searches for a counterexample using the Nunchaku model finder.", category: "diagnostic" },
  { keyword: "test_code", description: "Tests generated code by evaluating it within the prover.", category: "diagnostic" },
  { keyword: "print_bnfs", description: "Prints the registered bounded natural functors (BNFs).", category: "diagnostic" },
  { keyword: "print_claset", description: "Prints the Classical-reasoner context (intro/elim/dest rules).", category: "diagnostic" },
  { keyword: "print_induct_rules", description: "Prints the induction and case-analysis rules of the context.", category: "diagnostic" },
  { keyword: "print_coercions", description: "Prints the coercions registered for type inference.", category: "diagnostic" },
  { keyword: "print_record", description: "Prints the definition of the given record type.", category: "diagnostic" },
  { keyword: "print_case_translations", description: "Prints the case-expression translations of the context.", category: "diagnostic" },
  { keyword: "print_quotients", description: "Prints the registered quotient types.", category: "diagnostic" },
  { keyword: "print_quotconsts", description: "Prints the registered quotient constants.", category: "diagnostic" },
  { keyword: "print_quot_maps", description: "Prints the registered quotient relator maps.", category: "diagnostic" },
  // ── Embedded ML ─────────────────────────────────────────────────────────
  { keyword: "ML", description: "Evaluates Isabelle/ML source in the theory context.", category: "ml" },
  { keyword: "ML_file", description: "Evaluates an Isabelle/ML source file.", category: "ml" },
  { keyword: "ML_val", description: "Evaluates an Isabelle/ML expression and prints the result.", category: "ml" },
  { keyword: "ML_prf", description: "Evaluates Isabelle/ML source within a proof.", category: "ml" },
  { keyword: "ML_command", description: "Evaluates an Isabelle/ML expression as a diagnostic command.", category: "ml" },
  { keyword: "ML_export", description: "Evaluates Isabelle/ML source and exports its bindings to the global context.", category: "ml" },
  { keyword: "ML_file_debug", description: "Evaluates an Isabelle/ML source file with debugging enabled.", category: "ml" },
  { keyword: "ML_file_no_debug", description: "Evaluates an Isabelle/ML source file with debugging disabled.", category: "ml" },
  { keyword: "SML_file", description: "Evaluates a Standard ML source file.", category: "ml" },
  { keyword: "SML_file_debug", description: "Evaluates a Standard ML source file with debugging enabled.", category: "ml" },
  { keyword: "SML_file_no_debug", description: "Evaluates a Standard ML source file with debugging disabled.", category: "ml" },
  { keyword: "SML_import", description: "Imports Standard ML bindings into the Isabelle/ML environment.", category: "ml" },
  { keyword: "SML_export", description: "Exports Isabelle/ML bindings to the Standard ML environment.", category: "ml" }
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

const CATEGORY_ROLE_LABELS: Record<IsabelleCommandCategory, string> = {
  theory: "theory / document command",
  declaration: "specification command",
  statement: "goal statement",
  proof: "Isar proof command",
  proofTerminal: "proof terminator",
  context: "context command",
  diagnostic: "diagnostic command",
  ml: "Isabelle/ML command"
};

/** Human-readable role label for a command's category (used in hovers). */
export function commandRoleLabel(category: IsabelleCommandCategory): string {
  return CATEGORY_ROLE_LABELS[category];
}

/**
 * Build a Markdown hover description for an outer-syntax command: the command
 * name, a role label derived from its category, and the one-line description.
 * Mirrors the shape of the proof-method hover so the two read consistently.
 */
export function buildCommandHoverMarkdown(info: IsabelleCommandInfo): string {
  return [
    `**Isabelle command** \`${info.keyword}\` — ${commandRoleLabel(info.category)}`,
    "",
    info.description
  ].join("\n");
}

