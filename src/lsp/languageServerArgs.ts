export interface LanguageServerCommand {
  command: string;
  args: string[];
}

export interface ResolveCommandOptions {
  /**
   * Platform to resolve for. Defaults to {@link process.platform} so callers
   * don't need to pass anything in production; tests pass an explicit value
   * to exercise Windows behavior on non-Windows runners and vice versa.
   */
  platform?: NodeJS.Platform;
}

/**
 * Resolve a launch command for an arbitrary Isabelle CLI invocation, applying
 * a PowerShell wrapper on Windows when the configured executable is a
 * `.ps1`/`.psm1` script.
 *
 * Why this exists: Isabelle's Windows distribution ships its launcher as
 * `isabelle.ps1`. Node's `child_process.spawn(executablePath, ...)` does NOT
 * resolve `.ps1` extensions on Windows (PATHEXT covers `.exe`, `.cmd`,
 * `.bat`, etc., but not `.ps1`), so a direct spawn ENOENTs out. Wrapping the
 * call via `powershell.exe -File <script> <args...>` works around that
 * without resorting to `shell: true` (which has security and quoting
 * caveats). On non-Windows platforms or for non-`.ps1` executables the
 * command is returned unchanged.
 *
 * Pure: no I/O. Safe to import from tests.
 */
export function resolveIsabelleCommand(
  executablePath: string,
  subcommandAndArgs: readonly string[],
  options: ResolveCommandOptions = {}
): LanguageServerCommand {
  const command = executablePath.trim();
  const platform = options.platform ?? process.platform;
  const args = subcommandAndArgs.map((arg) => String(arg));

  if (platform === "win32" && /\.(ps1|psm1)$/i.test(command)) {
    return {
      command: "powershell.exe",
      args: ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", command, ...args]
    };
  }

  return { command, args };
}

/**
 * Build the launch command for Isabelle's bundled VS Code language server.
 *
 * The shipped subcommand is `isabelle vscode_server`, which speaks LSP over
 * stdio. Additional user arguments (for example `["-L", "./isabelle.log"]`)
 * are appended after the subcommand and before the protocol takes over.
 *
 * On Windows, if the configured executable ends in `.ps1`/`.psm1` (Isabelle's
 * official Windows distribution ships the launcher as `isabelle.ps1`), the
 * returned command wraps the call via `powershell.exe -File` so Node can
 * actually spawn it; see {@link resolveIsabelleCommand} for the rationale.
 *
 * Pure: no `vscode`, no `child_process`, no I/O. Safe to import from tests.
 */
export function buildLanguageServerCommand(
  executablePath: string,
  extraArgs: readonly string[],
  options: ResolveCommandOptions = {}
): LanguageServerCommand {
  return resolveIsabelleCommand(
    executablePath,
    ["vscode_server", ...extraArgs.map((arg) => String(arg))],
    options
  );
}
