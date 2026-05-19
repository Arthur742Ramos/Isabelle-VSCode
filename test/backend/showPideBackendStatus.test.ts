import { describe, expect, it } from "vitest";
import { formatPideBackendStatus } from "../../src/backend/showPideBackendStatus";
import { PideVersionResult } from "../../src/protocol/messages";

function baseResult(overrides: Partial<PideVersionResult> = {}): PideVersionResult {
  return {
    bridge: "local-syntax",
    version: "",
    source: "unavailable",
    classloaderReady: false,
    proofOfLife: "none",
    message: "default",
    ...overrides
  };
}

describe("formatPideBackendStatus", () => {
  it("renders an info-severity summary when the bridge is pide-enabled", () => {
    const formatted = formatPideBackendStatus(
      baseResult({
        bridge: "pide-enabled",
        version: "Isabelle2025-2",
        isabelleHome: "C:\\Tools\\Isabelle2025-2\\Isabelle2025-2",
        source: "etc-identifier-file",
        classloaderReady: true,
        proofOfLife: "module-loaded",
        message:
          "Isabelle runtime classpath: ready. Document backend: local syntax (Phase 2 will swap in PIDE-backed bridges)."
      })
    );

    expect(formatted.severity).toBe("info");
    expect(formatted.title).toContain("Isabelle2025-2");
    expect(formatted.title).toContain("C:\\Tools\\Isabelle2025-2\\Isabelle2025-2");
    expect(formatted.detail).toContain("Phase 2");
  });

  it("renders without the isabelleHome fragment when the backend did not provide one", () => {
    const formatted = formatPideBackendStatus(
      baseResult({
        bridge: "pide-enabled",
        version: "Isabelle-Test-1",
        source: "isabelle_system-module",
        classloaderReady: true,
        proofOfLife: "module-loaded",
        message: "ready"
      })
    );

    expect(formatted.title).toBe("Isabelle/PIDE bridge ready: Isabelle-Test-1.");
  });

  it("renders a warning with a home-not-found remediation hint", () => {
    const formatted = formatPideBackendStatus(
      baseResult({
        reason: "home-not-found",
        message: "No Isabelle install detected."
      })
    );

    expect(formatted.severity).toBe("warning");
    expect(formatted.title).toBe("Isabelle/PIDE bridge unavailable.");
    expect(formatted.detail).toContain("No Isabelle install detected.");
    expect(formatted.detail).toContain("ISABELLE_HOME");
  });

  it("renders an isabelle-jar-missing remediation hint", () => {
    const formatted = formatPideBackendStatus(
      baseResult({
        reason: "isabelle-jar-missing",
        isabelleHome: "/opt/Isabelle2025-2",
        message: "Isabelle home resolved (/opt/Isabelle2025-2) but the PIDE jar is missing."
      })
    );

    expect(formatted.severity).toBe("warning");
    expect(formatted.detail).toContain("missing `lib/classes/isabelle.jar`");
  });

  it("renders a scala-runtime-missing remediation hint", () => {
    const formatted = formatPideBackendStatus(
      baseResult({
        reason: "scala-runtime-missing",
        message: "Scala runtime jars missing in contrib/scala-*."
      })
    );

    expect(formatted.detail).toContain("contrib/scala-*");
  });

  it("renders a class-load-failed remediation hint", () => {
    const formatted = formatPideBackendStatus(
      baseResult({
        reason: "class-load-failed",
        message: "Failed to load isabelle.Isabelle_System."
      })
    );

    expect(formatted.detail).toContain("corrupted Isabelle install");
  });

  it("renders a module-init-failed remediation hint", () => {
    const formatted = formatPideBackendStatus(
      baseResult({
        reason: "module-init-failed",
        message: "ExceptionInInitializerError"
      })
    );

    expect(formatted.detail).toContain("backend logs");
  });

  it("omits the remediation hint when no reason is set", () => {
    const formatted = formatPideBackendStatus(
      baseResult({
        message: "Some unrecognised failure mode."
      })
    );

    expect(formatted.severity).toBe("warning");
    expect(formatted.detail).toBe("Some unrecognised failure mode.");
  });

  it("handles an unknown reason code gracefully (no hint, no crash)", () => {
    const formatted = formatPideBackendStatus(
      baseResult({
        // Cast through `unknown` so we can drive the default branch even
        // though TypeScript's discriminated union forbids the literal.
        reason: "future-reason" as unknown as PideVersionResult["reason"],
        message: "Future failure mode."
      })
    );

    expect(formatted.detail).toBe("Future failure mode.");
  });
});
