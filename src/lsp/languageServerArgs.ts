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
  /**
   * Optional PATH lookup. When provided AND the configured executable
   * is a bare name (no path separators, no known executable extension),
   * the resolver calls this to find an absolute launcher path on
   * Windows. Used to bridge the gap where Isabelle's Windows
   * distribution ships only `isabelle.ps1` but Node's `spawn` does not
   * resolve `.ps1` via PATHEXT. Production callers wire this to a
   * `process.env.PATH` scanner; tests pass a fake or omit it.
   *
   * No-op on non-Windows platforms (POSIX `spawn` honors PATH on its
   * own). No-op when the configured executable already contains a path
   * separator or a known executable extension — those values are taken
   * verbatim so explicit user overrides win.
   */
  readonly pathLookup?: (name: string) => string | undefined;
}

/**
 * Set of executable extensions Node's `child_process.spawn` already resolves
 * on Windows via PATHEXT, plus `.ps1`/`.psm1` which the resolver wraps
 * explicitly when the configured path already carries that extension. If the
 * configured executable already ends in one of these we never consult
 * `pathLookup` — the user clearly intends to invoke that exact file.
 */
const KNOWN_EXECUTABLE_EXTENSIONS = /\.(ps1|psm1|exe|cmd|bat|com)$/i;

/**
 * `true` when `value` looks like a bare program name (no path separators,
 * no known executable extension). Used to gate the PATH lookup on Windows
 * so explicit paths like `C:\Tools\bin\isabelle.ps1` or `./isabelle` are
 * passed through unchanged.
 */
function isBareExecutableName(value: string): boolean {
  if (value.length === 0) {
    return false;
  }
  if (value.includes("/") || value.includes("\\")) {
    return false;
  }
  return !KNOWN_EXECUTABLE_EXTENSIONS.test(value);
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
 * When `options.pathLookup` is provided AND the configured executable is a
 * bare name on Windows (e.g. the default `"isabelle"`), the resolver first
 * asks the lookup for an absolute launcher path. If the lookup finds an
 * `isabelle.ps1` on PATH the existing `.ps1` branch then wraps it via
 * PowerShell automatically. This means out-of-the-box Windows installations
 * Just Work as long as `isabelle.ps1` is reachable on PATH, without users
 * having to manually set `isabelle.executablePath` to the absolute file.
 *
 * Pure: no I/O. Safe to import from tests.
 */
export function resolveIsabelleCommand(
  executablePath: string,
  subcommandAndArgs: readonly string[],
  options: ResolveCommandOptions = {}
): LanguageServerCommand {
  let command = executablePath.trim();
  const platform = options.platform ?? process.platform;
  const args = subcommandAndArgs.map((arg) => String(arg));

  if (platform === "win32" && options.pathLookup && isBareExecutableName(command)) {
    const resolved = options.pathLookup(command);
    if (typeof resolved === "string" && resolved.length > 0) {
      command = resolved;
    }
  }

  if (platform === "win32" && /\.(ps1|psm1)$/i.test(command)) {
    return {
      command: "powershell.exe",
      args: ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", command, ...args]
    };
  }

  return { command, args };
}

/**
 * Injected dependencies for {@link makeWindowsIsabellePathLookup}. Kept
 * tiny so tests can wire a memory-backed fake without touching the disk.
 */
export interface IsabellePathLookupDeps {
  /** Returns the value of the PATH environment variable, or undefined. */
  readonly readPath: () => string | undefined;
  /** Returns true if path is a regular file (or symlink to one). */
  readonly isFile: (p: string) => boolean;
  /** Platform-appropriate PATH separator (`;` on Windows, `:` elsewhere). */
  readonly pathDelimiter: string;
  /** Path join function. */
  readonly join: (...parts: string[]) => string;
}

/**
 * Extensions to try, in order, when searching PATH for the Isabelle
 * launcher on Windows. `.ps1` is first because the upstream Isabelle
 * Windows distribution ships ONLY that launcher; `.cmd`/`.exe`/`.bat`
 * are listed afterwards so third-party packagers that ship a real
 * `.cmd` shim are still discovered.
 */
const WINDOWS_LAUNCHER_EXTENSIONS = [".ps1", ".cmd", ".exe", ".bat"] as const;

/**
 * Build a Windows-flavored PATH lookup for the Isabelle launcher. Scans
 * every PATH directory for `<name>.ps1`, `<name>.cmd`, `<name>.exe`,
 * `<name>.bat` (in that order) and returns the first absolute path that
 * exists as a regular file. Returns `undefined` when nothing matches or
 * when PATH is unset.
 *
 * Search order is "directory × extension": for each directory in PATH (in
 * the order PATH lists them), every extension in
 * {@link WINDOWS_LAUNCHER_EXTENSIONS} is tried before moving to the next
 * directory. This means a `.cmd` in the first PATH directory wins over a
 * `.ps1` in a later directory, which matches what `where.exe isabelle`
 * would report; but within a single directory `.ps1` is preferred so the
 * upstream Isabelle Windows launcher is picked up out of the box.
 *
 * PATH is read once at factory time and cached as a directory list. The
 * returned function is pure with respect to its captured `deps`; tests
 * pass an in-memory fake so the scan does not touch the disk.
 *
 * Pure helper: no `vscode`, no `child_process`. Safe to import from tests.
 */
export function makeWindowsIsabellePathLookup(
  deps: IsabellePathLookupDeps
): (name: string) => string | undefined {
  const rawPath = deps.readPath();
  if (typeof rawPath !== "string" || rawPath.length === 0) {
    return () => undefined;
  }
  const directories = rawPath
    .split(deps.pathDelimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (directories.length === 0) {
    return () => undefined;
  }
  return (name: string): string | undefined => {
    if (!isBareExecutableName(name)) {
      return undefined;
    }
    for (const directory of directories) {
      for (const extension of WINDOWS_LAUNCHER_EXTENSIONS) {
        const candidate = deps.join(directory, `${name}${extension}`);
        if (deps.isFile(candidate)) {
          return candidate;
        }
      }
    }
    return undefined;
  };
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
