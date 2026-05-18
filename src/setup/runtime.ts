import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import type { AutoDetectDependencies, AutoDetectFs } from "./isabelleAutoDetect";
import type { SpawnFn, SpawnRequest, SpawnResult } from "./PrerequisiteChecker";

/**
 * Production wiring for the setup module. Lives next to the pure module so
 * it stays trivial to swap in fakes from tests without dragging Node APIs
 * into the test runtime.
 */

/** Spawn `command` with a hard timeout. Never throws. */
export const realSpawn: SpawnFn = ({ command, args, timeoutMs }: SpawnRequest) =>
  new Promise<SpawnResult>((resolve) => {
    let settled = false;
    let timedOut = false;
    let stdout = "";
    let stderr = "";

    let child;
    try {
      child = spawn(command, [...args], {
        stdio: ["ignore", "pipe", "pipe"],
        // Match the existing process-launching code in this extension
        // (ProcessTransport, BuildService, IsabelleLanguageClient) so the
        // activation-time Java/Isabelle probes don't briefly flash console
        // windows on Windows.
        windowsHide: true
      });
    } catch {
      resolve({ exitCode: null, stdout: "", stderr: "", spawnFailed: true, timedOut: false });
      return;
    }

    const finalize = (result: SpawnResult) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      resolve(result);
    };

    // A child that ignores SIGTERM must not be able to keep activation
    // pending forever, so the timeout *resolves immediately* with a
    // timed-out result. A second timer follows up with SIGKILL so the
    // stranded process eventually goes away, but we don't wait for it.
    const effectiveTimeout = Math.max(500, timeoutMs);
    let killTimer: NodeJS.Timeout | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      finalize({ exitCode: null, stdout, stderr, spawnFailed: false, timedOut: true });
      killTimer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }, 2000);
      if (typeof (killTimer as NodeJS.Timeout).unref === "function") {
        (killTimer as NodeJS.Timeout).unref();
      }
    }, effectiveTimeout);

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on("error", () => {
      finalize({ exitCode: null, stdout, stderr, spawnFailed: true, timedOut });
    });
    child.on("close", (code) => {
      finalize({ exitCode: code, stdout, stderr, spawnFailed: false, timedOut });
    });
  });

/** Production filesystem facade for auto-detect. Best-effort, never throws. */
export const realAutoDetectFs: AutoDetectFs = {
  isDirectory(p: string): boolean {
    try {
      return fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  },
  isFile(p: string): boolean {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  },
  readDirectoryNames(p: string): readonly string[] {
    try {
      return fs.readdirSync(p);
    } catch {
      return [];
    }
  }
};

/** Bundle the auto-detect dependencies for the current Node process. */
export function realAutoDetectDependencies(): AutoDetectDependencies {
  return {
    platform: process.platform,
    env: {
      USERPROFILE: process.env.USERPROFILE,
      HOME: process.env.HOME,
      LOCALAPPDATA: process.env.LOCALAPPDATA,
      PROGRAMFILES: process.env["ProgramFiles"],
      "PROGRAMFILES(X86)": process.env["ProgramFiles(x86)"]
    },
    fs: realAutoDetectFs,
    join: (...parts: string[]) => path.join(...parts)
  };
}
