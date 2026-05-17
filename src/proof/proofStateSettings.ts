// Settings reader for the LSP-mode proof state panel.
//
// Surfaces three user-facing knobs that map onto the upstream
// `PIDE/state_*` notifications already implemented in
// `src/proof/LspProofStateSession.ts`:
//
//   - `isabelle.proofState.autoUpdate` (boolean, default true)
//        -> PIDE/state_auto_update { id, enabled }
//        Mirrors upstream `state_panel.scala:82` which initialises
//        `auto_update = true` on session start.
//
//   - `isabelle.proofState.margin` (number, default 80, clamped to
//        [20, 400])
//        -> PIDE/state_set_margin { id, margin }
//        Pretty-printer margin hint for the state panel content.
//
//   - `isabelle.dynamicOutput.margin` (number, default 80, clamped to
//        [20, 400])
//        -> PIDE/output_set_margin { margin }
//        Pretty-printer margin hint for the caret-driven dynamic
//        output (upstream calls this `output_set_margin`).
//
// Pure helpers exposed for unit tests; the extension wires the real
// `vscode.workspace.getConfiguration` provider.

export interface ProofStateConfigurationReader {
  get<T>(section: string): T | undefined;
}

export interface ProofStateSettings {
  readonly autoUpdate: boolean;
  readonly proofStateMargin: number;
  readonly dynamicOutputMargin: number;
}

export const DEFAULT_PROOF_STATE_SETTINGS: ProofStateSettings = {
  autoUpdate: true,
  proofStateMargin: 80,
  dynamicOutputMargin: 80
};

export const MIN_MARGIN = 20;
export const MAX_MARGIN = 400;

/**
 * Read the proof-state settings from a configuration provider. Out-of-range
 * margin values are clamped to `[MIN_MARGIN, MAX_MARGIN]`; non-finite or
 * non-number values fall back to the default. Pure helper for tests.
 */
export function readProofStateSettings(
  config: ProofStateConfigurationReader
): ProofStateSettings {
  return {
    autoUpdate: readBoolean(config, "proofState.autoUpdate", DEFAULT_PROOF_STATE_SETTINGS.autoUpdate),
    proofStateMargin: clampMargin(
      readNumber(config, "proofState.margin", DEFAULT_PROOF_STATE_SETTINGS.proofStateMargin)
    ),
    dynamicOutputMargin: clampMargin(
      readNumber(
        config,
        "dynamicOutput.margin",
        DEFAULT_PROOF_STATE_SETTINGS.dynamicOutputMargin
      )
    )
  };
}

/**
 * Clamp a margin value into the supported range. Pure helper.
 */
export function clampMargin(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PROOF_STATE_SETTINGS.proofStateMargin;
  if (value < MIN_MARGIN) return MIN_MARGIN;
  if (value > MAX_MARGIN) return MAX_MARGIN;
  return value;
}

/**
 * Compute the delta between two settings snapshots so the caller can
 * decide which notifications to re-send. Pure helper for tests.
 */
export interface ProofStateSettingsDelta {
  readonly autoUpdateChanged: boolean;
  readonly proofStateMarginChanged: boolean;
  readonly dynamicOutputMarginChanged: boolean;
}

export function diffProofStateSettings(
  previous: ProofStateSettings,
  next: ProofStateSettings
): ProofStateSettingsDelta {
  return {
    autoUpdateChanged: previous.autoUpdate !== next.autoUpdate,
    proofStateMarginChanged: previous.proofStateMargin !== next.proofStateMargin,
    dynamicOutputMarginChanged: previous.dynamicOutputMargin !== next.dynamicOutputMargin
  };
}

function readBoolean(
  config: ProofStateConfigurationReader,
  section: string,
  fallback: boolean
): boolean {
  const raw = config.get<unknown>(section);
  return typeof raw === "boolean" ? raw : fallback;
}

function readNumber(
  config: ProofStateConfigurationReader,
  section: string,
  fallback: number
): number {
  const raw = config.get<unknown>(section);
  return typeof raw === "number" ? raw : fallback;
}
