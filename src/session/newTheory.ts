/**
 * Pure helpers for scaffolding a new Isabelle theory file.
 *
 * The central correctness rule this encodes: **an Isabelle theory's name must
 * equal its file's base name** (`Foo.thy` ⇒ `theory Foo`). Getting this wrong is
 * a common beginner foot-gun that the prover only reports at load time. These
 * helpers are `vscode`-free so they can be unit tested.
 */

/** A legal Isabelle theory/identifier name: a letter, then letters/digits/_/'. */
export const THEORY_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_']*$/;

export function isValidTheoryName(name: string): boolean {
  return THEORY_NAME_PATTERN.test(name);
}

/**
 * Best-effort conversion of free-form user input (possibly a file name or a path)
 * into a legal theory name: drop a trailing `.thy`, keep the base name, replace
 * runs of illegal characters with `_`, and prefix `T` if it does not start with
 * a letter. Returns `undefined` if nothing usable remains.
 */
export function sanitizeTheoryName(input: string): string | undefined {
  let candidate = input.trim();
  if (candidate.length === 0) {
    return undefined;
  }
  // Keep only the final path segment and strip a .thy extension.
  candidate = candidate.split(/[\\/]/).pop() ?? candidate;
  candidate = candidate.replace(/\.thy$/i, "");
  // Replace any run of disallowed characters with a single underscore.
  candidate = candidate.replace(/[^A-Za-z0-9_']+/g, "_").replace(/^_+|_+$/g, "");
  if (candidate.length === 0) {
    return undefined;
  }
  if (!/^[A-Za-z]/.test(candidate)) {
    candidate = `T${candidate}`;
  }
  return isValidTheoryName(candidate) ? candidate : undefined;
}

export interface NewTheoryOptions {
  readonly name: string;
  /** Imported theories; defaults to `["Main"]` when empty. */
  readonly imports?: readonly string[];
}

/**
 * Render the contents of a new `<name>.thy` file: the theory header with its
 * imports, a `begin`/`end` body, and a trailing newline.
 */
export function buildTheoryFileContent(options: NewTheoryOptions): string {
  const imports = options.imports && options.imports.length > 0 ? options.imports : ["Main"];
  return [
    `theory ${options.name}`,
    `  imports ${imports.join(" ")}`,
    "begin",
    "",
    "",
    "end",
    ""
  ].join("\n");
}

/** The on-disk file name for a theory: `<name>.thy`. */
export function theoryFileName(name: string): string {
  return `${name}.thy`;
}
