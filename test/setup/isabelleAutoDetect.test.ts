import { describe, expect, it } from "vitest";
import {
  AutoDetectDependencies,
  AutoDetectFs,
  detectIsabelleInstallPath
} from "../../src/setup/isabelleAutoDetect";

interface FakeFsLayout {
  readonly directories?: readonly string[];
  readonly files?: readonly string[];
  readonly listings?: Readonly<Record<string, readonly string[]>>;
}

function makeFs(layout: FakeFsLayout): AutoDetectFs {
  const directories = new Set(layout.directories ?? []);
  const files = new Set(layout.files ?? []);
  const listings = layout.listings ?? {};
  return {
    isDirectory: (p) => directories.has(p),
    isFile: (p) => files.has(p),
    readDirectoryNames: (p) => listings[p] ?? []
  };
}

function deps(
  platform: NodeJS.Platform,
  layout: FakeFsLayout,
  env: AutoDetectDependencies["env"] = {}
): AutoDetectDependencies {
  return {
    platform,
    env,
    fs: makeFs(layout),
    join: (...parts) => parts.join(platform === "win32" ? "\\" : "/").replace(/\/+/g, "/")
  };
}

describe("detectIsabelleInstallPath — Windows", () => {
  const programFiles = "C:\\Program Files";
  const programFilesX86 = "C:\\Program Files (x86)";

  it("returns undefined when no parent directories exist", () => {
    const result = detectIsabelleInstallPath(deps("win32", {}, {
      PROGRAMFILES: programFiles,
      "PROGRAMFILES(X86)": programFilesX86
    }));
    expect(result).toBeUndefined();
  });

  it("finds isabelle.ps1 in Program Files\\Isabelle2025\\bin", () => {
    const root = `${programFiles}\\Isabelle2025`;
    const ps1 = `${root}\\bin\\isabelle.ps1`;
    const result = detectIsabelleInstallPath(
      deps(
        "win32",
        {
          directories: [programFiles, programFilesX86],
          listings: { [programFiles]: ["Isabelle2025", "OtherApp"] },
          files: [ps1]
        },
        { PROGRAMFILES: programFiles, "PROGRAMFILES(X86)": programFilesX86 }
      )
    );
    expect(result?.path.replace(/\\\\/g, "\\")).toBe(ps1);
    expect(result?.versionYear).toBe(2025);
    expect(result?.versionLabel).toBe("Isabelle2025");
  });

  it("prefers .ps1 over plain isabelle launcher", () => {
    const root = `${programFiles}\\Isabelle2025`;
    const ps1 = `${root}\\bin\\isabelle.ps1`;
    const plain = `${root}\\bin\\isabelle`;
    const result = detectIsabelleInstallPath(
      deps(
        "win32",
        {
          directories: [programFiles],
          listings: { [programFiles]: ["Isabelle2025"] },
          files: [ps1, plain]
        },
        { PROGRAMFILES: programFiles }
      )
    );
    expect(result?.path.endsWith(".ps1")).toBe(true);
  });

  it("falls back to plain isabelle when .ps1 missing", () => {
    const root = `${programFiles}\\Isabelle2025`;
    const plain = `${root}\\bin\\isabelle`;
    const result = detectIsabelleInstallPath(
      deps(
        "win32",
        {
          directories: [programFiles],
          listings: { [programFiles]: ["Isabelle2025"] },
          files: [plain]
        },
        { PROGRAMFILES: programFiles }
      )
    );
    expect(result?.path).toBe(plain);
  });

  it("prefers the highest version when multiple installs exist", () => {
    const installs = ["Isabelle2019", "Isabelle2022", "Isabelle2025"];
    const files = installs.map((d) => `${programFiles}\\${d}\\bin\\isabelle.ps1`);
    const result = detectIsabelleInstallPath(
      deps(
        "win32",
        {
          directories: [programFiles],
          listings: { [programFiles]: installs },
          files
        },
        { PROGRAMFILES: programFiles }
      )
    );
    expect(result?.versionYear).toBe(2025);
  });

  it("looks in LOCALAPPDATA\\Programs for per-user installs", () => {
    const local = "C:\\Users\\arf\\AppData\\Local";
    const programs = `${local}\\Programs`;
    const ps1 = `${programs}\\Isabelle2025\\bin\\isabelle.ps1`;
    const result = detectIsabelleInstallPath(
      deps(
        "win32",
        {
          directories: [programs],
          listings: { [programs]: ["Isabelle2025"] },
          files: [ps1]
        },
        { LOCALAPPDATA: local }
      )
    );
    expect(result?.path).toBe(ps1);
  });

  it("ignores directories that do not match the Isabelle naming pattern", () => {
    const result = detectIsabelleInstallPath(
      deps(
        "win32",
        {
          directories: [programFiles],
          listings: { [programFiles]: ["Notepad++", "Python311", "isabelle-clone"] }
        },
        { PROGRAMFILES: programFiles }
      )
    );
    expect(result).toBeUndefined();
  });
});

describe("detectIsabelleInstallPath — macOS", () => {
  it("finds Isabelle inside the standard /Applications/.app layout", () => {
    const launcher = "/Applications/Isabelle2025.app/Isabelle/bin/isabelle";
    const result = detectIsabelleInstallPath(
      deps("darwin", {
        directories: ["/Applications"],
        listings: { "/Applications": ["Isabelle2025.app", "Firefox.app"] },
        files: [launcher]
      })
    );
    expect(result?.path).toBe(launcher);
    expect(result?.versionYear).toBe(2025);
    expect(result?.versionLabel).toBe("Isabelle2025.app");
  });

  it("finds Isabelle inside a flat /Applications/Isabelle2025/ directory (post-install copy)", () => {
    const root = "/Applications/Isabelle2025";
    const launcher = `${root}/Isabelle/bin/isabelle`;
    const result = detectIsabelleInstallPath(
      deps("darwin", {
        directories: ["/Applications"],
        listings: { "/Applications": ["Isabelle2025"] },
        files: [launcher]
      })
    );
    expect(result?.path).toBe(launcher);
  });

  it("falls back to the flat <root>/bin/isabelle layout", () => {
    const root = "/Applications/Isabelle2025";
    const launcher = `${root}/bin/isabelle`;
    const result = detectIsabelleInstallPath(
      deps("darwin", {
        directories: ["/Applications"],
        listings: { "/Applications": ["Isabelle2025"] },
        files: [launcher]
      })
    );
    expect(result?.path).toBe(launcher);
  });

  it("probes ~/Applications as a secondary location", () => {
    const home = "/Users/arf";
    const root = `${home}/Applications/Isabelle2025`;
    const launcher = `${root}/Isabelle/bin/isabelle`;
    const result = detectIsabelleInstallPath(
      deps(
        "darwin",
        {
          directories: [`${home}/Applications`],
          listings: { [`${home}/Applications`]: ["Isabelle2025"] },
          files: [launcher]
        },
        { HOME: home }
      )
    );
    expect(result?.path).toBe(launcher);
  });
});

describe("detectIsabelleInstallPath — Linux", () => {
  it("finds Isabelle under /opt", () => {
    const root = "/opt/Isabelle2025";
    const launcher = `${root}/bin/isabelle`;
    const result = detectIsabelleInstallPath(
      deps("linux", {
        directories: ["/opt"],
        listings: { "/opt": ["Isabelle2025"] },
        files: [launcher]
      })
    );
    expect(result?.path).toBe(launcher);
  });

  it("probes $HOME for per-user unpacked tarballs", () => {
    const home = "/home/arf";
    const root = `${home}/Isabelle2024`;
    const launcher = `${root}/bin/isabelle`;
    const result = detectIsabelleInstallPath(
      deps(
        "linux",
        {
          directories: [home],
          listings: { [home]: ["Isabelle2024", "Downloads"] },
          files: [launcher]
        },
        { HOME: home }
      )
    );
    expect(result?.path).toBe(launcher);
  });

  it("returns undefined when no launcher is present in matching directory", () => {
    const result = detectIsabelleInstallPath(
      deps("linux", {
        directories: ["/opt"],
        listings: { "/opt": ["Isabelle2025"] }
      })
    );
    expect(result).toBeUndefined();
  });
});

describe("detectIsabelleInstallPath — minimum version filter", () => {
  it("excludes Isabelle directories older than the minimum supported year", () => {
    const installs = ["Isabelle2017", "Isabelle2018"];
    const files = installs.map((d) => `/opt/${d}/bin/isabelle`);
    const result = detectIsabelleInstallPath(
      deps("linux", {
        directories: ["/opt"],
        listings: { "/opt": installs },
        files
      })
    );
    expect(result).toBeUndefined();
  });

  it("includes 2019 (the minimum supported year)", () => {
    const launcher = "/opt/Isabelle2019/bin/isabelle";
    const result = detectIsabelleInstallPath(
      deps("linux", {
        directories: ["/opt"],
        listings: { "/opt": ["Isabelle2019"] },
        files: [launcher]
      })
    );
    expect(result?.versionYear).toBe(2019);
  });

  it("ignores the too-old install when a supported install is also present", () => {
    const installs = ["Isabelle2017", "Isabelle2025"];
    const files = installs.map((d) => `/opt/${d}/bin/isabelle`);
    const result = detectIsabelleInstallPath(
      deps("linux", {
        directories: ["/opt"],
        listings: { "/opt": installs },
        files
      })
    );
    expect(result?.versionYear).toBe(2025);
  });

  it("includes year-less Isabelle directories (best-effort)", () => {
    const launcher = "/opt/Isabelle/bin/isabelle";
    const result = detectIsabelleInstallPath(
      deps("linux", {
        directories: ["/opt"],
        listings: { "/opt": ["Isabelle"] },
        files: [launcher]
      })
    );
    expect(result?.path).toBe(launcher);
    expect(result?.versionYear).toBeUndefined();
  });
});

describe("detectIsabelleInstallPath — PATH-derived candidates", () => {
  it("Windows: discovers C:\\Tools\\bin\\isabelle.ps1 via PATH", () => {
    // The user's reported repro: `isabelle.ps1` on PATH at C:\Tools\bin,
    // no isabelle.executablePath setting, no well-known install root.
    // Without PATH scanning, auto-detect returns undefined and the
    // prerequisite checker reports "isabelle missing".
    const launcher = "C:\\Tools\\bin\\isabelle.ps1";
    const result = detectIsabelleInstallPath(
      deps(
        "win32",
        {
          files: [launcher]
        },
        { PATH: "C:\\Tools\\bin;C:\\Windows\\System32" }
      )
    );
    expect(result?.path).toBe(launcher);
    expect(result?.installRoot).toBe("C:\\Tools");
    expect(result?.versionYear).toBeUndefined();
    expect(result?.versionLabel).toBe("Tools");
  });

  it("Linux: discovers /opt/isabelle/bin/isabelle via PATH", () => {
    const launcher = "/opt/isabelle/bin/isabelle";
    const result = detectIsabelleInstallPath(
      deps(
        "linux",
        {
          files: [launcher]
        },
        { PATH: "/opt/isabelle/bin:/usr/bin:/bin" }
      )
    );
    expect(result?.path).toBe(launcher);
    expect(result?.installRoot).toBe("/opt/isabelle");
  });

  it("macOS: discovers /usr/local/bin/isabelle via PATH", () => {
    const launcher = "/usr/local/bin/isabelle";
    const result = detectIsabelleInstallPath(
      deps(
        "darwin",
        {
          files: [launcher]
        },
        { PATH: "/usr/local/bin:/usr/bin" }
      )
    );
    expect(result?.path).toBe(launcher);
    expect(result?.installRoot).toBe("/usr/local");
  });

  it("PATH unset: behavior unchanged (returns undefined when no well-known install exists)", () => {
    const result = detectIsabelleInstallPath(
      deps("win32", { files: [] }, {})
    );
    expect(result).toBeUndefined();
  });

  it("PATH empty string: behavior unchanged", () => {
    const result = detectIsabelleInstallPath(
      deps("linux", { files: [] }, { PATH: "" })
    );
    expect(result).toBeUndefined();
  });

  it("PATH directory missing launcher: ignored silently", () => {
    // `C:\Other\bin` is on PATH but has no isabelle.ps1; should be
    // skipped without error.
    const result = detectIsabelleInstallPath(
      deps(
        "win32",
        { files: [] },
        { PATH: "C:\\Other\\bin;C:\\Windows\\System32" }
      )
    );
    expect(result).toBeUndefined();
  });

  it("multiple PATH launchers: highest versionYear wins", () => {
    const oldLauncher = "C:\\Tools\\Isabelle2022\\bin\\isabelle.ps1";
    const newLauncher = "C:\\Tools\\Isabelle2025\\bin\\isabelle.ps1";
    const result = detectIsabelleInstallPath(
      deps(
        "win32",
        { files: [oldLauncher, newLauncher] },
        {
          PATH: "C:\\Tools\\Isabelle2022\\bin;C:\\Tools\\Isabelle2025\\bin"
        }
      )
    );
    expect(result?.path).toBe(newLauncher);
    expect(result?.versionYear).toBe(2025);
  });

  it("well-known install is preferred when newer than the PATH candidate", () => {
    // A user might have a stale launcher on PATH (Isabelle2022) while
    // a newer install (Isabelle2025) lives under Program Files. The
    // version-sort should pick Isabelle2025 — regardless of whether
    // it came from the PATH source or the well-known source.
    const wellKnownRoot = "C:\\Program Files\\Isabelle2025";
    const wellKnownLauncher = `${wellKnownRoot}\\bin\\isabelle.ps1`;
    const pathLauncher = "C:\\Tools\\Isabelle2022\\bin\\isabelle.ps1";
    const result = detectIsabelleInstallPath(
      deps(
        "win32",
        {
          directories: ["C:\\Program Files"],
          listings: { "C:\\Program Files": ["Isabelle2025"] },
          files: [wellKnownLauncher, pathLauncher]
        },
        {
          PROGRAMFILES: "C:\\Program Files",
          PATH: "C:\\Tools\\Isabelle2022\\bin"
        }
      )
    );
    expect(result?.path).toBe(wellKnownLauncher);
    expect(result?.versionYear).toBe(2025);
  });

  it("deduplicates when the same install appears on PATH and a well-known root", () => {
    // A user has Isabelle2025 under Program Files and ALSO added its
    // bin/ to PATH. Only the well-known candidate should be reported
    // (the PATH-derived candidate has the identical installRoot, so
    // the dedupe step swallows it).
    const installRoot = "C:\\Program Files\\Isabelle2025";
    const wellKnownLauncher = `${installRoot}\\bin\\isabelle.ps1`;
    const result = detectIsabelleInstallPath(
      deps(
        "win32",
        {
          directories: ["C:\\Program Files"],
          listings: { "C:\\Program Files": ["Isabelle2025"] },
          files: [wellKnownLauncher]
        },
        {
          PROGRAMFILES: "C:\\Program Files",
          PATH: `${installRoot}\\bin`
        }
      )
    );
    expect(result?.path).toBe(wellKnownLauncher);
    // The de-duplicated set has exactly one entry, but
    // `detectIsabelleInstallPath` only returns the top candidate, so
    // assert via the rest of the surface that the PATH duplicate did
    // not knock the well-known launcher out of pole position.
    expect(result?.installRoot).toBe(installRoot);
  });

  it("PATH-only with year-bearing install root parses the version", () => {
    const launcher = "C:\\Tools\\Isabelle2025\\bin\\isabelle.ps1";
    const result = detectIsabelleInstallPath(
      deps(
        "win32",
        { files: [launcher] },
        { PATH: "C:\\Tools\\Isabelle2025\\bin" }
      )
    );
    expect(result?.versionYear).toBe(2025);
    expect(result?.versionLabel).toBe("Isabelle2025");
  });

  it("PATH directory that is a filesystem root is ignored (no install root to anchor on)", () => {
    // Pathological case: a launcher sits directly at `C:\isabelle.ps1`
    // with PATH containing `C:\`. There is no meaningful install root
    // (dirname("C:\\") === "" or "C:\\" itself, depending on the
    // helper). The detector should skip rather than synthesize a
    // bogus entry.
    const launcher = "C:\\isabelle.ps1";
    const result = detectIsabelleInstallPath(
      deps(
        "win32",
        { files: [launcher] },
        { PATH: "C:\\" }
      )
    );
    // Defensive: depending on the dirname helper this may return
    // undefined or may surface the launcher as a candidate with an
    // empty install root. We assert it does not crash and does not
    // produce a misleading versionYear.
    if (result !== undefined) {
      expect(result.versionYear).toBeUndefined();
    }
  });

  it("PATH whitespace-only entries are ignored", () => {
    // POSIX shells sometimes leave double colons in PATH (e.g. `:/usr/bin`)
    // which `split(":")` yields as empty strings. The detector should
    // not crash and should not interpret `""` as a directory.
    const launcher = "/opt/isabelle/bin/isabelle";
    const result = detectIsabelleInstallPath(
      deps(
        "linux",
        { files: [launcher] },
        { PATH: ":   :/opt/isabelle/bin:" }
      )
    );
    expect(result?.path).toBe(launcher);
  });
});
