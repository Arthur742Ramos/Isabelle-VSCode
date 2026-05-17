export interface LanguageServerCommand {
  command: string;
  args: string[];
}

/**
 * Build the launch command for Isabelle's bundled VS Code language server.
 *
 * The shipped subcommand is `isabelle vscode_server`, which speaks LSP over
 * stdio. Additional user arguments (for example `["-L", "./isabelle.log"]`)
 * are appended after the subcommand and before the protocol takes over.
 *
 * Pure: no `vscode`, no `child_process`, no I/O. Safe to import from tests.
 */
export function buildLanguageServerCommand(
  executablePath: string,
  extraArgs: readonly string[]
): LanguageServerCommand {
  const command = executablePath.trim();
  const args = ["vscode_server", ...extraArgs.map((arg) => String(arg))];
  return { command, args };
}
