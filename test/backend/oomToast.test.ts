import { describe, expect, it } from "vitest";
import { decideOomToast } from "../../src/backend/oomToast";

describe("decideOomToast", () => {
  it("returns shouldShow=true with deep-link hint when message contains OutOfMemoryError", () => {
    const decision = decideOomToast({
      errorMessage: "use_theories invocation failed: OutOfMemoryError: Java heap space",
      reason: "start-session",
      alreadyShown: () => false
    });
    expect(decision.shouldShow).toBe(true);
    expect(decision.storageKey).toBe("isabelle.pide.oomToast.shown");
    expect(decision.title).toBe("Isabelle backend ran out of memory.");
    expect(decision.detail).toContain("isabelle.backend.maxHeapMb");
  });

  it("returns shouldShow=true on Java heap space message", () => {
    const decision = decideOomToast({
      errorMessage: "Java heap space",
      reason: undefined,
      alreadyShown: () => false
    });
    expect(decision.shouldShow).toBe(true);
  });

  it("returns shouldShow=true on GC overhead limit exceeded", () => {
    const decision = decideOomToast({
      errorMessage: "GC overhead limit exceeded",
      reason: undefined,
      alreadyShown: () => false
    });
    expect(decision.shouldShow).toBe(true);
  });

  it("returns shouldShow=false for non-OOM messages", () => {
    const decision = decideOomToast({
      errorMessage: "User_Error: Illegal character in path",
      reason: "start-session",
      alreadyShown: () => false
    });
    expect(decision.shouldShow).toBe(false);
  });

  it("returns shouldShow=false when alreadyShown reports the key was seen", () => {
    const decision = decideOomToast({
      errorMessage: "OutOfMemoryError",
      reason: undefined,
      alreadyShown: (key) => key === "isabelle.pide.oomToast.shown"
    });
    expect(decision.shouldShow).toBe(false);
  });

  it("treats module-init-failed reason as OOM-suspicious even without a literal substring match", () => {
    const decision = decideOomToast({
      errorMessage: "ExceptionInInitializerError",
      reason: "module-init-failed",
      alreadyShown: () => false
    });
    expect(decision.shouldShow).toBe(true);
  });

  it("truncates very long error messages in the detail field", () => {
    const longMessage = "OutOfMemoryError: " + "x".repeat(500);
    const decision = decideOomToast({
      errorMessage: longMessage,
      reason: undefined,
      alreadyShown: () => false
    });
    expect(decision.detail.length).toBeLessThan(longMessage.length);
    expect(decision.detail).toContain("...");
  });
});
