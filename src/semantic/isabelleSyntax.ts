export interface IsabelleCommandInfo {
  keyword: string;
  description: string;
  declaresName?: boolean;
}

export interface IsabelleSymbolInfo {
  name: string;
  glyph: string;
  description: string;
}

const COMMANDS: IsabelleCommandInfo[] = [
  { keyword: "theory", description: "Starts a theory declaration." },
  { keyword: "imports", description: "Declares imported theories." },
  { keyword: "begin", description: "Starts the body of a theory, locale, or context." },
  { keyword: "lemma", description: "States a named or anonymous lemma.", declaresName: true },
  { keyword: "theorem", description: "States a named or anonymous theorem.", declaresName: true },
  { keyword: "corollary", description: "States a named or anonymous corollary.", declaresName: true },
  { keyword: "proposition", description: "States a named or anonymous proposition.", declaresName: true },
  { keyword: "definition", description: "Introduces a constant definition.", declaresName: true },
  { keyword: "fun", description: "Defines recursive functions by pattern matching.", declaresName: true },
  { keyword: "function", description: "Defines general recursive functions.", declaresName: true },
  { keyword: "primrec", description: "Defines primitive recursive functions.", declaresName: true },
  { keyword: "inductive", description: "Defines inductive predicates.", declaresName: true },
  { keyword: "datatype", description: "Defines datatypes.", declaresName: true },
  { keyword: "record", description: "Defines records.", declaresName: true },
  { keyword: "locale", description: "Defines a locale.", declaresName: true },
  { keyword: "context", description: "Opens a local proof context." },
  { keyword: "proof", description: "Starts an Isar proof block." },
  { keyword: "qed", description: "Completes an Isar proof." },
  { keyword: "by", description: "Completes a proof with a proof method." },
  { keyword: "apply", description: "Applies a proof method to the current goal." },
  { keyword: "done", description: "Completes an apply-style proof." },
  { keyword: "end", description: "Closes the current theory or context." }
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

export function getSymbolInfo(source: string): IsabelleSymbolInfo | undefined {
  const match = /^\\<([^>]+)>$/.exec(source);
  return match ? ISABELLE_SYMBOLS.get(match[1]) : undefined;
}
