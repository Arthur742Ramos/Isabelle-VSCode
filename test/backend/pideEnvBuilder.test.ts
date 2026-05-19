import * as path from "path";
import { describe, expect, it } from "vitest";
import { buildPideEnv } from "../../src/backend/pideEnvBuilder";

// path.resolve on Windows prefixes a drive letter; strip it so the
// fake fs lookup table matches against the POSIX-style fixture keys.
function normalize(p: string): string {
  return p.replace(/\\/g, "/").replace(/^[A-Za-z]:/, "");
}

const fakeDeps = (existing: Set<string>) => ({
  exists: (p: string) => existing.has(normalize(p))
});

function expectedHome(home: string): string {
  // path.resolve on the test's POSIX-style home produces drive-prefixed on
  // Windows and slash-prefixed on POSIX. Both reduce to the same normalize
  // result so callers can compare against the original fixture string.
  return normalize(path.resolve(home));
}

describe("buildPideEnv", () => {
  it("derives ISABELLE_HOME/ISABELLE_ROOT from executablePath when etc/ISABELLE_IDENTIFIER exists upstream", () => {
    const home = "/opt/Isabelle2025-2";
    const exe = `${home}/bin/isabelle`;
    const result = buildPideEnv(
      {
        baseEnv: {},
        isabelleExecutablePath: exe,
        globalStorageDir: "/tmp/storage",
        maxHeapMb: 0,
        platform: "linux"
      },
      fakeDeps(new Set([`${home}/etc/ISABELLE_IDENTIFIER`]))
    );
    expect(normalize(result.resolvedHome ?? "")).toBe(expectedHome(home));
    expect(normalize(result.env.ISABELLE_HOME ?? "")).toBe(expectedHome(home));
    expect(normalize(result.env.ISABELLE_ROOT ?? "")).toBe(expectedHome(home));
    expect(result.env.BACKEND_SCRATCH_DIR).toBe("/tmp/storage");
    // CYGWIN_ROOT only on Windows.
    expect(result.env.CYGWIN_ROOT).toBeUndefined();
    // No -Xmx with maxHeapMb=0.
    expect(result.jvmArgs).toEqual([]);
  });

  it("sets CYGWIN_ROOT to <home>/contrib/cygwin on Windows when present", () => {
    const home = "/opt/Isabelle2025-2";
    const exe = `${home}/bin/isabelle.ps1`;
    const result = buildPideEnv(
      {
        baseEnv: {},
        isabelleExecutablePath: exe,
        globalStorageDir: "",
        maxHeapMb: 0,
        platform: "win32"
      },
      fakeDeps(new Set([`${home}/etc/ISABELLE_IDENTIFIER`, `${home}/contrib/cygwin`]))
    );
    expect(normalize(result.env.CYGWIN_ROOT ?? "")).toBe(expectedHome(home + "/contrib/cygwin"));
    expect(normalize(result.resolvedCygwinRoot ?? "")).toBe(expectedHome(home + "/contrib/cygwin"));
  });

  it("does not set CYGWIN_ROOT on Windows when contrib/cygwin is absent", () => {
    const home = "/opt/Isabelle2025-2";
    const result = buildPideEnv(
      {
        baseEnv: {},
        isabelleExecutablePath: `${home}/bin/isabelle.ps1`,
        globalStorageDir: "",
        maxHeapMb: 0,
        platform: "win32"
      },
      fakeDeps(new Set([`${home}/etc/ISABELLE_IDENTIFIER`]))
    );
    expect(result.env.CYGWIN_ROOT).toBeUndefined();
    expect(result.resolvedCygwinRoot).toBeUndefined();
  });

  it("prefers ISABELLE_HOME env var over executable-derived path", () => {
    const result = buildPideEnv(
      {
        baseEnv: { ISABELLE_HOME: "/opt/IsabelleEnv" },
        isabelleExecutablePath: "/opt/IsabelleExe/bin/isabelle",
        globalStorageDir: "",
        maxHeapMb: 0,
        platform: "linux"
      },
      fakeDeps(new Set([
        "/opt/IsabelleExe/etc/ISABELLE_IDENTIFIER",
        "/opt/IsabelleEnv/etc/ISABELLE_IDENTIFIER"
      ]))
    );
    expect(result.resolvedHome).toBe("/opt/IsabelleEnv");
    expect(result.env.ISABELLE_HOME).toBe("/opt/IsabelleEnv");
  });

  it("returns undefined home when executablePath is the bare 'isabelle' PATH lookup", () => {
    const result = buildPideEnv(
      {
        baseEnv: {},
        isabelleExecutablePath: "isabelle",
        globalStorageDir: "/tmp/storage",
        maxHeapMb: 0,
        platform: "linux"
      },
      fakeDeps(new Set())
    );
    expect(result.resolvedHome).toBeUndefined();
    expect(result.env.ISABELLE_HOME).toBeUndefined();
    // BACKEND_SCRATCH_DIR still set so the backend can stage files even without PIDE.
    expect(result.env.BACKEND_SCRATCH_DIR).toBe("/tmp/storage");
  });

  it("adds -Xmx<N>m JVM arg when maxHeapMb is positive", () => {
    const result = buildPideEnv(
      {
        baseEnv: {},
        isabelleExecutablePath: "isabelle",
        globalStorageDir: "",
        maxHeapMb: 4096,
        platform: "linux"
      },
      fakeDeps(new Set())
    );
    expect(result.jvmArgs).toEqual(["-Xmx4096m"]);
  });

  it("rounds fractional maxHeapMb down to an integer", () => {
    const result = buildPideEnv(
      {
        baseEnv: {},
        isabelleExecutablePath: "isabelle",
        globalStorageDir: "",
        maxHeapMb: 2048.9,
        platform: "linux"
      },
      fakeDeps(new Set())
    );
    expect(result.jvmArgs).toEqual(["-Xmx2048m"]);
  });

  it("walks up ancestor directories looking for etc/ISABELLE_IDENTIFIER (macOS bundle layout)", () => {
    const home = "/Applications/Isabelle2025-2.app/Isabelle/Isabelle2025-2";
    const exe = `${home}/Contents/Resources/Isabelle/bin/isabelle`;
    const result = buildPideEnv(
      {
        baseEnv: {},
        isabelleExecutablePath: exe,
        globalStorageDir: "",
        maxHeapMb: 0,
        platform: "darwin"
      },
      fakeDeps(new Set([`${home}/etc/ISABELLE_IDENTIFIER`]))
    );
    expect(normalize(result.resolvedHome ?? "")).toBe(expectedHome(home));
  });
});
