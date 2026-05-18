// Pure helpers for the Copilot CLI extension. Kept in a separate ESM file
// so they are testable from vitest under the project's structural-test
// convention (see AGENTS.md "Test conventions") — extension.mjs itself
// imports {@github/copilot-sdk} which is unavailable outside Copilot CLI.

/**
 * Parse the major version from `java -version` output.
 *
 * `java -version` writes the version line to stderr in one of:
 *   openjdk version "21.0.1" 2023-10-17 LTS  -> 21
 *   java version "17.0.10" 2024-01-16 LTS    -> 17
 *   java version "1.8.0_392"                 -> 8  (legacy)
 *
 * Returns undefined when no recognizable version string is present.
 */
export function parseJavaMajor(output) {
  if (!output) return undefined;
  const match = /version\s+"([^"]+)"/i.exec(output);
  if (!match) return undefined;
  const literal = match[1];
  const legacy = /^1\.(\d+)(?:[._].*)?$/.exec(literal);
  if (legacy) {
    const parsed = Number.parseInt(legacy[1], 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  const modern = /^(\d+)(?:[._-].*)?$/.exec(literal);
  if (modern) {
    const parsed = Number.parseInt(modern[1], 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/** Parse `node --version` output (e.g. "v24.15.0") into a major integer. */
export function parseNodeMajor(output) {
  if (!output) return undefined;
  const m = /^v?(\d+)\./.exec(output.trim());
  if (!m) return undefined;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Parse `sbt -version` output into a [major, minor] tuple. The line format
 * varies across versions — most commonly:
 *   sbt version in this project: 1.12.11
 *   sbt script version: 1.10.0
 *   [info] sbt server version: 1.10.0
 *   sbt version: 1.12.11
 * We accept any of those.
 */
export function parseSbtMajorMinor(output) {
  if (!output) return undefined;
  const m = /sbt[^0-9]*?(\d+)\.(\d+)/i.exec(output);
  if (!m) return undefined;
  const major = Number.parseInt(m[1], 10);
  const minor = Number.parseInt(m[2], 10);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return undefined;
  return [major, minor];
}

/**
 * Parse `isabelle version` output into a release year. Output looks like:
 *   Isabelle2025: October 2025
 *   Isabelle2024: May 2024
 * Returns undefined if no four-digit year right after "Isabelle" is present.
 */
export function parseIsabelleYear(output) {
  if (!output) return undefined;
  const m = /Isabelle[\s_-]?(\d{4})/i.exec(output);
  if (!m) return undefined;
  const year = Number.parseInt(m[1], 10);
  return Number.isFinite(year) ? year : undefined;
}

/**
 * Compare a two-tuple [major, minor] against a minimum [major, minor].
 * Returns true if version >= minimum lexicographically.
 */
export function meetsMinimum(version, minimum) {
  if (!version) return false;
  if (version[0] > minimum[0]) return true;
  if (version[0] < minimum[0]) return false;
  return version[1] >= minimum[1];
}

/**
 * Extract every command id referenced from a `command:` markdown link
 * target in `text`. Tolerates query strings (`command:foo?args`), which
 * VS Code supports for passing encoded arguments through the URL.
 *
 * Returns an array of {commandId, raw} tuples, where `raw` is the full
 * matched `command:…` URI for diagnostic display.
 */
export function extractWalkthroughCommandLinks(text) {
  const out = [];
  // ](command:foo[?args]) — capture id before optional query.
  const re = /\]\(command:([\w.-]+)(\?[^)]*)?\)/g;
  for (const m of text.matchAll(re)) {
    out.push({ commandId: m[1], raw: `command:${m[1]}${m[2] ?? ""}` });
  }
  return out;
}

/**
 * Scan `text` for hard-coded counts that will drift the moment someone
 * adds or removes an item ("52 commands", "5 steps", "639 tests", etc).
 *
 * Returns an array of warnings. Each warning carries the matched number
 * and the noun it modifies so the caller can render an actionable
 * message.
 *
 * Heuristics:
 *  - Match any positive integer immediately followed by a known noun
 *    (commands, tests, steps, panels, views, extensions, options) so we
 *    catch single-digit drift like "5 steps" too.
 *  - Don't match "1 X" — that's almost always correct natural language
 *    ("1 panel" reads as a singular reference, not a tally).
 *  - Don't match version numbers (e.g. "Isabelle2025", "Java 21",
 *    "Node.js 20") because the regex requires a plural-or-true-count
 *    noun, none of which apply to versions.
 */
export function findDriftCounts(text) {
  const nouns = "commands|tests|steps|panels|views|extensions|options|settings|cards";
  const re = new RegExp(`\\b([2-9]|[1-9]\\d+)\\s+(${nouns})\\b`, "gi");
  const out = [];
  for (const m of text.matchAll(re)) {
    out.push({ count: m[1], noun: m[2] });
  }
  return out;
}

/**
 * Detect the dangling "Click Re-check setup below" prose with no
 * matching command link in the same card. Returns true when the wording
 * appears AND no `command:isabelle.checkPrerequisites` link is present
 * in `text`.
 */
export function hasDanglingRecheckProse(text) {
  const hasProse = /Click\s+\*\*Re-check\s+setup\*\*\s+below/i.test(text);
  if (!hasProse) return false;
  const hasLink = /command:isabelle\.checkPrerequisites/.test(text);
  return !hasLink;
}
