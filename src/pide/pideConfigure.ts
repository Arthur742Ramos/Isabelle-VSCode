import {
  IsabellePideMode,
  PideConfigureParams,
  PideConfigureScalaIsabelleParams
} from "../protocol/messages";

/**
 * Minimal shape of a configuration source used by [[buildPideConfigureParams]].
 * Matches the relevant subset of `vscode.WorkspaceConfiguration.get` so tests
 * can supply a plain stub without importing the `vscode` module.
 */
export interface PideConfigurationSource {
  get<T>(key: string, defaultValue: T): T;
}

const SUPPORTED_MODES: ReadonlySet<IsabellePideMode> = new Set(["localSyntax", "scalaIsabelle"]);

/**
 * Build the `pide/configure` request parameters from a workspace
 * configuration view (or any compatible stub) rooted at the `isabelle`
 * configuration section.
 *
 * - Defaults `pide.mode` to `"localSyntax"` when the value is missing or
 *   unrecognized, mirroring the schema default and keeping behavior
 *   conservative.
 * - Only attaches `scalaIsabelle` sub-parameters when the selected mode is
 *   `scalaIsabelle`; in `localSyntax` mode the scala-isabelle settings are
 *   irrelevant and intentionally omitted from the wire payload.
 * - Empty strings on optional sub-fields are treated as "unset" so the
 *   backend can apply its own defaults.
 * - `logicSession` falls back to `"HOL"` when the setting is missing or
 *   blank so the scala-isabelle bridge always has a sensible base logic.
 */
export function buildPideConfigureParams(config: PideConfigurationSource): PideConfigureParams {
  const rawMode = config.get<string>("pide.mode", "localSyntax");
  const mode: IsabellePideMode = SUPPORTED_MODES.has(rawMode as IsabellePideMode)
    ? (rawMode as IsabellePideMode)
    : "localSyntax";

  if (mode !== "scalaIsabelle") {
    return { mode };
  }

  const scalaIsabelle: PideConfigureScalaIsabelleParams = {};

  const isabelleHome = trimOrUndefined(config.get<string>("pide.isabelleHome", ""));
  if (isabelleHome !== undefined) {
    scalaIsabelle.isabelleHome = isabelleHome;
  }

  const userDir = trimOrUndefined(config.get<string>("pide.userDir", ""));
  if (userDir !== undefined) {
    scalaIsabelle.userDir = userDir;
  }

  const sessionName = trimOrUndefined(config.get<string>("pide.sessionName", ""));
  if (sessionName !== undefined) {
    scalaIsabelle.sessionName = sessionName;
  }

  const logicSession = trimOrUndefined(config.get<string>("pide.logicSession", "HOL")) ?? "HOL";
  scalaIsabelle.logicSession = logicSession;

  return { mode, scalaIsabelle };
}

function trimOrUndefined(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}
