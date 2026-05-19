import { CheckWithPideReason } from "../protocol/messages";

/**
 * Pure deduplicating helper for the "Isabelle backend ran out of
 * memory" toast. We want to surface the toast the FIRST time a user
 * hits OOM (with a deep-link to `isabelle.backend.maxHeapMb`) but
 * not pester them on every subsequent failure in the same session.
 *
 * The deduper is keyed by a stable storage key so the VS Code wiring
 * can persist "already showed this once" in `globalState`. The pure
 * decider returns `{ shouldShow, storageKey }` and the wiring layer
 * is responsible for the actual toast + persist.
 */
export interface OomToastDecision {
  readonly shouldShow: boolean;
  readonly storageKey: string;
  readonly title: string;
  readonly detail: string;
}

/**
 * Decide whether a backend response (typically the failure body of
 * `document/checkWithPide`) represents an out-of-memory condition
 * the toast should surface. Returns `shouldShow: false` for all
 * non-OOM reasons or when the dedupe state says we already showed
 * the toast for this storageKey.
 */
export function decideOomToast(options: {
  readonly errorMessage: string | undefined;
  readonly reason: CheckWithPideReason | undefined;
  readonly alreadyShown: (key: string) => boolean;
}): OomToastDecision {
  const message = options.errorMessage ?? "";

  // OOM heuristic: backend-side reasons that bubble up an OOM cause,
  // plus literal substring scan for "OutOfMemoryError" in the error
  // message. We don't have a dedicated reason code today; if Phase 2b
  // adds one it can plug into the same decider here.
  const looksLikeOom =
    /OutOfMemoryError|Java heap space|GC overhead limit exceeded/i.test(message) ||
    options.reason === "module-init-failed";

  if (!looksLikeOom) {
    return {
      shouldShow: false,
      storageKey: "",
      title: "",
      detail: ""
    };
  }

  // One-shot dedupe by a fixed key — the toast says exactly the same
  // remediation regardless of which call hit OOM, so the user only
  // needs to see it once per backend lifetime.
  const storageKey = "isabelle.pide.oomToast.shown";
  if (options.alreadyShown(storageKey)) {
    return {
      shouldShow: false,
      storageKey,
      title: "",
      detail: ""
    };
  }

  return {
    shouldShow: true,
    storageKey,
    title: "Isabelle backend ran out of memory.",
    detail:
      "Bump `isabelle.backend.maxHeapMb` to 4096 (or higher for large AFP workspaces) and reload the window. " +
      "Original error: " +
      truncate(message, 200)
  };
}

function truncate(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }
  return value.slice(0, limit - 3) + "...";
}
