import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PideQuiescenceTracker,
  QuiescenceDisposable,
  QuiescenceWorkspace,
  TextDocumentChangeEventLike,
  TextDocumentLike
} from "../../src/sledgehammer/PideQuiescenceTracker";

class FakeWorkspace implements QuiescenceWorkspace {
  public readonly listeners = new Set<(event: TextDocumentChangeEventLike) => void>();

  public onDidChangeTextDocument = (
    listener: (event: TextDocumentChangeEventLike) => void
  ): QuiescenceDisposable => {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      }
    };
  };

  public fire(event: TextDocumentChangeEventLike): void {
    for (const listener of [...this.listeners]) {
      listener(event);
    }
  }
}

function theory(uri: string, languageId = "isabelle", fileName?: string): TextDocumentLike {
  return {
    uri: { toString: () => uri },
    languageId,
    fileName
  };
}

function changeEvent(document: TextDocumentLike): TextDocumentChangeEventLike {
  return { document };
}

describe("PideQuiescenceTracker", () => {
  it("starts with no recorded edits", () => {
    const ws = new FakeWorkspace();
    const tracker = new PideQuiescenceTracker(ws);
    expect(tracker.getLastEditAt("file:///Demo.thy")).toBeUndefined();
    tracker.dispose();
  });

  it("records the edit timestamp for a theory document on change events", () => {
    const ws = new FakeWorkspace();
    let clock = 1_000;
    const tracker = new PideQuiescenceTracker(ws, { now: () => clock });
    ws.fire(changeEvent(theory("file:///A.thy")));
    expect(tracker.getLastEditAt("file:///A.thy")).toBe(1_000);
    clock = 1_500;
    ws.fire(changeEvent(theory("file:///A.thy")));
    expect(tracker.getLastEditAt("file:///A.thy")).toBe(1_500);
    tracker.dispose();
  });

  it("ignores changes for non-theory documents", () => {
    const ws = new FakeWorkspace();
    const tracker = new PideQuiescenceTracker(ws);
    ws.fire(changeEvent(theory("file:///A.md", "markdown")));
    ws.fire(changeEvent(theory("file:///A.thy", "plaintext", "/tmp/A.thy")));
    // The .thy fileName path is allowed even when languageId is wrong;
    // markdown documents are dropped.
    expect(tracker.getLastEditAt("file:///A.md")).toBeUndefined();
    expect(tracker.getLastEditAt("file:///A.thy")).toBeDefined();
    tracker.dispose();
  });

  it("recordEdit lets tests inject an edit without going through the workspace event", () => {
    const ws = new FakeWorkspace();
    const tracker = new PideQuiescenceTracker(ws, { now: () => 5_000 });
    tracker.recordEdit("file:///B.thy");
    expect(tracker.getLastEditAt("file:///B.thy")).toBe(5_000);
    tracker.recordEdit("file:///B.thy", 9_999);
    expect(tracker.getLastEditAt("file:///B.thy")).toBe(9_999);
    tracker.dispose();
  });

  describe("computeRequiredDelay", () => {
    it("returns 0 when no edit has been recorded for the URI", () => {
      const tracker = new PideQuiescenceTracker(new FakeWorkspace());
      expect(tracker.computeRequiredDelay("file:///A.thy", 1500)).toBe(0);
      tracker.dispose();
    });

    it("returns 0 when settingsDelayMs is 0 or negative", () => {
      const tracker = new PideQuiescenceTracker(new FakeWorkspace(), { now: () => 1_000 });
      tracker.recordEdit("file:///A.thy", 1_000);
      expect(tracker.computeRequiredDelay("file:///A.thy", 0)).toBe(0);
      expect(tracker.computeRequiredDelay("file:///A.thy", -100)).toBe(0);
      tracker.dispose();
    });

    it("returns 0 when the most recent edit is older than the delay", () => {
      const tracker = new PideQuiescenceTracker(new FakeWorkspace(), { now: () => 10_000 });
      tracker.recordEdit("file:///A.thy", 1_000);
      expect(tracker.computeRequiredDelay("file:///A.thy", 1500)).toBe(0);
      tracker.dispose();
    });

    it("returns the remaining delay when the most recent edit is within the window", () => {
      let clock = 1_500;
      const tracker = new PideQuiescenceTracker(new FakeWorkspace(), { now: () => clock });
      tracker.recordEdit("file:///A.thy", 1_000);
      // 1500 - (1500 - 1000) = 1000ms remaining
      expect(tracker.computeRequiredDelay("file:///A.thy", 1500)).toBe(1000);
      clock = 2_000;
      // 1500 - (2000 - 1000) = 500ms remaining
      expect(tracker.computeRequiredDelay("file:///A.thy", 1500)).toBe(500);
      clock = 2_500;
      // edge: elapsed == delay → 0
      expect(tracker.computeRequiredDelay("file:///A.thy", 1500)).toBe(0);
      tracker.dispose();
    });

    it("treats non-finite settingsDelayMs as 'no wait'", () => {
      const tracker = new PideQuiescenceTracker(new FakeWorkspace(), { now: () => 1_000 });
      tracker.recordEdit("file:///A.thy", 1_000);
      expect(tracker.computeRequiredDelay("file:///A.thy", NaN)).toBe(0);
      expect(tracker.computeRequiredDelay("file:///A.thy", Infinity)).toBe(0);
      tracker.dispose();
    });
  });

  describe("waitForQuiescence", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("resolves immediately when no edit has been recorded", async () => {
      const tracker = new PideQuiescenceTracker(new FakeWorkspace());
      await expect(tracker.waitForQuiescence("file:///A.thy", 1500)).resolves.toBeUndefined();
      tracker.dispose();
    });

    it("resolves immediately when settingsDelayMs is 0", async () => {
      const tracker = new PideQuiescenceTracker(new FakeWorkspace());
      tracker.recordEdit("file:///A.thy", 1_000);
      await expect(tracker.waitForQuiescence("file:///A.thy", 0)).resolves.toBeUndefined();
      tracker.dispose();
    });

    it("waits the remaining delay and then resolves", async () => {
      let settled = false;
      // Use an injectable scheduler so we can fast-forward through it
      // without depending on Node's real setTimeout shape.
      let pending: { cb: () => void; ms: number } | undefined;
      const tracker = new PideQuiescenceTracker(new FakeWorkspace(), {
        now: () => 1_500,
        scheduleTimeout: (cb, ms) => {
          pending = { cb, ms };
          return 1;
        },
        cancelTimeout: () => {
          pending = undefined;
        }
      });
      tracker.recordEdit("file:///A.thy", 1_000);
      const wait = tracker.waitForQuiescence("file:///A.thy", 1500);
      void wait.then(() => {
        settled = true;
      });
      expect(pending?.ms).toBe(1000);
      expect(settled).toBe(false);
      pending?.cb();
      await wait;
      expect(settled).toBe(true);
      tracker.dispose();
    });

    it("never rejects even when the tracker is disposed before the timer fires", async () => {
      const ws = new FakeWorkspace();
      const tracker = new PideQuiescenceTracker(ws, {
        now: () => 1_500,
        scheduleTimeout: (cb, _ms) => setTimeout(cb, 1)
      });
      tracker.recordEdit("file:///A.thy", 1_000);
      const wait = tracker.waitForQuiescence("file:///A.thy", 1500);
      tracker.dispose();
      // Advance the real-ish timer; the promise stays unsettled but
      // does not reject.
      vi.advanceTimersByTime(2);
      let rejected = false;
      void wait.catch(() => {
        rejected = true;
      });
      await Promise.resolve();
      expect(rejected).toBe(false);
    });

    it("returns immediately after dispose without spinning up timers", async () => {
      const tracker = new PideQuiescenceTracker(new FakeWorkspace(), { now: () => 1_500 });
      tracker.recordEdit("file:///A.thy", 1_000);
      tracker.dispose();
      await expect(tracker.waitForQuiescence("file:///A.thy", 1500)).resolves.toBeUndefined();
    });
  });

  describe("lifecycle", () => {
    it("releases the workspace subscription on dispose and ignores subsequent events", () => {
      const ws = new FakeWorkspace();
      const tracker = new PideQuiescenceTracker(ws, { now: () => 1_000 });
      expect(ws.listeners.size).toBe(1);
      tracker.dispose();
      expect(ws.listeners.size).toBe(0);
      ws.fire(changeEvent(theory("file:///A.thy")));
      expect(tracker.getLastEditAt("file:///A.thy")).toBeUndefined();
    });

    it("dispose is idempotent", () => {
      const tracker = new PideQuiescenceTracker(new FakeWorkspace());
      tracker.dispose();
      expect(() => tracker.dispose()).not.toThrow();
    });

    it("forget drops a single URI's record, clear drops all of them", () => {
      const tracker = new PideQuiescenceTracker(new FakeWorkspace(), { now: () => 1_000 });
      tracker.recordEdit("file:///A.thy");
      tracker.recordEdit("file:///B.thy");
      tracker.forget("file:///A.thy");
      expect(tracker.getLastEditAt("file:///A.thy")).toBeUndefined();
      expect(tracker.getLastEditAt("file:///B.thy")).toBe(1_000);
      tracker.clear();
      expect(tracker.getLastEditAt("file:///B.thy")).toBeUndefined();
      tracker.dispose();
    });
  });
});
