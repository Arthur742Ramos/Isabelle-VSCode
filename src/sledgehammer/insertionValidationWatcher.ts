// Diagnostics watcher used after inserting a Sledgehammer suggestion to
// decide whether the inserted proof regressed the theory.
//
// The watcher is vscode-free: the production wiring in
// `SledgehammerPanel` injects adapters around
// `vscode.languages.getDiagnostics` and
// `vscode.languages.onDidChangeDiagnostics`, and tests pass simple
// in-memory fakes. The watcher itself owns no VS Code types.
//
// Timing strategy (addresses the rubber-duck critique against the
// initial naive sketch):
//   1. The watcher subscribes to diagnostic changes BEFORE the caller
//      calls `start()` so a publish that races with the edit is not
//      lost between the edit returning and the subscription being
//      attached. (Production callers create the watcher and subscribe
//      before applying the edit, then call `start()` once the edit
//      resolves.)
//   2. On `start()`, the watcher immediately takes a first sample via
//      `getDiagnostics(uri)` and schedules the debounce timer. If no
//      further change events arrive within `settleMs`, the latest
//      sample is validated against the baseline.
//   3. Every subsequent matching change event resets the debounce
//      timer (so a slow PIDE re-elaboration that publishes several
//      partial snapshots still funnels into one final validation).
//   4. If `maxWaitMs` elapses before the watcher has had a settled
//      window, it resolves with `{kind: "still-processing"}`. The
//      caller MUST treat that as "validation did not conclude," not
//      as "no regression."
//
// `dispose()` is idempotent and safe to call from any state. It
// resolves any pending promise with `{kind: "still-processing"}` so
// callers never see a dangling promise.

import {
  ValidateInsertionInputs,
  ValidationDiagnostic,
  ValidationOutcome,
  validateInsertedProof
} from "./proofInsertValidation";

export interface InsertionValidationDisposable {
  dispose(): void;
}

/**
 * Minimal subset of `vscode.languages` the watcher needs. Production
 * adapter:
 *   getDiagnostics: (uri) => adapt(vscode.languages.getDiagnostics(vscode.Uri.parse(uri)))
 *   onDidChangeDiagnostics: (handler) => vscode.languages.onDidChangeDiagnostics(...)
 */
export interface DiagnosticsSource {
  getDiagnostics(uri: string): readonly ValidationDiagnostic[];
  onDidChangeDiagnostics(
    handler: (changedUris: readonly string[]) => void
  ): InsertionValidationDisposable;
}

export interface InsertionValidationLogger {
  appendLine(message: string): void;
}

export interface InsertionValidationInputs {
  readonly uri: string;
  readonly baseline: readonly ValidationDiagnostic[];
  readonly insertionLine: number;
  readonly insertedLineCount: number;
  /**
   * Time (ms) of quiet diagnostic events after which the watcher
   * treats the latest snapshot as the post-insertion state.
   */
  readonly settleMs: number;
  /**
   * Maximum total time (ms) the watcher will wait before giving up
   * and returning `{kind: "still-processing"}`.
   */
  readonly maxWaitMs: number;
}

/**
 * Construct a watcher whose subscription is attached immediately. The
 * caller is expected to:
 *   1. construct the watcher (subscription is live now);
 *   2. apply the edit;
 *   3. await `watcher.start(inputs)` once the edit resolves.
 *
 * If the edit never lands, the caller should `dispose()` the watcher
 * to release the subscription.
 */
export class InsertionValidationWatcher implements InsertionValidationDisposable {
  private subscription: InsertionValidationDisposable | undefined;
  private settleTimer: ReturnType<typeof setTimeout> | undefined;
  private deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  private resolvePending: ((outcome: ValidationOutcome) => void) | undefined;
  private inputs: InsertionValidationInputs | undefined;
  private disposed = false;

  public constructor(
    private readonly source: DiagnosticsSource,
    private readonly logger: InsertionValidationLogger
  ) {
    this.subscription = source.onDidChangeDiagnostics((changedUris) =>
      this.handleChange(changedUris)
    );
  }

  /**
   * Begin the post-edit settle window. Returns a promise that
   * resolves with the validation outcome.
   *
   * Calling `start` twice on the same watcher is a programmer error;
   * the second call rejects. Production callers create one watcher per
   * insertion attempt.
   */
  public async start(inputs: InsertionValidationInputs): Promise<ValidationOutcome> {
    if (this.disposed) {
      return { kind: "still-processing" };
    }
    if (this.inputs !== undefined) {
      throw new Error("InsertionValidationWatcher: start() may only be called once");
    }
    this.inputs = inputs;

    return new Promise<ValidationOutcome>((resolve) => {
      this.resolvePending = resolve;
      this.scheduleSettle();
      this.deadlineTimer = setTimeout(() => {
        this.resolveOutcome({ kind: "still-processing" });
      }, Math.max(0, inputs.maxWaitMs));
      this.deadlineTimer.unref?.();
    });
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearTimers();
    this.subscription?.dispose();
    this.subscription = undefined;
    this.resolveOutcome({ kind: "still-processing" });
  }

  private handleChange(changedUris: readonly string[]): void {
    if (this.disposed || this.inputs === undefined) return;
    if (!changedUris.includes(this.inputs.uri)) return;
    this.scheduleSettle();
  }

  private scheduleSettle(): void {
    if (this.disposed || this.inputs === undefined) return;
    if (this.settleTimer !== undefined) {
      clearTimeout(this.settleTimer);
    }
    const settleMs = Math.max(0, this.inputs.settleMs);
    this.settleTimer = setTimeout(() => this.settleAndValidate(), settleMs);
    this.settleTimer.unref?.();
  }

  private settleAndValidate(): void {
    if (this.disposed || this.inputs === undefined) return;
    let post: readonly ValidationDiagnostic[];
    try {
      post = this.source.getDiagnostics(this.inputs.uri);
    } catch (error) {
      this.logger.appendLine(
        `Sledgehammer insert validation: getDiagnostics threw: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      this.resolveOutcome({ kind: "still-processing" });
      return;
    }

    const validationInputs: ValidateInsertionInputs = {
      baseline: this.inputs.baseline,
      post,
      insertionLine: this.inputs.insertionLine,
      insertedLineCount: this.inputs.insertedLineCount
    };
    this.resolveOutcome(validateInsertedProof(validationInputs));
  }

  private resolveOutcome(outcome: ValidationOutcome): void {
    if (!this.resolvePending) return;
    const resolve = this.resolvePending;
    this.resolvePending = undefined;
    this.clearTimers();
    this.subscription?.dispose();
    this.subscription = undefined;
    this.disposed = true;
    resolve(outcome);
  }

  private clearTimers(): void {
    if (this.settleTimer !== undefined) {
      clearTimeout(this.settleTimer);
      this.settleTimer = undefined;
    }
    if (this.deadlineTimer !== undefined) {
      clearTimeout(this.deadlineTimer);
      this.deadlineTimer = undefined;
    }
  }
}
