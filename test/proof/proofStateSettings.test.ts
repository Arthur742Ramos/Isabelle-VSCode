import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROOF_STATE_SETTINGS,
  MAX_MARGIN,
  MIN_MARGIN,
  ProofStateConfigurationReader,
  clampMargin,
  diffProofStateSettings,
  readProofStateSettings
} from "../../src/proof/proofStateSettings";

function makeReader(values: Record<string, unknown>): ProofStateConfigurationReader {
  return {
    get: <T>(section: string) => values[section] as T | undefined
  };
}

describe("clampMargin", () => {
  it("returns the input when within range", () => {
    expect(clampMargin(MIN_MARGIN)).toBe(MIN_MARGIN);
    expect(clampMargin(80)).toBe(80);
    expect(clampMargin(MAX_MARGIN)).toBe(MAX_MARGIN);
  });

  it("clamps below the minimum", () => {
    expect(clampMargin(-10)).toBe(MIN_MARGIN);
    expect(clampMargin(0)).toBe(MIN_MARGIN);
    expect(clampMargin(MIN_MARGIN - 1)).toBe(MIN_MARGIN);
  });

  it("clamps above the maximum", () => {
    expect(clampMargin(MAX_MARGIN + 1)).toBe(MAX_MARGIN);
    expect(clampMargin(10000)).toBe(MAX_MARGIN);
  });

  it("falls back to the default when given non-finite values", () => {
    expect(clampMargin(Number.NaN)).toBe(DEFAULT_PROOF_STATE_SETTINGS.proofStateMargin);
    expect(clampMargin(Number.POSITIVE_INFINITY)).toBe(
      DEFAULT_PROOF_STATE_SETTINGS.proofStateMargin
    );
    expect(clampMargin(Number.NEGATIVE_INFINITY)).toBe(
      DEFAULT_PROOF_STATE_SETTINGS.proofStateMargin
    );
  });
});

describe("readProofStateSettings", () => {
  it("returns defaults when no values are configured", () => {
    expect(readProofStateSettings(makeReader({}))).toEqual(DEFAULT_PROOF_STATE_SETTINGS);
  });

  it("reads autoUpdate as a boolean", () => {
    expect(readProofStateSettings(makeReader({ "proofState.autoUpdate": false })).autoUpdate).toBe(false);
  });

  it("falls back to the default when autoUpdate is the wrong type", () => {
    expect(
      readProofStateSettings(makeReader({ "proofState.autoUpdate": "no" })).autoUpdate
    ).toBe(DEFAULT_PROOF_STATE_SETTINGS.autoUpdate);
  });

  it("reads and clamps the proofState margin", () => {
    expect(
      readProofStateSettings(makeReader({ "proofState.margin": 120 })).proofStateMargin
    ).toBe(120);
    expect(
      readProofStateSettings(makeReader({ "proofState.margin": 10 })).proofStateMargin
    ).toBe(MIN_MARGIN);
    expect(
      readProofStateSettings(makeReader({ "proofState.margin": 9999 })).proofStateMargin
    ).toBe(MAX_MARGIN);
  });

  it("reads and clamps the dynamicOutput margin", () => {
    expect(
      readProofStateSettings(makeReader({ "dynamicOutput.margin": 120 })).dynamicOutputMargin
    ).toBe(120);
    expect(
      readProofStateSettings(makeReader({ "dynamicOutput.margin": 10 })).dynamicOutputMargin
    ).toBe(MIN_MARGIN);
  });

  it("falls back to the default when a margin is the wrong type", () => {
    expect(
      readProofStateSettings(makeReader({ "proofState.margin": "wide" })).proofStateMargin
    ).toBe(DEFAULT_PROOF_STATE_SETTINGS.proofStateMargin);
  });

  it("reads all three keys independently", () => {
    const settings = readProofStateSettings(
      makeReader({
        "proofState.autoUpdate": false,
        "proofState.margin": 150,
        "dynamicOutput.margin": 100
      })
    );
    expect(settings).toEqual({
      autoUpdate: false,
      proofStateMargin: 150,
      dynamicOutputMargin: 100
    });
  });
});

describe("diffProofStateSettings", () => {
  it("flags every change kind independently", () => {
    const a = { autoUpdate: true, proofStateMargin: 80, dynamicOutputMargin: 80 };
    expect(diffProofStateSettings(a, a)).toEqual({
      autoUpdateChanged: false,
      proofStateMarginChanged: false,
      dynamicOutputMarginChanged: false
    });
    expect(
      diffProofStateSettings(a, { ...a, autoUpdate: false })
    ).toEqual({
      autoUpdateChanged: true,
      proofStateMarginChanged: false,
      dynamicOutputMarginChanged: false
    });
    expect(
      diffProofStateSettings(a, { ...a, proofStateMargin: 120 })
    ).toEqual({
      autoUpdateChanged: false,
      proofStateMarginChanged: true,
      dynamicOutputMarginChanged: false
    });
    expect(
      diffProofStateSettings(a, { ...a, dynamicOutputMargin: 120 })
    ).toEqual({
      autoUpdateChanged: false,
      proofStateMarginChanged: false,
      dynamicOutputMarginChanged: true
    });
  });

  it("can flag multiple changes at once", () => {
    const a = { autoUpdate: true, proofStateMargin: 80, dynamicOutputMargin: 80 };
    const b = { autoUpdate: false, proofStateMargin: 120, dynamicOutputMargin: 100 };
    expect(diffProofStateSettings(a, b)).toEqual({
      autoUpdateChanged: true,
      proofStateMarginChanged: true,
      dynamicOutputMarginChanged: true
    });
  });
});
