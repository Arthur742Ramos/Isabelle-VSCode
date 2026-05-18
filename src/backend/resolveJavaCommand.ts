import * as path from "path";

/**
 * Pure helper that decides which `java` binary the extension should launch.
 *
 * Per-platform per-`.vsix` distributions bundle an Eclipse Temurin 21 JRE
 * at `extension/jre/` so end users don't need a system Java install.
 * `BackendManager` and `PrerequisiteChecker` consult this helper to pick
 * between the bundled binary and a PATH `"java"` fallback.
 *
 * The bundled candidate lives at:
 *   - Windows:        `<extensionPath>/jre/bin/java.exe`
 *   - macOS:          `<extensionPath>/jre/Contents/Home/bin/java`
 *   - Linux & other POSIX: `<extensionPath>/jre/bin/java`
 *
 * macOS deliberately keeps the vendor `Contents/Home/` layout so any
 * Eclipse Adoptium-signed binaries stay where Apple expects them; we do not
 * flatten directories whose internal structure we don't fully understand.
 *
 * Validation: the candidate must exist, be a regular file, and (on POSIX)
 * be executable. If any check fails, the helper returns plain `"java"` so
 * a working PATH Java still gets used. This protects against:
 *   - Stale local `jre/` left over from a previous platform's build.
 *   - Corrupt extraction that produced a directory at `bin/java`.
 *   - Missing execute bit after a sloppy archive extraction.
 *
 * The helper is intentionally synchronous and side-effect-free so it can be
 * called from both an activation-time prereq probe and a lazy backend
 * launch without spawning a probe process up-front. A future bug where a
 * bundled JRE passes filesystem validation but fails at launch surfaces as
 * a normal backend-launch error — the same way a broken PATH `java` would.
 */

export interface JavaResolveDeps {
  /**
   * Returns `true` iff the path resolves to a regular file that the current
   * process can execute. On Windows this collapses to a plain isFile check
   * (Windows treats `.exe` as executable by extension); on POSIX targets it
   * must also confirm the `X_OK` access bit.
   */
  readonly isExecutableFile: (p: string) => boolean;
}

/** Compute the candidate bundled-JRE `java` path for a given platform. */
export function bundledJavaCandidate(
  extensionPath: string,
  platform: NodeJS.Platform
): string {
  if (platform === "win32") {
    return path.join(extensionPath, "jre", "bin", "java.exe");
  }
  if (platform === "darwin") {
    return path.join(extensionPath, "jre", "Contents", "Home", "bin", "java");
  }
  return path.join(extensionPath, "jre", "bin", "java");
}

/**
 * Return the absolute path to the bundled `java` binary when it is present
 * and executable; otherwise return the literal `"java"` so the command
 * resolves via PATH at spawn time.
 */
export function resolveJavaCommand(
  extensionPath: string,
  platform: NodeJS.Platform,
  deps: JavaResolveDeps
): string {
  const candidate = bundledJavaCandidate(extensionPath, platform);
  if (deps.isExecutableFile(candidate)) {
    return candidate;
  }
  return "java";
}
