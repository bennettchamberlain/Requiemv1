import { defineEvent } from '@ci/domains/events';

/**
 * Request a post-load search-index pass — embeddings + keyword tsvectors —
 * scoped to the entity types a bulk load wrote, without a compile-time
 * dependency between the emitter's domain and the consumer's.
 *
 * The emitter that exists for: the import domain's `PushStage`, whose post-push
 * kick cannot inject the indexing services directly (the module dependency
 * would close the cycle maintenance → llm → tools → import). Riding pg-boss
 * also makes the kick durable: a process killed between the push completing and
 * the sweep starting still has the job.
 *
 * CONSUMED BY THE PIPELINE DOMAIN, not maintenance: since the per-entity-type
 * `index.embed_*` / `index.vector*` stages landed, the request starts ledger
 * sweeps (`PipelineDispatchService.startSweep`) rather than the old
 * `SearchIndexBackfillService` — every row indexed off an import is recorded in
 * `ci.pipeline_state` with an outcome and a version. The event stays declared
 * here because the name is the wire contract and ids-on-the-wire are permanent;
 * the constant's home is a detail.
 *
 * Dogpile safety is the ledger's: a sweep re-requested while one runs selects
 * only rows still unclaimed, so a burst of requests degrades to empty hops, not
 * duplicate work.
 *
 * @see SearchIndexSweepRequestListener (domains/pipeline/listeners) - the consumer
 */
export const SearchIndexBackfillRequestEvent = 'maintenance.search-index-backfill-request';

/** Dedicated PGBoss queue so backfill requests don't block the default queue. */
export const SEARCH_INDEX_BACKFILL_QUEUE = 'search-index-backfill';

/**
 * Event payload of {@link SearchIndexBackfillRequestEvent}.
 */
export type SearchIndexBackfillRequestPayload = {
  /**
   * The user whose rows the sweeps cover. Pipeline sweeps are user-scoped by
   * design (`ci.pipeline_state` and every source query key on the owner), so a
   * request without a user cannot be started and is refused by the listener.
   */
  userId?: string;
  /**
   * Restrict the pass to these entity types. Plain strings rather than a
   * domain union so emitters don't need the import; the listener validates and
   * drops unknown values. Omitted → every indexable type.
   */
  entityTypes?: string[];
  /** Free-form provenance for the log line, e.g. `import-run:<uuid>`. */
  requestedBy?: string;
};

defineEvent<SearchIndexBackfillRequestPayload>(SearchIndexBackfillRequestEvent);

declare module '@ci/domains/events/registry' {
  interface EventRegistry {
    [SearchIndexBackfillRequestEvent]: SearchIndexBackfillRequestPayload;
  }
}
