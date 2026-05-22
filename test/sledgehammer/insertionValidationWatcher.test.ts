import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DiagnosticsSource,
  InsertionValidationDisposable,
  InsertionValidationLogger,
  InsertionValidationWatcher
} from "../../src/sledgehammer/insertionValidationWatcher";
import { ValidationDiagnostic } from "../../src/sledgehammer/proofInsertValidation";

class FakeSource implements DiagnosticsSource {
  public readonly handlers = new Set<(changedUris: readonly string[]) => void>();
  public diagnostics: Map<string, ValidationDiagnostic[]> = new Map();
  public getThrowOnce: Error | undefined;

  public getDiagnostics(uri: string): readonly ValidationDiagnostic[] {
    if (this.getThrowOnce) {
      const err = this.getThrowOnce;
      this.getThrowOnce = undefined;
      throw err;
    }
    return this.diagnostics.get(uri) ?? [];
  }

  public onDidChangeDiagnostics(
    handler: (changedUris: readonly string[]) => void
  ): InsertionValidationDisposable {
    this.handlers.add(handler);
    return {
      dispose: () => {
        this.handlers.delete(handler);
      }
    };
  }

  public emit(changedUris: readonly string[]): void {
    for (const handler of [...this.handlers]) {
      handler(changedUris);
    }
  }

  public setDiagnostics(uri: string, diagnostics: ValidationDiagnostic[]): void {
    this.diagnostics.set(uri, diagnostics);
  }
}

class CollectingLogger implements InsertionValidationLogger {
  public readonly messages: string[] = [];
  public appendLine(message: string): void {
    this.messages.push(message);
  }
}

const URI = "file:///workspace/Demo.thy";

function diag(severity: ValidationDiagnostic["severity"], line: number, message: string): ValidationDiagnostic {
  return {
    severity,
    message,
    source: "isabelle",
    range: {
      start: { line, character: 0 },
      end: { line, character: 10 }
    }
  };
}

describe("InsertionValidationWatcher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("subscribes to diagnostic changes on construction", () => {
    const source = new FakeSource();
    const watcher = new InsertionValidationWatcher(source, new CollectingLogger());
    expect(source.handlers.size).toBe(1);
    watcher.dispose();
    expect(source.handlers.size).toBe(0);
  });

  it("returns no-regression when nothing changes within the settle window", async () => {
    const source = new FakeSource();
    const watcher = new InsertionValidationWatcher(source, new CollectingLogger());
    const promise = watcher.start({
      uri: URI,
      baseline: [],
      insertionLine: 5,
      insertedLineCount: 1,
      settleMs: 200,
      maxWaitMs: 5000
    });
    vi.advanceTimersByTime(200);
    const outcome = await promise;
    expect(outcome.kind).toBe("no-regression");
  });

  it("flags a regression based on diagnostics published after start()", async () => {
    const source = new FakeSource();
    const watcher = new InsertionValidationWatcher(source, new CollectingLogger());
    const promise = watcher.start({
      uri: URI,
      baseline: [],
      insertionLine: 5,
      insertedLineCount: 1,
      settleMs: 200,
      maxWaitMs: 5000
    });
    source.setDiagnostics(URI, [diag("error", 6, "Failed to apply")]);
    source.emit([URI]);
    vi.advanceTimersByTime(200);
    const outcome = await promise;
    expect(outcome.kind).toBe("regression");
    if (outcome.kind === "regression") {
      expect(outcome.newErrors).toHaveLength(1);
    }
  });

  it("detects a regression already present at start() via the initial getDiagnostics sample", async () => {
    const source = new FakeSource();
    // Diagnostic was published before the watcher's start() call —
    // simulating the race where the LSP publishes between the edit
    // resolving and start() being awaited.
    source.setDiagnostics(URI, [diag("error", 5, "boom")]);
    const watcher = new InsertionValidationWatcher(source, new CollectingLogger());
    const promise = watcher.start({
      uri: URI,
      baseline: [],
      insertionLine: 5,
      insertedLineCount: 1,
      settleMs: 200,
      maxWaitMs: 5000
    });
    vi.advanceTimersByTime(200);
    const outcome = await promise;
    expect(outcome.kind).toBe("regression");
  });

  it("resets the settle timer on every change event for the watched URI", async () => {
    const source = new FakeSource();
    const watcher = new InsertionValidationWatcher(source, new CollectingLogger());
    const promise = watcher.start({
      uri: URI,
      baseline: [],
      insertionLine: 5,
      insertedLineCount: 1,
      settleMs: 200,
      maxWaitMs: 5000
    });
    // Tick to just before the settle window, then publish again.
    vi.advanceTimersByTime(150);
    source.setDiagnostics(URI, [diag("warning", 6, "partial")]);
    source.emit([URI]);
    // Another almost-settle, then another publish.
    vi.advanceTimersByTime(150);
    source.setDiagnostics(URI, [diag("error", 6, "settled error")]);
    source.emit([URI]);
    // Now allow the full settle window to elapse.
    vi.advanceTimersByTime(200);
    const outcome = await promise;
    expect(outcome.kind).toBe("regression");
    if (outcome.kind === "regression") {
      expect(outcome.newErrors[0]?.message).toBe("settled error");
    }
  });

  it("ignores change events for unrelated URIs", async () => {
    const source = new FakeSource();
    const watcher = new InsertionValidationWatcher(source, new CollectingLogger());
    const promise = watcher.start({
      uri: URI,
      baseline: [],
      insertionLine: 5,
      insertedLineCount: 1,
      settleMs: 200,
      maxWaitMs: 5000
    });
    // A noisy other file publishes; should not reset the settle timer.
    source.emit(["file:///other.thy"]);
    vi.advanceTimersByTime(200);
    const outcome = await promise;
    expect(outcome.kind).toBe("no-regression");
  });

  it("returns still-processing when the deadline elapses before settling", async () => {
    const source = new FakeSource();
    const watcher = new InsertionValidationWatcher(source, new CollectingLogger());
    const promise = watcher.start({
      uri: URI,
      baseline: [],
      insertionLine: 5,
      insertedLineCount: 1,
      settleMs: 1000,
      maxWaitMs: 500
    });
    // Keep poking changes so the settle timer never fires.
    vi.advanceTimersByTime(200);
    source.emit([URI]);
    vi.advanceTimersByTime(200);
    source.emit([URI]);
    vi.advanceTimersByTime(200);
    const outcome = await promise;
    expect(outcome.kind).toBe("still-processing");
  });

  it("resolves still-processing on dispose mid-flight", async () => {
    const source = new FakeSource();
    const watcher = new InsertionValidationWatcher(source, new CollectingLogger());
    const promise = watcher.start({
      uri: URI,
      baseline: [],
      insertionLine: 5,
      insertedLineCount: 1,
      settleMs: 1000,
      maxWaitMs: 5000
    });
    watcher.dispose();
    const outcome = await promise;
    expect(outcome.kind).toBe("still-processing");
  });

  it("dispose is idempotent and releases the subscription", () => {
    const source = new FakeSource();
    const watcher = new InsertionValidationWatcher(source, new CollectingLogger());
    expect(source.handlers.size).toBe(1);
    watcher.dispose();
    expect(source.handlers.size).toBe(0);
    expect(() => watcher.dispose()).not.toThrow();
  });

  it("returns still-processing and logs when getDiagnostics throws on settle", async () => {
    const source = new FakeSource();
    const logger = new CollectingLogger();
    source.getThrowOnce = new Error("collector gone");
    const watcher = new InsertionValidationWatcher(source, logger);
    const promise = watcher.start({
      uri: URI,
      baseline: [],
      insertionLine: 5,
      insertedLineCount: 1,
      settleMs: 200,
      maxWaitMs: 5000
    });
    vi.advanceTimersByTime(200);
    const outcome = await promise;
    expect(outcome.kind).toBe("still-processing");
    expect(logger.messages.some((m) => m.includes("collector gone"))).toBe(true);
  });

  it("rejects a second start() on the same watcher", async () => {
    const source = new FakeSource();
    const watcher = new InsertionValidationWatcher(source, new CollectingLogger());
    const promise = watcher.start({
      uri: URI,
      baseline: [],
      insertionLine: 5,
      insertedLineCount: 1,
      settleMs: 200,
      maxWaitMs: 5000
    });
    await expect(
      watcher.start({
        uri: URI,
        baseline: [],
        insertionLine: 5,
        insertedLineCount: 1,
        settleMs: 200,
        maxWaitMs: 5000
      })
    ).rejects.toThrow(/start.* may only be called once/);
    vi.advanceTimersByTime(200);
    await promise;
  });

  it("returns still-processing when start() runs after dispose", async () => {
    const source = new FakeSource();
    const watcher = new InsertionValidationWatcher(source, new CollectingLogger());
    watcher.dispose();
    const outcome = await watcher.start({
      uri: URI,
      baseline: [],
      insertionLine: 5,
      insertedLineCount: 1,
      settleMs: 200,
      maxWaitMs: 5000
    });
    expect(outcome.kind).toBe("still-processing");
  });
});
