import { CommandSpan, ProtocolRange } from "../protocol/messages";

export type IsabelleEntityKind =
  | "theorem"
  | "lemma"
  | "corollary"
  | "proposition"
  | "schematic_goal"
  | "definition"
  | "abbreviation"
  | "fun"
  | "function"
  | "primrec"
  | "primcorec"
  | "inductive"
  | "inductive_set"
  | "coinductive"
  | "datatype"
  | "codatatype"
  | "record"
  | "typedef"
  | "typedecl"
  | "type_synonym"
  | "lift_definition"
  | "locale"
  | "class"
  | "section"
  | "subsection"
  | "subsubsection"
  | "theory";

export interface IsabelleTheoryEntity {
  kind: IsabelleEntityKind;
  name: string;
  range: ProtocolRange;
  spanId: string;
}

export const THEORY_ENTITY_KINDS: ReadonlyArray<IsabelleEntityKind> = [
  "theorem",
  "lemma",
  "corollary",
  "proposition",
  "schematic_goal",
  "definition",
  "abbreviation",
  "fun",
  "function",
  "primrec",
  "primcorec",
  "inductive",
  "inductive_set",
  "coinductive",
  "datatype",
  "codatatype",
  "record",
  "typedef",
  "typedecl",
  "type_synonym",
  "lift_definition",
  "locale",
  "class",
  "section",
  "subsection",
  "subsubsection",
  "theory"
];

const ENTITY_KIND_SET: ReadonlySet<string> = new Set(THEORY_ENTITY_KINDS);

const SECTION_KIND_SET: ReadonlySet<string> = new Set<IsabelleEntityKind>([
  "section",
  "subsection",
  "subsubsection"
]);

export function isTheoryEntityKind(kind: string): kind is IsabelleEntityKind {
  return ENTITY_KIND_SET.has(kind);
}

/**
 * Derives local theory entities from synchronized command spans. This is a
 * syntactic, local-only foundation: it inspects each span's `kind` and `name`
 * (as produced by `extractCommandSpans`) and does not consult PIDE entity
 * metadata.
 *
 * Section/subsection/subsubsection entities are best-effort: they only appear
 * when the originating span exposes a usable `name` (current
 * `extractCommandSpans` does not derive section titles from trailing text, so
 * such entities are omitted today; future increments may pre-populate them).
 */
export function extractTheoryEntities(spans: readonly CommandSpan[]): IsabelleTheoryEntity[] {
  const entities: IsabelleTheoryEntity[] = [];

  for (const span of spans) {
    if (!isTheoryEntityKind(span.kind)) {
      continue;
    }

    const name = entityName(span);
    if (!name) {
      continue;
    }

    entities.push({
      kind: span.kind,
      name,
      range: span.range,
      spanId: span.id
    });
  }

  return entities;
}

export function groupEntitiesByKind(
  entities: readonly IsabelleTheoryEntity[]
): Record<IsabelleEntityKind, IsabelleTheoryEntity[]> {
  const grouped = emptyGrouping();
  for (const entity of entities) {
    grouped[entity.kind].push(entity);
  }
  return grouped;
}

function entityName(span: CommandSpan): string | undefined {
  if (typeof span.name === "string" && span.name.length > 0) {
    return span.name;
  }

  if (SECTION_KIND_SET.has(span.kind)) {
    return undefined;
  }

  return undefined;
}

function emptyGrouping(): Record<IsabelleEntityKind, IsabelleTheoryEntity[]> {
  const grouped = {} as Record<IsabelleEntityKind, IsabelleTheoryEntity[]>;
  for (const kind of THEORY_ENTITY_KINDS) {
    grouped[kind] = [];
  }
  return grouped;
}
