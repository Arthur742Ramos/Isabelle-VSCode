// Forgiving parser for the Isabelle `PIDE/decoration` LSP notification.
//
// Background (see docs/proof_state_and_minimization_lsp_research.md for the
// surrounding `PIDE/*` LSP surface and `mirror-isabelle@ce22e9ea`
// `src/Tools/VSCode/src/lsp.scala:538-569` for the verbatim shape): the
// upstream `isabelle vscode_server` pushes per-URI editor decorations
// using the notification
//
//   PIDE/decoration {
//     uri: "file:///abs/path.thy",
//     entries: [
//       {
//         type: "text_<color>",         // from Rendering.Color.Value
//         content: [
//           {
//             range: [startLine, startCol, stopLine, stopCol],
//             hover_message?: MarkedString | MarkedString[]
//           },
//           ...
//         ]
//       },
//       ...
//     ]
//   }
//
// The companion `PIDE/decoration_request { uri }` notification (sent
// client -> server) asks the server to re-emit the decorations for a
// specific URI, used when a previously closed editor becomes visible
// again.
//
// This module is vscode-free: it owns the JSON parse, validation, and
// a stable mapping from upstream `text_<color>` types to VS Code
// theme-color tokens. The apply layer (`PideDecorationOverlayService`)
// turns parsed entries into `TextEditorDecorationType` ranges.
//
// Forgiveness:
//   - Unknown / malformed entry types or content shapes are dropped
//     silently from the parsed output (logged by the caller).
//   - Ranges with non-finite or negative numbers are dropped.
//   - Ranges where `end < start` are dropped (defensive — upstream
//     never emits these but we don't want to crash if a future server
//     version changes the contract).
//   - `hover_message` accepts the upstream three-shape variance
//     (omitted / single MarkedString / list of MarkedString).

export const PIDE_DECORATION_METHOD = "PIDE/decoration";
export const PIDE_DECORATION_REQUEST_METHOD = "PIDE/decoration_request";

export interface PideDecorationPosition {
  readonly line: number;
  readonly character: number;
}

export interface PideDecorationRange {
  readonly start: PideDecorationPosition;
  readonly end: PideDecorationPosition;
}

export interface PideDecorationHoverMessage {
  readonly language: string;
  readonly value: string;
}

export interface PideDecorationContent {
  readonly range: PideDecorationRange;
  readonly hoverMessages: readonly PideDecorationHoverMessage[];
}

export interface PideDecorationEntry {
  readonly type: string;
  readonly content: readonly PideDecorationContent[];
}

export interface PideDecorationPayload {
  readonly uri: string;
  readonly entries: readonly PideDecorationEntry[];
}

export interface PideDecorationRequestPayload {
  readonly uri: string;
}

/**
 * Parse a raw `PIDE/decoration` payload into a strongly-typed,
 * fully-validated shape. Returns `undefined` if the payload is
 * structurally malformed at the top level. Malformed individual
 * entries or ranges are dropped without failing the whole notification.
 */
export function parsePideDecorationPayload(value: unknown): PideDecorationPayload | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  const uri = candidate.uri;
  if (typeof uri !== "string" || uri.length === 0) return undefined;
  const rawEntries = candidate.entries;
  if (!Array.isArray(rawEntries)) return undefined;
  const entries: PideDecorationEntry[] = [];
  for (const rawEntry of rawEntries) {
    const parsed = parseEntry(rawEntry);
    if (parsed) entries.push(parsed);
  }
  return { uri, entries };
}

function parseEntry(value: unknown): PideDecorationEntry | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  const typ = candidate.type;
  if (typeof typ !== "string" || typ.length === 0) return undefined;
  const rawContent = candidate.content;
  if (!Array.isArray(rawContent)) return undefined;
  const content: PideDecorationContent[] = [];
  for (const rawItem of rawContent) {
    const parsed = parseContent(rawItem);
    if (parsed) content.push(parsed);
  }
  return { type: typ, content };
}

function parseContent(value: unknown): PideDecorationContent | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  const range = parseRange(candidate.range);
  if (!range) return undefined;
  const hoverMessages = parseHoverMessages(candidate.hover_message);
  return { range, hoverMessages };
}

function parseRange(value: unknown): PideDecorationRange | undefined {
  if (!Array.isArray(value) || value.length < 4) return undefined;
  const [startLine, startChar, endLine, endChar] = value;
  if (
    !isFiniteNonNegativeInt(startLine) ||
    !isFiniteNonNegativeInt(startChar) ||
    !isFiniteNonNegativeInt(endLine) ||
    !isFiniteNonNegativeInt(endChar)
  ) {
    return undefined;
  }
  if (endLine < startLine) return undefined;
  if (endLine === startLine && endChar < startChar) return undefined;
  return {
    start: { line: startLine, character: startChar },
    end: { line: endLine, character: endChar }
  };
}

function parseHoverMessages(value: unknown): readonly PideDecorationHoverMessage[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) {
    const out: PideDecorationHoverMessage[] = [];
    for (const item of value) {
      const parsed = parseMarkedString(item);
      if (parsed) out.push(parsed);
    }
    return out;
  }
  const parsed = parseMarkedString(value);
  return parsed ? [parsed] : [];
}

function parseMarkedString(value: unknown): PideDecorationHoverMessage | undefined {
  // LSP MarkedString supports a string form as well as { language, value }.
  if (typeof value === "string") {
    return { language: "plaintext", value };
  }
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  const language = candidate.language;
  const stringValue = candidate.value;
  if (typeof language !== "string" || typeof stringValue !== "string") return undefined;
  return { language, value: stringValue };
}

function isFiniteNonNegativeInt(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0
  );
}

// ---------------------------------------------------------------------------
// Stable mapping from upstream `text_<color>` types to VS Code theme tokens.
//
// The `text_*` types come from `Rendering.Color.Value` in upstream Isabelle
// (`src/Tools/VSCode/src/lsp.scala:546-549` uses `text_color` to prepend
// `text_` to each color value). The list mirrors what jEdit uses for its
// own syntax coloring. We map only the entries that have a clear analogue
// in VS Code's standard theme color tokens — unknown / unmapped types
// produce a generic dimmed overlay so the user still sees that *something*
// PIDE-flavoured is happening without us inventing meaning.
// ---------------------------------------------------------------------------

export type PideDecorationStyleKind =
  | "keyword"
  | "controlKeyword"
  | "operator"
  | "type"
  | "typeParameter"
  | "variable"
  | "parameter"
  | "constant"
  | "string"
  | "comment"
  | "deprecated"
  | "error"
  | "warning"
  | "info"
  | "muted"
  | "raw";

export interface PideDecorationStyle {
  readonly kind: PideDecorationStyleKind;
  /** Theme color token used for `color` / `borderColor`, depending on `presentation`. */
  readonly themeColorId: string;
  /**
   * How to render the decoration:
   *   - `color`: change foreground color of the range
   *   - `underline`: add a wavy / solid underline (used for errors/warnings)
   *   - `background`: subtle background tint (used for muted/raw segments)
   *   - `border`: 1px border (used for entity highlights without color shift)
   */
  readonly presentation: "color" | "underline" | "background" | "border";
}

const KNOWN_STYLES: ReadonlyMap<string, PideDecorationStyle> = new Map<string, PideDecorationStyle>([
  // Major syntactic kinds.
  ["text_main", { kind: "variable", themeColorId: "editor.foreground", presentation: "color" }],
  ["text_keyword1", { kind: "keyword", themeColorId: "symbolIcon.keywordForeground", presentation: "color" }],
  ["text_keyword2", { kind: "keyword", themeColorId: "symbolIcon.keywordForeground", presentation: "color" }],
  ["text_keyword3", { kind: "keyword", themeColorId: "symbolIcon.keywordForeground", presentation: "color" }],
  ["text_quasi_keyword", { kind: "controlKeyword", themeColorId: "symbolIcon.classForeground", presentation: "color" }],
  ["text_operator", { kind: "operator", themeColorId: "symbolIcon.operatorForeground", presentation: "color" }],
  // Type expressions.
  ["text_tfree", { kind: "typeParameter", themeColorId: "symbolIcon.typeParameterForeground", presentation: "color" }],
  ["text_tvar", { kind: "typeParameter", themeColorId: "symbolIcon.typeParameterForeground", presentation: "color" }],
  // Term-level variables and bindings.
  ["text_free", { kind: "variable", themeColorId: "symbolIcon.variableForeground", presentation: "color" }],
  ["text_skolem", { kind: "variable", themeColorId: "symbolIcon.variableForeground", presentation: "color" }],
  ["text_bound", { kind: "parameter", themeColorId: "symbolIcon.fieldForeground", presentation: "color" }],
  ["text_var", { kind: "variable", themeColorId: "symbolIcon.variableForeground", presentation: "color" }],
  // Inner-syntax literals.
  ["text_inner_numeral", { kind: "constant", themeColorId: "symbolIcon.numberForeground", presentation: "color" }],
  ["text_inner_quoted", { kind: "string", themeColorId: "symbolIcon.stringForeground", presentation: "color" }],
  ["text_inner_cartouche", { kind: "string", themeColorId: "symbolIcon.stringForeground", presentation: "color" }],
  // Dynamic / class parameters.
  ["text_dynamic", { kind: "info", themeColorId: "editorInfo.foreground", presentation: "color" }],
  ["text_class_parameter", { kind: "parameter", themeColorId: "symbolIcon.fieldForeground", presentation: "color" }],
  // Antiquotation framing.
  ["text_antiquote", { kind: "string", themeColorId: "symbolIcon.stringForeground", presentation: "color" }],
  ["text_antiquoted", { kind: "string", themeColorId: "symbolIcon.stringForeground", presentation: "color" }],
  // Raw / plain text inside formal contexts.
  ["text_raw_text", { kind: "raw", themeColorId: "editorWidget.background", presentation: "background" }],
  ["text_plain_text", { kind: "muted", themeColorId: "descriptionForeground", presentation: "color" }],
  ["text_comment", { kind: "comment", themeColorId: "editorLineNumber.foreground", presentation: "color" }],
  // Status flags.
  ["text_bad", { kind: "error", themeColorId: "editorError.foreground", presentation: "underline" }],
  ["text_legacy", { kind: "deprecated", themeColorId: "editorWarning.foreground", presentation: "underline" }],
  ["text_intensify", { kind: "info", themeColorId: "editorInfo.foreground", presentation: "border" }],
  ["text_bullet", { kind: "muted", themeColorId: "descriptionForeground", presentation: "color" }]
]);

/**
 * Resolve the stable style for a `PIDE/decoration` entry type. Returns
 * `undefined` for unknown types so the caller can decide whether to
 * apply a fallback overlay or skip the entry entirely.
 *
 * Stability: this mapping is documented as part of the extension's
 * public-ish contract (it determines what users see when LSP-mode is
 * running). New mappings can be added freely; changing or removing an
 * existing mapping is a user-visible regression.
 */
export function resolvePideDecorationStyle(type: string): PideDecorationStyle | undefined {
  return KNOWN_STYLES.get(type);
}

/**
 * The set of decoration `type` values for which {@link resolvePideDecorationStyle}
 * returns a non-undefined style. Useful for tests that want to pin the
 * supported set explicitly.
 */
export function knownPideDecorationTypes(): readonly string[] {
  return Array.from(KNOWN_STYLES.keys());
}

// ---------------------------------------------------------------------------
// Pure policy helpers consumed by PideDecorationOverlayService.
// ---------------------------------------------------------------------------

export interface PideDecorationContentForPaint {
  readonly range: PideDecorationRange;
  readonly hoverMessages: readonly PideDecorationHoverMessage[];
}

/**
 * Group payload entries by their resolved style key, dropping entries
 * whose type does not map to a known style. Within a type, the content
 * order from the payload is preserved (matches upstream behavior so the
 * user can rely on later ranges overpainting earlier ones).
 *
 * Pure helper so the service does not have to repeat the
 * `resolvePideDecorationStyle` filtering inline.
 */
export function groupDecorationEntriesByKnownType(
  entries: readonly PideDecorationEntry[]
): ReadonlyMap<string, readonly PideDecorationContentForPaint[]> {
  const out = new Map<string, PideDecorationContentForPaint[]>();
  for (const entry of entries) {
    if (!resolvePideDecorationStyle(entry.type)) continue;
    let group = out.get(entry.type);
    if (!group) {
      group = [];
      out.set(entry.type, group);
    }
    for (const item of entry.content) {
      group.push({ range: item.range, hoverMessages: item.hoverMessages });
    }
  }
  return out;
}

export interface PideDecorationRequestPlan {
  /** URIs to send a fresh `PIDE/decoration_request` for in this pass. */
  readonly toRequest: readonly string[];
  /** Updated request memo set after this pass. */
  readonly nextRequested: ReadonlySet<string>;
}

/**
 * Decide which currently-visible URIs need a fresh
 * `PIDE/decoration_request` and update the memo set so we don't spam
 * the server with one request per visibility change.
 *
 * Policy:
 *   - When the LSP is not `running`, the plan is empty and the memo is
 *     cleared (the caller will clear its cache too).
 *   - Otherwise, every visible URI that is NOT already in the memo
 *     becomes a fresh request, and URIs that are no longer visible are
 *     evicted from the memo so a future re-show triggers a new request.
 *
 * Pure helper — the caller is responsible for actually sending the
 * notifications and tracking visibility.
 */
export function planDecorationRequests(
  visibleUris: Iterable<string>,
  alreadyRequested: ReadonlySet<string>,
  lspState: "disabled" | "starting" | "running" | "stopping" | "failed" | undefined
): PideDecorationRequestPlan {
  if (lspState !== "running") {
    return { toRequest: [], nextRequested: new Set<string>() };
  }
  const visibleSet = new Set<string>();
  for (const uri of visibleUris) visibleSet.add(uri);
  const toRequest: string[] = [];
  const nextRequested = new Set<string>();
  for (const uri of visibleSet) {
    if (!alreadyRequested.has(uri)) {
      toRequest.push(uri);
    }
    nextRequested.add(uri);
  }
  return { toRequest, nextRequested };
}
