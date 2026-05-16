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
  | "context";

export interface IsabelleSymbolInfo {
  name: string;
  glyph: string;
  description: string;
}

const COMMANDS: IsabelleCommandInfo[] = [
  { keyword: "theory", description: "Starts a theory declaration.", category: "theory" },
  { keyword: "imports", description: "Declares imported theories.", category: "theory" },
  { keyword: "begin", description: "Starts the body of a theory, locale, or context.", category: "theory" },
  { keyword: "end", description: "Closes the current theory or context.", category: "theory" },
  { keyword: "section", description: "Starts a document section.", category: "theory" },
  { keyword: "subsection", description: "Starts a document subsection.", category: "theory" },
  { keyword: "subsubsection", description: "Starts a document subsubsection.", category: "theory" },
  { keyword: "text", description: "Adds formal document text.", category: "theory" },
  { keyword: "lemma", description: "States a named or anonymous lemma.", category: "statement", declaresName: true },
  { keyword: "theorem", description: "States a named or anonymous theorem.", category: "statement", declaresName: true },
  { keyword: "corollary", description: "States a named or anonymous corollary.", category: "statement", declaresName: true },
  { keyword: "proposition", description: "States a named or anonymous proposition.", category: "statement", declaresName: true },
  { keyword: "schematic_goal", description: "States a schematic goal.", category: "statement", declaresName: true },
  { keyword: "definition", description: "Introduces a constant definition.", category: "declaration", declaresName: true },
  { keyword: "abbreviation", description: "Introduces an abbreviation.", category: "declaration", declaresName: true },
  { keyword: "fun", description: "Defines recursive functions by pattern matching.", category: "declaration", declaresName: true },
  { keyword: "function", description: "Defines general recursive functions.", category: "declaration", declaresName: true },
  { keyword: "primrec", description: "Defines primitive recursive functions.", category: "declaration", declaresName: true },
  { keyword: "inductive", description: "Defines inductive predicates.", category: "declaration", declaresName: true },
  { keyword: "datatype", description: "Defines datatypes.", category: "declaration", declaresName: true },
  { keyword: "record", description: "Defines records.", category: "declaration", declaresName: true },
  { keyword: "locale", description: "Defines a locale.", category: "context", declaresName: true },
  { keyword: "context", description: "Opens a local proof context.", category: "context" },
  { keyword: "proof", description: "Starts an Isar proof block.", category: "proof" },
  { keyword: "apply", description: "Applies a proof method to the current goal.", category: "proof" },
  { keyword: "using", description: "Adds facts to the next proof step.", category: "proof" },
  { keyword: "unfolding", description: "Unfolds definitions for the next proof step.", category: "proof" },
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
  { keyword: "obtain", description: "Obtains witnesses or facts in an Isar proof.", category: "proof", declaresName: true },
  { keyword: "guess", description: "Guesses witnesses in an Isar proof.", category: "proof" },
  { keyword: "let", description: "Introduces local abbreviations in an Isar proof.", category: "proof" },
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
  { keyword: "oops", description: "Abandons the current proof.", category: "proofTerminal" }
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

export function getSymbolInfo(source: string): IsabelleSymbolInfo | undefined {
  const match = /^\\<([^>]+)>$/.exec(source);
  return match ? ISABELLE_SYMBOLS.get(match[1]) : undefined;
}
