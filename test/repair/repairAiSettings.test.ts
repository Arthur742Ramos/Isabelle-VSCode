import { describe, expect, it } from "vitest";
import {
  decideRepairAiGate,
  readRepairAiSettings,
  RepairAiSettingsConfig
} from "../../src/repair/repairAiSettings";

function makeConfig(values: Readonly<Record<string, unknown>>): RepairAiSettingsConfig {
  return {
    get<T>(section: string, defaultValue: T): T {
      if (Object.prototype.hasOwnProperty.call(values, section)) {
        return values[section] as T;
      }
      return defaultValue;
    }
  };
}

describe("readRepairAiSettings", () => {
  it("returns defaults (empty provider, ack=false) when nothing is configured", () => {
    expect(readRepairAiSettings(makeConfig({}))).toEqual({
      providerId: "",
      acknowledgedSharing: false
    });
  });

  it("reads non-default values when both settings are set", () => {
    expect(
      readRepairAiSettings(
        makeConfig({
          "repair.aiProvider": "github-copilot",
          "repair.aiAcknowledgedSharing": true
        })
      )
    ).toEqual({
      providerId: "github-copilot",
      acknowledgedSharing: true
    });
  });

  it("trims whitespace from the providerId", () => {
    expect(
      readRepairAiSettings(
        makeConfig({ "repair.aiProvider": "   github-copilot   " })
      ).providerId
    ).toBe("github-copilot");
  });

  it("coerces non-string providerId values to the empty 'none' sentinel", () => {
    for (const value of [42, true, null, undefined, [], {}]) {
      expect(
        readRepairAiSettings(makeConfig({ "repair.aiProvider": value })).providerId
      ).toBe("");
    }
  });

  it("coerces non-boolean acknowledge flag values to false", () => {
    for (const value of ["true", 1, 0, null, undefined, [], {}]) {
      expect(
        readRepairAiSettings(
          makeConfig({ "repair.aiAcknowledgedSharing": value })
        ).acknowledgedSharing
      ).toBe(false);
    }
  });
});

describe("decideRepairAiGate", () => {
  it("refuses when no provider is configured (empty sentinel)", () => {
    const decision = decideRepairAiGate(
      { providerId: "", acknowledgedSharing: true },
      ["my-provider"]
    );
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.reason).toMatch(/No AI repair provider is configured/);
    }
  });

  it("refuses when the user has not acknowledged the sharing policy", () => {
    const decision = decideRepairAiGate(
      { providerId: "my-provider", acknowledgedSharing: false },
      ["my-provider"]
    );
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.reason).toMatch(/aiAcknowledgedSharing/);
      // Must explain WHAT acknowledging means so the user can decide.
      expect(decision.reason).toMatch(/may include source code/);
    }
  });

  it("refuses when the configured providerId is not registered", () => {
    const decision = decideRepairAiGate(
      { providerId: "unknown", acknowledgedSharing: true },
      ["my-provider", "another"]
    );
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.reason).toMatch(/no AI repair provider with id "unknown"/i);
      // Known providers should be listed so the user can correct the
      // setting without guessing.
      expect(decision.reason).toContain('"my-provider"');
      expect(decision.reason).toContain('"another"');
    }
  });

  it("refuses cleanly when no providers are registered at all", () => {
    const decision = decideRepairAiGate(
      { providerId: "my-provider", acknowledgedSharing: true },
      []
    );
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.reason).toMatch(/Known providers: none/);
    }
  });

  it("permits when provider is configured, registered, and ack is true", () => {
    const decision = decideRepairAiGate(
      { providerId: "my-provider", acknowledgedSharing: true },
      ["my-provider"]
    );
    expect(decision).toEqual({ ok: true });
  });

  it("treats acknowledge=true with empty providerId as 'no provider' rather than 'permitted'", () => {
    // Belt-and-braces: an ack without a target provider should still
    // refuse, with the 'no provider configured' message — never
    // emit a misleading 'permitted' for an empty target.
    const decision = decideRepairAiGate(
      { providerId: "", acknowledgedSharing: true },
      ["my-provider"]
    );
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.reason).toMatch(/No AI repair provider is configured/);
    }
  });
});
