/**
 * Selective-skip predicates for dense embedding.
 *
 * Callers that embed arbitrary entities (e.g. graph nodes pushed via
 * `SEARCH_EMBED_ENTITY`) need a single place to decide whether a given
 * `(entityType, searchContent)` pair is worth embedding, and — when it is —
 * which canonical search-vocabulary type it should be stored under.
 *
 * Two vocabularies are in play:
 *  - the lowercase *search* vocabulary used by `ci_search.embeddings` and
 *    queried by SearchService (mirrors search-next's `INDEXABLE_ENTITIES`);
 *  - the capitalized *graph* NER vocabulary emitted by GraphEventService
 *    (`Person`, `Concept`, `Location`, …).
 *
 * We normalize the graph vocabulary onto the search vocabulary so graph nodes
 * land in the same embedding space the search queries hit. The graph<->search
 * correspondence mirrors the explorer bridge in
 * `domains/memory/graph.types.ts` (`EXPLORER_TO_GRAPH_ENTITY_TYPES`).
 */

/**
 * Canonical search-vocabulary entity types that have a dense embedding in
 * `ci_search.embeddings`. Kept as plain literals (rather than imported from the
 * search domain) so this module stays dependency-free — the search domain
 * already depends on `@ci/common/embeddings`. Keep in sync with
 * search-next's `INDEXABLE_ENTITIES`.
 */
const EMBEDDABLE_SEARCH_TYPES = new Set<string>([
  'answer',
  'browser-activity',
  'communication',
  'concept',
  'content',
  'event',
  'file',
  'item',
  'message',
  'note',
  'person',
  'place',
  'thread',
]);

/**
 * Graph NER `entity_type` values mapped onto the search vocabulary. Anything not
 * listed falls back to a lowercase comparison, so a source that already speaks
 * the search vocabulary (e.g. `person`) passes through unchanged.
 */
const GRAPH_TYPE_ALIASES: Record<string, string> = {
  Person: 'person',
  Contact: 'person',
  Concept: 'concept',
  Location: 'place',
  Place: 'place',
  Object: 'item',
  Thing: 'item',
  Item: 'item',
  Event: 'event',
  Content: 'content',
  File: 'file',
};

/**
 * Resolve a source/graph entity type onto the canonical (lowercase) search
 * vocabulary, or `null` when the type has no embeddable representation.
 */
export function normalizeEmbeddableType(entityType: string | null | undefined): string | null {
  if (entityType == null) {
    return null;
  }

  const candidate = GRAPH_TYPE_ALIASES[entityType] ?? entityType.toLowerCase();

  return EMBEDDABLE_SEARCH_TYPES.has(candidate) ? candidate : null;
}

/**
 * Whether an entity of the given type should be embedded at all.
 */
export function shouldEmbedType(entityType: string | null | undefined): boolean {
  return normalizeEmbeddableType(entityType) !== null;
}

/**
 * Returns a human-readable reason to skip embedding, or `null` when the entity
 * is embeddable. Guards against empty content and non-embeddable types so
 * callers can log-and-drop uniformly instead of generating wasted embeddings.
 */
export function embedSkipReason(input: {
  entityType?: string | null;
  searchContent?: string | null;
}): string | null {
  if (input.searchContent == null || input.searchContent.trim().length === 0) {
    return 'search content is empty';
  }

  if (!shouldEmbedType(input.entityType)) {
    return `entity type "${input.entityType ?? '(unspecified)'}" is not embeddable`;
  }

  return null;
}
