import { describe, expect, it, vi } from "vitest";
import {
  ResolvePideSessionDeps,
  resolvePideSession
} from "../../src/session/resolvePideSession";

interface RecordedCalls {
  readonly persisted: string[];
  readonly warningSeen: boolean[];
  readonly executed: string[];
  readonly quickPickShown: number;
  readonly warningShown: number;
}

function buildDeps(overrides: Partial<ResolvePideSessionDeps>): {
  deps: ResolvePideSessionDeps;
  calls: RecordedCalls;
} {
  const persisted: string[] = [];
  const warningSeen: boolean[] = [];
  const executed: string[] = [];
  let quickPickShown = 0;
  let warningShown = 0;

  const deps: ResolvePideSessionDeps = {
    activeSessionSetting: "",
    discoveredSessions: [],
    getHolWarningSeen: () => false,
    setHolWarningSeen: async (value) => {
      warningSeen.push(value);
    },
    persistActiveSession: async (session) => {
      persisted.push(session);
    },
    showQuickPick: async (items) => {
      quickPickShown += 1;
      return items[0];
    },
    showWarningMessage: async () => {
      warningShown += 1;
      return undefined;
    },
    executeCommand: async (command) => {
      executed.push(command);
    },
    ...overrides
  };

  const calls: RecordedCalls = {
    persisted,
    warningSeen,
    executed,
    get quickPickShown() {
      return quickPickShown;
    },
    get warningShown() {
      return warningShown;
    }
  };

  return { deps, calls };
}

describe("resolvePideSession", () => {
  describe("step 1: setting wins", () => {
    it("returns the configured session without side effects", async () => {
      const { deps, calls } = buildDeps({
        activeSessionSetting: "Pure",
        discoveredSessions: ["HOL", "Pure"]
      });
      const outcome = await resolvePideSession(deps);
      expect(outcome).toEqual({
        kind: "resolved",
        session: "Pure"
      });
      expect(calls.persisted).toEqual([]);
      expect(calls.quickPickShown).toBe(0);
      expect(calls.warningShown).toBe(0);
    });

    it("does not persist when the setting was the source", async () => {
      const { deps, calls } = buildDeps({
        activeSessionSetting: "MyEntry",
        discoveredSessions: []
      });
      await resolvePideSession(deps);
      expect(calls.persisted).toEqual([]);
    });
  });

  describe("step 2: single-root auto-select", () => {
    it("persists and returns the auto-selected session", async () => {
      const { deps, calls } = buildDeps({
        activeSessionSetting: "",
        discoveredSessions: ["MyEntry"]
      });
      const outcome = await resolvePideSession(deps);
      expect(outcome).toEqual({
        kind: "resolved",
        session: "MyEntry"
      });
      expect(calls.persisted).toEqual(["MyEntry"]);
      expect(calls.quickPickShown).toBe(0);
      expect(calls.warningShown).toBe(0);
    });
  });

  describe("step 3: multi-session quickpick", () => {
    it("shows quickpick, persists user choice, returns resolved", async () => {
      const pickedItems: ReadonlyArray<string>[] = [];
      const { deps, calls } = buildDeps({
        activeSessionSetting: "",
        discoveredSessions: ["HOL", "HOL-Library", "AFP-Entry"],
        showQuickPick: async (items) => {
          pickedItems.push(items);
          return "HOL-Library";
        }
      });
      const outcome = await resolvePideSession(deps);
      expect(outcome).toEqual({
        kind: "resolved",
        session: "HOL-Library"
      });
      expect(pickedItems).toEqual([["HOL", "HOL-Library", "AFP-Entry"]]);
      expect(calls.persisted).toEqual(["HOL-Library"]);
      expect(calls.warningShown).toBe(0);
    });

    it("returns cancelled when user dismisses the quickpick", async () => {
      const { deps, calls } = buildDeps({
        activeSessionSetting: "",
        discoveredSessions: ["HOL", "HOL-Library"],
        showQuickPick: async () => undefined
      });
      const outcome = await resolvePideSession(deps);
      expect(outcome).toEqual({ kind: "cancelled" });
      expect(calls.persisted).toEqual([]);
      expect(calls.warningShown).toBe(0);
    });
  });

  describe("step 4: HOL fallback", () => {
    it("shows the warning toast on the first call and returns HOL", async () => {
      const { deps, calls } = buildDeps({
        activeSessionSetting: "",
        discoveredSessions: [],
        getHolWarningSeen: () => false
      });
      const outcome = await resolvePideSession(deps);
      expect(outcome).toEqual({
        kind: "resolved",
        session: "HOL"
      });
      expect(calls.warningShown).toBe(1);
      expect(calls.persisted).toEqual([]);
      expect(calls.executed).toEqual([]);
      expect(calls.warningSeen).toEqual([]);
    });

    it("suppresses the warning toast when workspace-state flag is set", async () => {
      const { deps, calls } = buildDeps({
        activeSessionSetting: "",
        discoveredSessions: [],
        getHolWarningSeen: () => true
      });
      const outcome = await resolvePideSession(deps);
      expect(outcome).toEqual({
        kind: "resolved",
        session: "HOL"
      });
      expect(calls.warningShown).toBe(0);
    });

    it("invokes isabelle.selectSession when the user clicks 'Select Active Session'", async () => {
      const { deps, calls } = buildDeps({
        activeSessionSetting: "",
        discoveredSessions: [],
        showWarningMessage: async () => "Select Active Session"
      });
      await resolvePideSession(deps);
      expect(calls.executed).toEqual(["isabelle.selectSession"]);
      expect(calls.warningSeen).toEqual([]);
    });

    it("persists workspace-state flag when the user clicks 'Don't show again'", async () => {
      const { deps, calls } = buildDeps({
        activeSessionSetting: "",
        discoveredSessions: [],
        showWarningMessage: async () => "Don't show again"
      });
      await resolvePideSession(deps);
      expect(calls.warningSeen).toEqual([true]);
      expect(calls.executed).toEqual([]);
    });

    it("does nothing when the user dismisses the warning toast", async () => {
      const { deps, calls } = buildDeps({
        activeSessionSetting: "",
        discoveredSessions: [],
        showWarningMessage: async () => undefined
      });
      await resolvePideSession(deps);
      expect(calls.executed).toEqual([]);
      expect(calls.warningSeen).toEqual([]);
    });
  });

  describe("ordering", () => {
    it("decides before any side effect; quickpick / warning never fires when the setting wins", async () => {
      const showQuickPick = vi.fn(async () => undefined);
      const showWarningMessage = vi.fn(async () => undefined);
      const { deps } = buildDeps({
        activeSessionSetting: "Pure",
        discoveredSessions: ["HOL", "Pure"],
        showQuickPick,
        showWarningMessage
      });
      await resolvePideSession(deps);
      expect(showQuickPick).not.toHaveBeenCalled();
      expect(showWarningMessage).not.toHaveBeenCalled();
    });
  });
});
