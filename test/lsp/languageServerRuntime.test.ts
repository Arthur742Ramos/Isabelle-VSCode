import { describe, expect, it } from "vitest";
import {
  RuntimeConfigSource,
  resolveLanguageServerRuntime
} from "../../src/lsp/languageServerRuntime";

/**
 * Build a `RuntimeConfigSource` fake that returns the supplied value
 * for `languageServer.extraArgs` and falls back to the requested
 * default for any other key. This keeps tests focused on the keys the
 * helper actually consumes today (only `languageServer.extraArgs`) and
 * fails loudly if a future change to the helper starts reading a new
 * key without coordinating with the auto-start failure-key consumer.
 */
function fakeConfig(extraArgsValue: unknown): RuntimeConfigSource {
  return {
    get<T>(section: string, defaultValue?: T): T | undefined {
      if (section === "languageServer.extraArgs") {
        return extraArgsValue as T;
      }
      return defaultValue;
    }
  };
}

describe("resolveLanguageServerRuntime", () => {
  it("returns the executable verbatim from the provider", () => {
    const runtime = resolveLanguageServerRuntime(() => "isabelle", fakeConfig([]));
    expect(runtime.executable).toBe("isabelle");
    expect(runtime.extraArgs).toEqual([]);
  });

  it("passes through a custom absolute executable path unchanged", () => {
    const runtime = resolveLanguageServerRuntime(
      () => "/opt/Isabelle2024/bin/isabelle",
      fakeConfig([])
    );
    expect(runtime.executable).toBe("/opt/Isabelle2024/bin/isabelle");
  });

  it("preserves surrounding whitespace in the executable (trim happens later in buildLanguageServerCommand)", () => {
    const runtime = resolveLanguageServerRuntime(() => "  isabelle  ", fakeConfig([]));
    // The helper intentionally does NOT trim: that's
    // buildLanguageServerCommand's responsibility, and the runtime
    // identity used for the failure key must match what doStart
    // observes pre-trim.
    expect(runtime.executable).toBe("  isabelle  ");
  });

  it("passes through an array of string extraArgs in order", () => {
    const runtime = resolveLanguageServerRuntime(
      () => "isabelle",
      fakeConfig(["-L", "./isabelle.log", "-v"])
    );
    expect(runtime.extraArgs).toEqual(["-L", "./isabelle.log", "-v"]);
  });

  it("filters non-string entries out of extraArgs defensively", () => {
    const runtime = resolveLanguageServerRuntime(
      () => "isabelle",
      // Users sometimes hand-edit settings.json with non-string values
      // (numbers, booleans, nulls). Drop them rather than coercing.
      fakeConfig(["-L", 42, null, true, "-v", undefined])
    );
    expect(runtime.extraArgs).toEqual(["-L", "-v"]);
  });

  it("returns an empty extraArgs list when the setting is not an array", () => {
    expect(resolveLanguageServerRuntime(() => "isabelle", fakeConfig(undefined)).extraArgs).toEqual(
      []
    );
    expect(resolveLanguageServerRuntime(() => "isabelle", fakeConfig(null)).extraArgs).toEqual([]);
    expect(
      resolveLanguageServerRuntime(() => "isabelle", fakeConfig("-L ./isabelle.log")).extraArgs
    ).toEqual([]);
    expect(
      resolveLanguageServerRuntime(() => "isabelle", fakeConfig({ "-L": "./isabelle.log" }))
        .extraArgs
    ).toEqual([]);
  });

  it("preserves empty strings inside extraArgs (typeof filter only, no length filter)", () => {
    // doStart's existing filter is `typeof value === "string"`, no
    // length check. Mirror that exactly so the failure key matches
    // the spawned runtime even when a user has a stray "" entry.
    const runtime = resolveLanguageServerRuntime(() => "isabelle", fakeConfig(["-L", "", "-v"]));
    expect(runtime.extraArgs).toEqual(["-L", "", "-v"]);
  });

  it("calls the executable-path provider on each invocation (no caching)", () => {
    let calls = 0;
    const runtime1 = resolveLanguageServerRuntime(
      () => {
        calls += 1;
        return calls === 1 ? "isabelle" : "/opt/Isabelle2024/bin/isabelle";
      },
      fakeConfig([])
    );
    expect(runtime1.executable).toBe("isabelle");
    expect(calls).toBe(1);
    // Calling the helper again must re-evaluate the provider so a
    // settings change is picked up between an attempted auto-start
    // and the matching failure-key write.
    const runtime2 = resolveLanguageServerRuntime(
      () => {
        calls += 1;
        return "/opt/Isabelle2024/bin/isabelle";
      },
      fakeConfig([])
    );
    expect(runtime2.executable).toBe("/opt/Isabelle2024/bin/isabelle");
    expect(calls).toBe(2);
  });
});
