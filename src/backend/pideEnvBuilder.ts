import * as fs from "fs";
import * as path from "path";

/**
 * Pure (vscode-free) builder for the env vars + JVM args the Phase 2a
 * PIDE bridge expects in the backend child process. Extracted from
 * {@link BackendManager} so vitest can pin the env-shaping rules
 * without a VS Code extension host.
 *
 * Producers:
 *   - `ISABELLE_HOME`, `ISABELLE_ROOT`: resolved Isabelle install
 *     root. Both env-var names are set because `isabelle.setup.Environment`
 *     looks up `ISABELLE_ROOT` while the rest of the Isabelle code
 *     inspects `ISABELLE_HOME` indirectly via the Settings map.
 *   - `CYGWIN_ROOT` (Windows only): `<home>/contrib/cygwin` if that
 *     directory exists; otherwise unset (backend reports the missing
 *     dependency itself).
 *   - `BACKEND_SCRATCH_DIR`: VS Code's `context.globalStorageUri.fsPath`
 *     — the per-extension, cross-platform, auto-cleaned-on-uninstall
 *     scratch root the PIDE bridge uses to stage theory text.
 *   - `-Xmx<N>m` JVM arg when `maxHeapMb > 0`; omitted (= JVM
 *     ergonomics defaults to 25% of system RAM, capped) when the
 *     setting is 0 / unset.
 */
export interface PideEnvDeps {
  /** Test seam: pure filesystem check. Production wires to `fs.existsSync`. */
  readonly exists: (p: string) => boolean;
}

export interface PideEnvOptions {
  readonly baseEnv: NodeJS.ProcessEnv;
  readonly isabelleExecutablePath: string;
  readonly globalStorageDir: string;
  readonly maxHeapMb: number;
  readonly platform: NodeJS.Platform;
}

export interface PideEnvResult {
  readonly env: NodeJS.ProcessEnv;
  readonly jvmArgs: string[];
  readonly resolvedHome: string | undefined;
  readonly resolvedCygwinRoot: string | undefined;
}

export const realPideEnvDeps: PideEnvDeps = {
  exists(p: string): boolean {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  }
};

export function buildPideEnv(options: PideEnvOptions, deps: PideEnvDeps = realPideEnvDeps): PideEnvResult {
  const overrides: NodeJS.ProcessEnv = {};

  const home = deriveHome(options.isabelleExecutablePath, options.baseEnv, deps);
  if (home) {
    overrides.ISABELLE_HOME = home;
    overrides.ISABELLE_ROOT = home;
    if (options.platform === "win32") {
      const cygwin = path.join(home, "contrib", "cygwin");
      if (deps.exists(cygwin)) {
        overrides.CYGWIN_ROOT = cygwin;
      }
    }
  }

  if (options.globalStorageDir && options.globalStorageDir.length > 0) {
    overrides.BACKEND_SCRATCH_DIR = options.globalStorageDir;
  }

  const jvmArgs: string[] = [];
  if (Number.isFinite(options.maxHeapMb) && options.maxHeapMb > 0) {
    jvmArgs.push(`-Xmx${Math.floor(options.maxHeapMb)}m`);
  }

  return {
    env: Object.assign({}, options.baseEnv, overrides),
    jvmArgs,
    resolvedHome: home,
    resolvedCygwinRoot:
      options.platform === "win32" ? overrides.CYGWIN_ROOT : undefined
  };
}

/**
 * Resolve `<ISABELLE_HOME>` from an Isabelle launcher path. Walks up
 * to 5 parent directories looking for `etc/ISABELLE_IDENTIFIER`. Used
 * by [[buildPideEnv]] when the user has set `isabelle.executablePath`
 * to a real install (not the default `"isabelle"` PATH lookup). The
 * env var `ISABELLE_HOME` takes precedence if already set.
 */
function deriveHome(
  isabelleExecutablePath: string,
  baseEnv: NodeJS.ProcessEnv,
  deps: PideEnvDeps
): string | undefined {
  const fromEnv = baseEnv.ISABELLE_HOME;
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv;
  }
  if (!isabelleExecutablePath || isabelleExecutablePath === "isabelle") {
    return undefined;
  }
  let current = path.resolve(isabelleExecutablePath);
  for (let depth = 0; depth <= 8; depth++) {
    const identifier = path.join(current, "etc", "ISABELLE_IDENTIFIER");
    if (deps.exists(identifier)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return undefined;
}
