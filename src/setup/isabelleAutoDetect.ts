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
  /** Verbatim `PATH` environment variable (Node lowercases Windows `Path`
    * to `PATH` automatically). When present, directories on PATH are also
    * probed for an Isabelle launcher (`isabelle.ps1` on Windows,
    * `isabelle` elsewhere) so users with a launcher on PATH (e.g.
    * `C:\Tools\bin\isabelle.ps1`) are detected even if their install lives
    * outside the well-known roots. */
  readonly PATH?: string;
}

export interface AutoDetectDependencies {
  readonly platform: NodeJS.Platform;
  readonly env: AutoDetectEnv;
  readonly fs: AutoDetectFs;
  /** Path-join helper. Defaults to forward-slash semantics if absent. */
  readonly join: (...parts: string[]) => string;
  /** Platform PATH separator. Defaults to ";" on Windows, ":" elsewhere
    * when omitted. */
  readonly pathDelimiter?: string;
  /** Dirname helper that strips the trailing path component. Used to
    * walk from a launcher's `bin/` directory up to the install root.
    * Defaults to a string-based implementation when omitted. */
  readonly dirname?: (p: string) => string;
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
  const out: DetectedIsabelle[] = [];
  const seenInstallRoots = new Set<string>();

  const pushIfNovel = (candidate: DetectedIsabelle) => {
    if (seenInstallRoots.has(candidate.installRoot)) {
      return;
    }
    seenInstallRoots.add(candidate.installRoot);
    out.push(candidate);
  };

  const roots = parentDirectoriesForPlatform(deps);
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
      pushIfNovel({ path: launcher, installRoot, versionYear, versionLabel });
    }
  }

  for (const candidate of pathDirectoriesAsLauncherCandidates(deps)) {
    pushIfNovel(candidate);
  }

  return out;
}

/**
 * Scan `process.env.PATH` for directories that contain an Isabelle
 * launcher (`isabelle.ps1` on Windows, `isabelle` elsewhere) and surface
 * them as auto-detect candidates. The install root is inferred as the
 * parent of the bin directory (`<bin>/..`), and the version year is
 * best-effort extracted from the install root's basename.
 *
 * Why: users who install Isabelle into a non-standard location (e.g.
 * `C:\Tools\Isabelle2025\`) and put `C:\Tools\Isabelle2025\bin` on PATH
 * — or who unpack into `C:\Tools\` with `bin` on PATH — are invisible to
 * the well-known roots probe. Walking PATH covers those legitimate
 * installs without recursing into arbitrary filesystem trees.
 *
 * The shared `collectCandidates` dedupe (keyed on absolute `installRoot`)
 * ensures a single install showing up in both PATH and a well-known root
 * is reported once.
 */
function pathDirectoriesAsLauncherCandidates(
  deps: AutoDetectDependencies
): DetectedIsabelle[] {
  const rawPath = deps.env.PATH;
  if (typeof rawPath !== "string" || rawPath.length === 0) {
    return [];
  }
  const delimiter = deps.pathDelimiter ?? (deps.platform === "win32" ? ";" : ":");
  const launcherName = deps.platform === "win32" ? "isabelle.ps1" : "isabelle";
  const dirname = deps.dirname ?? defaultDirname;

  const directories = rawPath
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  const out: DetectedIsabelle[] = [];
  for (const directory of directories) {
    const launcher = deps.join(directory, launcherName);
    if (!deps.fs.isFile(launcher)) {
      continue;
    }
    const installRoot = dirname(directory);
    if (!installRoot || installRoot === directory) {
      // PATH directory is a filesystem root (`/`, `C:\`, ...). The
      // launcher exists but there is no meaningful parent install
      // directory to anchor a version label on; skip rather than
      // synthesize a misleading entry.
      continue;
    }
    const basename = lastPathSegment(installRoot);
    const { versionYear, versionLabel } = parseVersion(basename);
    out.push({
      path: launcher,
      installRoot,
      versionYear,
      versionLabel
    });
  }
  return out;
}

function defaultDirname(p: string): string {
  if (p.length === 0) {
    return "";
  }
  // Split on both forward and back slashes so the helper works on
  // Windows and POSIX without pulling in `node:path`.
  const lastSlash = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"));
  if (lastSlash <= 0) {
    return "";
  }
  return p.slice(0, lastSlash);
}

function lastPathSegment(p: string): string {
  if (p.length === 0) {
    return "";
  }
  const lastSlash = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"));
  if (lastSlash < 0) {
    return p;
  }
  return p.slice(lastSlash + 1);
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
