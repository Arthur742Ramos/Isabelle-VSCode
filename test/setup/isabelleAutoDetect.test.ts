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
  it("finds Isabelle inside the standard /Applications layout", () => {
    const root = "/Applications/Isabelle2025";
    const launcher = `${root}/Isabelle/bin/isabelle`;
    const result = detectIsabelleInstallPath(
      deps("darwin", {
        directories: ["/Applications"],
        listings: { "/Applications": ["Isabelle2025.app", "Isabelle2025", "Firefox.app"] },
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
