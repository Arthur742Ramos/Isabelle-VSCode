import { describe, expect, it } from "vitest";
import {
  decideSessionCascade,
  SESSION_CASCADE_HOL_WARNING_KEY
} from "../../src/session/sessionCascade";

describe("decideSessionCascade", () => {
  it("step 1: returns resolved with source=setting when isabelle.session.active is set", () => {
    const decision = decideSessionCascade({
      activeSessionSetting: "Pure",
      discoveredSessions: ["HOL", "Pure"],
      holFallbackWarningSeen: false
    });
    expect(decision.kind).toBe("resolved");
    if (decision.kind === "resolved") {
      expect(decision.session).toBe("Pure");
      expect(decision.source).toBe("setting");
    }
  });

  it("step 2: returns resolved with source=single-root-auto-select when only one session was discovered", () => {
    const decision = decideSessionCascade({
      activeSessionSetting: "",
      discoveredSessions: ["MyEntry"],
      holFallbackWarningSeen: false
    });
    expect(decision.kind).toBe("resolved");
    if (decision.kind === "resolved") {
      expect(decision.session).toBe("MyEntry");
      expect(decision.source).toBe("single-root-auto-select");
    }
  });

  it("step 3: returns needs-pick with candidates when multiple sessions were discovered", () => {
    const decision = decideSessionCascade({
      activeSessionSetting: "",
      discoveredSessions: ["HOL", "HOL-Library", "AFP-Entry"],
      holFallbackWarningSeen: false
    });
    expect(decision.kind).toBe("needs-pick");
    if (decision.kind === "needs-pick") {
      expect(decision.candidates).toEqual(["HOL", "HOL-Library", "AFP-Entry"]);
    }
  });

  it("step 4: returns hol-fallback when no sessions were discovered", () => {
    const decision = decideSessionCascade({
      activeSessionSetting: "",
      discoveredSessions: [],
      holFallbackWarningSeen: false
    });
    expect(decision.kind).toBe("hol-fallback");
    if (decision.kind === "hol-fallback") {
      expect(decision.session).toBe("HOL");
      expect(decision.suppressFurtherWarnings).toBe(false);
    }
  });

  it("step 4: flags suppressFurtherWarnings=true when the workspace state says the HOL warning was already shown", () => {
    const decision = decideSessionCascade({
      activeSessionSetting: "",
      discoveredSessions: [],
      holFallbackWarningSeen: true
    });
    expect(decision.kind).toBe("hol-fallback");
    if (decision.kind === "hol-fallback") {
      expect(decision.suppressFurtherWarnings).toBe(true);
    }
  });

  it("treats whitespace-only setting as unset", () => {
    const decision = decideSessionCascade({
      activeSessionSetting: "   ",
      discoveredSessions: ["MyEntry"],
      holFallbackWarningSeen: false
    });
    expect(decision.kind).toBe("resolved");
    if (decision.kind === "resolved") {
      expect(decision.source).toBe("single-root-auto-select");
    }
  });

  it("filters empty / whitespace discovered session names before counting", () => {
    const decision = decideSessionCascade({
      activeSessionSetting: "",
      discoveredSessions: ["", "  ", "OnlyReal"],
      holFallbackWarningSeen: false
    });
    expect(decision.kind).toBe("resolved");
    if (decision.kind === "resolved") {
      expect(decision.session).toBe("OnlyReal");
    }
  });

  it("exposes a stable workspaceState storage key", () => {
    expect(SESSION_CASCADE_HOL_WARNING_KEY).toBe("isabelle.session.holFallbackWarningSeen");
  });
});
