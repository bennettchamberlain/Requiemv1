import { AVAILABLE_ENTITY_TYPES } from '@/components/SearchBox/useDropdown';

// Every URL param the explorer toolbar can set. The full-reset affordances —
// the header search box's X and the drop area's `Clear all` — remove all of
// them; `countActiveFilters` powers the "N filters" indicators. `search` is
// excluded — it lives in the always-visible search box and reads as its own
// affordance.
export const FILTER_PARAMS = [
  'includedEntityTypes',
  'excludedEntityTypes',
  'eventTypes',
  'tags',
  'from',
  'to',
  'sortBy',
  'sortOrder',
  'connectors',
  'people',
  'places',
  'hasLocation',
  'semantic',
  'bbox',
] as const;

/**
 * Entity types are filtered either by an exclude-list (the toolbar's own type
 * picker) or by an externally-applied include-list (e.g. a graph-explorer deep
 * link). The include-list takes precedence, mirroring the search dropdown's URL
 * sync. Returns the types still selected when a type filter narrows the set,
 * or null when no type filter is active.
 */
export function narrowedEntityTypes(params: URLSearchParams): string[] | null {
  const total = AVAILABLE_ENTITY_TYPES.length;
  const included = params.get('includedEntityTypes')?.split(',').filter(Boolean) ?? [];

  if (included.length) {
    const selected = AVAILABLE_ENTITY_TYPES.filter((type) => included.includes(type));

    return selected.length < total ? selected : null;
  }

  const excluded = params.get('excludedEntityTypes')?.split(',').filter(Boolean) ?? [];
  const selected = AVAILABLE_ENTITY_TYPES.filter((type) => !excluded.includes(type));

  return selected.length < total ? selected : null;
}

/** Number of distinct active filter dimensions (for the "N filters" indicators). */
export function countActiveFilters(params: URLSearchParams): number {
  let count = 0;

  if (narrowedEntityTypes(params) !== null) {
    count += 1;
  }

  for (const key of ['connectors', 'eventTypes', 'people', 'places', 'tags']) {
    count += params.get(key)?.split(',').filter(Boolean).length ?? 0;
  }

  if (params.get('from') || params.get('to')) {
    count += 1;
  }

  if (params.get('hasLocation') === '1') {
    count += 1;
  }

  if (params.get('semantic') === '1') {
    count += 1;
  }

  if (params.get('bbox')) {
    count += 1;
  }

  return count;
}
