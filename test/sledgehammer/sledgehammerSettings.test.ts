import { describe, expect, it } from "vitest";
import {
  SledgehammerSettingsConfig,
  buildPideSledgehammerRequestParams,
  normalizeProversString,
  readSledgehammerSettings,
  resolveSledgehammerProvers
} from "../../src/sledgehammer/sledgehammerSettings";

// Builds a tiny `vscode.workspace.getConfiguration("isabelle")`-shaped
// stub so the reader can be exercised without touching the VS Code API.
// Keys in `values` are written with the same `sledgehammer.*` shape
// the production reader passes to `config.get(...)`.
function makeConfig(values: Readonly<Record<string, unknown>>): SledgehammerSettingsConfig {
  return {
    get<T>(section: string, defaultValue: T): T {
      if (Object.prototype.hasOwnProperty.call(values, section)) {
        return values[section] as T;
      }
      return defaultValue;
    }
  };
}

describe("normalizeProversString", () => {
  it("returns an empty string for an empty input", () => {
    expect(normalizeProversString("")).toBe("");
  });

  it("returns an empty string for a whitespace-only input", () => {
    expect(normalizeProversString("   \t\n  ")).toBe("");
  });

  it("preserves a single token verbatim", () => {
    expect(normalizeProversString("cvc5")).toBe("cvc5");
  });

  it("collapses interior whitespace runs to single spaces", () => {
    expect(normalizeProversString("cvc5   verit\tz3")).toBe("cvc5 verit z3");
  });

  it("trims leading and trailing whitespace", () => {
    expect(normalizeProversString("  cvc5 verit  ")).toBe("cvc5 verit");
  });

  it("drops empty tokens produced by consecutive separators", () => {
    expect(normalizeProversString("a  b   c")).toBe("a b c");
  });
});

describe("readSledgehammerSettings", () => {
  it("returns schema defaults when nothing is configured", () => {
    const config = makeConfig({});
    expect(readSledgehammerSettings(config)).toEqual({
      provers: "",
      isar: false,
      try0: true
    });
  });

  it("reads non-default values when the user has overridden them", () => {
    const config = makeConfig({
      "sledgehammer.provers": " cvc5 verit ",
      "sledgehammer.isar": true,
      "sledgehammer.try0": false
    });
    expect(readSledgehammerSettings(config)).toEqual({
      provers: "cvc5 verit",
      isar: true,
      try0: false
    });
  });

  it("normalizes the provers string at read time", () => {
    // Anything that goes through readSledgehammerSettings must come
    // out whitespace-clean so downstream callers (PIDE request params
    // builder, provers cache, etc.) never see ragged input.
    const config = makeConfig({
      "sledgehammer.provers": "cvc5   verit\tz3 \n e"
    });
    expect(readSledgehammerSettings(config).provers).toBe("cvc5 verit z3 e");
  });

  it("coerces non-string provers values to an empty string", () => {
    const config = makeConfig({
      "sledgehammer.provers": 42 as unknown as string
    });
    expect(readSledgehammerSettings(config).provers).toBe("");
  });

  it("coerces non-boolean isar/try0 values to their schema defaults", () => {
    const config = makeConfig({
      "sledgehammer.isar": "true" as unknown as boolean,
      "sledgehammer.try0": 0 as unknown as boolean
    });
    expect(readSledgehammerSettings(config)).toEqual({
      provers: "",
      isar: false,
      try0: true
    });
  });
});

describe("resolveSledgehammerProvers", () => {
  it("prefers the configured override when it is non-empty", () => {
    expect(resolveSledgehammerProvers("cvc5 e", "verit z3")).toBe("cvc5 e");
  });

  it("falls back to the cached list when the configured value is empty", () => {
    expect(resolveSledgehammerProvers("", "verit z3")).toBe("verit z3");
  });

  it("returns an empty string when neither configured nor fallback are set", () => {
    expect(resolveSledgehammerProvers("", "")).toBe("");
    expect(resolveSledgehammerProvers("", undefined)).toBe("");
  });

  it("normalizes both configured and fallback inputs", () => {
    expect(resolveSledgehammerProvers("  ", "  z3   e ")).toBe("z3 e");
    expect(resolveSledgehammerProvers(" cvc5\tverit ", "z3 e")).toBe("cvc5 verit");
  });

  it("treats a whitespace-only configured value as empty", () => {
    expect(resolveSledgehammerProvers("   ", "verit")).toBe("verit");
  });
});

describe("buildPideSledgehammerRequestParams", () => {
  it("forwards isar and try0 from the settings verbatim", () => {
    const params = buildPideSledgehammerRequestParams(
      { provers: "cvc5", isar: true, try0: false },
      "verit"
    );
    expect(params).toEqual({ provers: "cvc5", isar: true, try0: false });
  });

  it("uses the fallback prover list when settings.provers is empty", () => {
    const params = buildPideSledgehammerRequestParams(
      { provers: "", isar: false, try0: true },
      "cvc5 verit z3 e spass vampire zipperposition"
    );
    expect(params.provers).toBe("cvc5 verit z3 e spass vampire zipperposition");
  });

  it("emits an empty provers string when both inputs are empty", () => {
    // An empty provers string is the documented signal for "let the
    // server pick its own defaults". The builder must NOT invent a
    // prover list of its own.
    const params = buildPideSledgehammerRequestParams(
      { provers: "", isar: false, try0: true },
      ""
    );
    expect(params.provers).toBe("");
  });

  it("accepts undefined fallback as 'no cached list available'", () => {
    const params = buildPideSledgehammerRequestParams(
      { provers: "cvc5", isar: false, try0: true },
      undefined
    );
    expect(params.provers).toBe("cvc5");
  });
});
