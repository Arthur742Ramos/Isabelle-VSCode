/**
 * Locate an existing Isabelle installation on disk when the configured
 * `isabelle` executable is not resolvable via `PATH`. The detector probes a
 * deliberately shallow, well-known set of locations per platform — it never
 * recurses into arbitrary user directories.
 *
 * Pure module: no `vscode`, no `child_process`, no direct `process`/`fs`
 * access. All dependencies are injected so tests can exercise every platform
 * branch on a single host.
 */

export interface DetectedIsabelle {
  /** Absolute path to the Isabelle launcher (`isabelle` or `isabelle.ps1`). */
  readonly path: string;
  /** Discovered install directory (parent of the launcher's `bin/`). */
  readonly installRoot: string;
  /** Parsed numeric edition like `2025` (best-effort, missing => no sort key). */
  readonly versionYear?: number;
  /** Original directory name, e.g. `Isabelle2025-RC4`. */
  readonly versionLabel?: string;
}

export interface AutoDetectFs {
  /** True if `path` exists and is a directory. */
  isDirectory(path: string): boolean;
  /** True if `path` exists and is a regular file. */
  isFile(path: string): boolean;
  /** Lexical directory listing; should not throw — return `[]` on error. */
  readDirectoryNames(path: string): readonly string[];
}

export interface AutoDetectEnv {
  readonly USERPROFILE?: string;
  readonly HOME?: string;
  readonly LOCALAPPDATA?: string;
  readonly PROGRAMFILES?: string;
  readonly "PROGRAMFILES(X86)"?: string;
}

export interface AutoDetectDependencies {
  readonly platform: NodeJS.Platform;
  readonly env: AutoDetectEnv;
  readonly fs: AutoDetectFs;
  /** Path-join helper. Defaults to forward-slash semantics if absent. */
  readonly join: (...parts: string[]) => string;
}

/**
 * Minimum Isabelle release year the extension supports. Older directories
 * are still recognized (so we can mention them in logs) but they are not
 * offered through the "Use it" toast — those builds predate the Scala
 * backend/JSON-RPC seams this extension depends on.
 */
export const MIN_ISABELLE_YEAR = 2019;

/**
 * Probe shallow well-known directories for an Isabelle installation.
 *
 * When multiple installations are detected, the one with the highest parsed
 * `versionYear` wins so that newer installations are preferred over older
 * ones left behind by previous upgrades.
 *
 * Returns `undefined` when no candidate is found. Never throws.
 */
export function detectIsabelleInstallPath(
  deps: AutoDetectDependencies
): DetectedIsabelle | undefined {
  const candidates = collectCandidates(deps).filter(
    (candidate) =>
      candidate.versionYear === undefined || candidate.versionYear >= MIN_ISABELLE_YEAR
  );
  if (candidates.length === 0) {
    return undefined;
  }
  candidates.sort((a, b) => {
    const ay = a.versionYear ?? -1;
    const by = b.versionYear ?? -1;
    if (ay !== by) {
      return by - ay;
    }
    return (b.versionLabel ?? "").localeCompare(a.versionLabel ?? "");
  });
  return candidates[0];
}

function collectCandidates(deps: AutoDetectDependencies): DetectedIsabelle[] {
  const roots = parentDirectoriesForPlatform(deps);
  const out: DetectedIsabelle[] = [];
  for (const root of roots) {
    if (!deps.fs.isDirectory(root)) {
      continue;
    }
    for (const entry of deps.fs.readDirectoryNames(root)) {
      if (!looksLikeIsabelleDirectory(entry)) {
        continue;
      }
      const installRoot = deps.join(root, entry);
      const launcher = findLauncher(deps, installRoot);
      if (!launcher) {
        continue;
      }
      const { versionYear, versionLabel } = parseVersion(entry);
      out.push({ path: launcher, installRoot, versionYear, versionLabel });
    }
  }
  return out;
}

function parentDirectoriesForPlatform(deps: AutoDetectDependencies): readonly string[] {
  switch (deps.platform) {
    case "win32": {
      const home = deps.env.USERPROFILE;
      const local = deps.env.LOCALAPPDATA;
      const programFiles = deps.env.PROGRAMFILES ?? "C:\\Program Files";
      const programFilesX86 = deps.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)";
      const parents = [programFiles, programFilesX86];
      if (local) {
        parents.push(deps.join(local, "Programs"));
      }
      if (home) {
        parents.push(deps.join(home, "AppData", "Local", "Programs"));
      }
      return dedupe(parents);
    }
    case "darwin": {
      const home = deps.env.HOME;
      const parents = ["/Applications"];
      if (home) {
        parents.push(deps.join(home, "Applications"));
      }
      return dedupe(parents);
    }
    default: {
      const home = deps.env.HOME;
      const parents = ["/opt", "/usr/local"];
      if (home) {
        parents.push(home);
      }
      return dedupe(parents);
    }
  }
}

function looksLikeIsabelleDirectory(name: string): boolean {
  return /^Isabelle(?:\d{4}|[-_]\d{4})/i.test(name) || /^Isabelle$/i.test(name);
}

function findLauncher(deps: AutoDetectDependencies, installRoot: string): string | undefined {
  if (deps.platform === "darwin") {
    const appCandidate = deps.join(installRoot, "Isabelle", "bin", "isabelle");
    if (deps.fs.isFile(appCandidate)) {
      return appCandidate;
    }
    const flatCandidate = deps.join(installRoot, "bin", "isabelle");
    if (deps.fs.isFile(flatCandidate)) {
      return flatCandidate;
    }
    return undefined;
  }

  if (deps.platform === "win32") {
    const ps1 = deps.join(installRoot, "bin", "isabelle.ps1");
    if (deps.fs.isFile(ps1)) {
      return ps1;
    }
    const noExt = deps.join(installRoot, "bin", "isabelle");
    if (deps.fs.isFile(noExt)) {
      return noExt;
    }
    return undefined;
  }

  const launcher = deps.join(installRoot, "bin", "isabelle");
  return deps.fs.isFile(launcher) ? launcher : undefined;
}

function parseVersion(entry: string): { versionYear?: number; versionLabel?: string } {
  const match = /(\d{4})/.exec(entry);
  if (!match) {
    return { versionLabel: entry };
  }
  const year = Number.parseInt(match[1], 10);
  if (!Number.isFinite(year)) {
    return { versionLabel: entry };
  }
  return { versionYear: year, versionLabel: entry };
}

function dedupe<T>(values: readonly T[]): readonly T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const v of values) {
    if (seen.has(v)) {
      continue;
    }
    seen.add(v);
    out.push(v);
  }
  return out;
}
