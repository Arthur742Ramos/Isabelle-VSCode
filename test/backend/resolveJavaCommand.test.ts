import { describe, expect, it } from "vitest";
import {
  bundledJavaCandidate,
  chooseJavaCommand,
  JavaResolveDeps,
  resolveJavaCommand
} from "../../src/backend/resolveJavaCommand";

function fsWithExecutables(executablePaths: readonly string[]): JavaResolveDeps {
  const exec = new Set(executablePaths);
  return {
    isExecutableFile: (p) => exec.has(p)
  };
}

describe("bundledJavaCandidate", () => {
  it("uses jre/bin/java.exe on Windows", () => {
    expect(bundledJavaCandidate("C:\\ext", "win32")).toMatch(/[\\/]jre[\\/]bin[\\/]java\.exe$/);
  });

  it("uses jre/Contents/Home/bin/java on macOS", () => {
    expect(bundledJavaCandidate("/Users/u/ext", "darwin")).toMatch(
      /[\\/]jre[\\/]Contents[\\/]Home[\\/]bin[\\/]java$/
    );
  });

  it("uses jre/bin/java on Linux and other POSIX targets", () => {
    expect(bundledJavaCandidate("/home/u/ext", "linux")).toMatch(/[\\/]jre[\\/]bin[\\/]java$/);
    expect(bundledJavaCandidate("/home/u/ext", "freebsd")).toMatch(/[\\/]jre[\\/]bin[\\/]java$/);
  });
});

describe("resolveJavaCommand", () => {
  it("returns the bundled candidate when it is executable (Linux)", () => {
    const candidate = bundledJavaCandidate("/home/u/ext", "linux");
    const resolved = resolveJavaCommand("/home/u/ext", "linux", fsWithExecutables([candidate]));
    expect(resolved).toBe(candidate);
  });

  it("returns the bundled candidate when it is executable (Windows)", () => {
    const candidate = bundledJavaCandidate("C:\\ext", "win32");
    const resolved = resolveJavaCommand("C:\\ext", "win32", fsWithExecutables([candidate]));
    expect(resolved).toBe(candidate);
  });

  it("returns the bundled candidate when it is executable (macOS, Contents/Home)", () => {
    const candidate = bundledJavaCandidate("/Users/u/ext", "darwin");
    const resolved = resolveJavaCommand(
      "/Users/u/ext",
      "darwin",
      fsWithExecutables([candidate])
    );
    expect(resolved).toBe(candidate);
    expect(resolved).toMatch(/Contents[\\/]Home[\\/]bin[\\/]java$/);
  });

  it("falls back to PATH 'java' when no bundled JRE is present", () => {
    const resolved = resolveJavaCommand("/home/u/ext", "linux", fsWithExecutables([]));
    expect(resolved).toBe("java");
  });

  it("falls back to PATH 'java' when the candidate exists but is not a regular executable file", () => {
    // The fs fake's isExecutableFile is what enforces "is a regular file +
    // X_OK"; a non-file or non-executable path produces `false`, so the
    // helper does not promote a stale directory at jre/bin/java/.
    const resolved = resolveJavaCommand("/home/u/ext", "linux", {
      isExecutableFile: () => false
    });
    expect(resolved).toBe("java");
  });

  it("does not look at the wrong platform's candidate (macOS does not match Linux layout)", () => {
    // A macOS extension whose only executable was at `jre/bin/java` (the
    // Linux layout) should not be picked up — the macOS resolver demands
    // the Contents/Home path.
    const linuxLayoutOnly = bundledJavaCandidate("/Users/u/ext", "linux");
    const resolved = resolveJavaCommand(
      "/Users/u/ext",
      "darwin",
      fsWithExecutables([linuxLayoutOnly])
    );
    expect(resolved).toBe("java");
  });
});

describe("chooseJavaCommand", () => {
  it("delegates to resolveJavaCommand when override is unset and a bundled JRE is present", () => {
    // No override + bundled JRE present + executable -> returns the
    // bundled path, matching the filesystem-only resolver.
    const candidate = bundledJavaCandidate("/home/u/ext", "linux");
    const resolved = chooseJavaCommand(
      undefined,
      "/home/u/ext",
      "linux",
      fsWithExecutables([candidate])
    );
    expect(resolved).toBe(candidate);
  });

  it("falls back to PATH 'java' when override is unset and no bundled JRE is present", () => {
    const resolved = chooseJavaCommand(
      undefined,
      "/home/u/ext",
      "linux",
      fsWithExecutables([])
    );
    expect(resolved).toBe("java");
  });

  it("prefers an explicit 'java' override over a bundled JRE that the filesystem accepts", () => {
    // This is the core case the prerequisite probe needs: the bundled
    // JRE is filesystem-executable, but the probe rejected it (e.g. for
    // being below MIN_JAVA_MAJOR_VERSION) and selected PATH "java"
    // instead. The override must win so backend launch matches the
    // validated runtime.
    const candidate = bundledJavaCandidate("/home/u/ext", "linux");
    const resolved = chooseJavaCommand(
      "java",
      "/home/u/ext",
      "linux",
      fsWithExecutables([candidate])
    );
    expect(resolved).toBe("java");
    expect(resolved).not.toBe(candidate);
  });

  it("returns an absolute-path override even when a different bundled candidate is present", () => {
    // The prereq probe can also accept an absolute path that differs
    // from the platform's default bundled layout (e.g. a user-injected
    // override from PrerequisiteCheckerDependencies.javaCommand). The
    // helper must honor it verbatim regardless of what the filesystem
    // resolver would have picked.
    const candidate = bundledJavaCandidate("/home/u/ext", "linux");
    const override = "/opt/temurin-21/bin/java";
    const resolved = chooseJavaCommand(
      override,
      "/home/u/ext",
      "linux",
      fsWithExecutables([candidate])
    );
    expect(resolved).toBe(override);
  });

  it("treats an empty-string override as 'unset' and falls through to the filesystem resolver", () => {
    // Pin the contract: only undefined or "" mean "no override". This
    // keeps callers from accidentally pinning the launch to "" when
    // they meant to clear a previously-set override.
    const candidate = bundledJavaCandidate("/home/u/ext", "linux");
    const resolvedWithBundled = chooseJavaCommand(
      "",
      "/home/u/ext",
      "linux",
      fsWithExecutables([candidate])
    );
    expect(resolvedWithBundled).toBe(candidate);

    const resolvedWithoutBundled = chooseJavaCommand(
      "",
      "/home/u/ext",
      "linux",
      fsWithExecutables([])
    );
    expect(resolvedWithoutBundled).toBe("java");
  });
});
