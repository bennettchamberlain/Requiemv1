import type { IndexableEntity } from '@ci/domains/search-next';

/** Entity types shown in the Memory explorer browse when no type filter is active. */
export const BROWSE_INDEXABLE_TYPES: readonly IndexableEntity[] = [
  'browser-activity',
  'communication',
  'content',
  'event',
  'file',
  'note',
  'person',
  'place',
  'item',
  'answer',
  'concept',
] as const;

/** Rollup `ci.activity_rollup.source` keys (messages omitted — not in the browse surface). */
export const ROLLUP_SOURCE_BY_INDEXABLE: Partial<Record<IndexableEntity, string>> = {
  communication: 'communications',
  content: 'content',
  event: 'events',
  file: 'files',
  note: 'notes',
  answer: 'answers',
};

/** Graph entity rows in `ci.entities` counted outside the generic entities rollup bucket. */
export const GRAPH_ENTITY_TYPE_BY_INDEXABLE: Partial<Record<IndexableEntity, string>> = {
  person: 'Person',
  place: 'Location',
  concept: 'Concept',
};

export interface ActivityTimelineFilters {
  includeTypes?: IndexableEntity[];
  excludeTypes?: IndexableEntity[];
  eventTypes?: string[];
  connectors?: string[];
  people?: string[];
  places?: string[];
  tags?: string[];
  query?: string;
}

export function resolveBrowseIndexableTypes(
  includeTypes?: IndexableEntity[],
  excludeTypes?: IndexableEntity[],
): IndexableEntity[] {
  const excluded = new Set(excludeTypes ?? []);

  if (includeTypes != null && includeTypes.length > 0) {
    return includeTypes.filter((type) => !excluded.has(type));
  }

  return BROWSE_INDEXABLE_TYPES.filter((type) => !excluded.has(type));
}

export function rollupSourcesForTypes(types: IndexableEntity[]): string[] {
  const sources = new Set<string>();

  for (const type of types) {
    const source = ROLLUP_SOURCE_BY_INDEXABLE[type];

    if (source) {
      sources.add(source);
    }
  }

  return [...sources];
}

export function graphEntityTypesForTypes(types: IndexableEntity[]): string[] {
  return types
    .map((type) => GRAPH_ENTITY_TYPE_BY_INDEXABLE[type])
    .filter((value): value is string => value != null);
}
