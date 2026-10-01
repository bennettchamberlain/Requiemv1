import type { EntityManager } from 'typeorm';

/**
 * What an event purge took with the event.
 */
export interface EventPurgeResult {
  /**
   * The `ci.content` rows that hung off the purged events (`content.event_id`),
   * with the name each carried, so the caller can record what disappeared.
   */
  contents: Array<{ id: string; name: string | null }>;
}

/**
 * Everything that has to go before an event's own base row can be deleted, and
 * everything that would otherwise be left pointing at it afterwards. Runs inside
 * the caller's transaction, which then deletes the events' `ci.entities` rows
 * (the `ci.events` rows follow by `events_event_id_entities_fk`).
 *
 * Postgres cannot do this alone, for three reasons.
 *
 * 1. **Two foreign keys block the delete.** `hbpe.l1_event_cluster.event_id`
 *    references `ci.events` with no `ON DELETE` action, so a clustered event
 *    (194,203 of 198,747 on the reference corpus) cannot be deleted at all. And
 *    `content.event_id` cascades into `ci.content`, whose own HBPE links
 *    (`hbpe.l2_content_cluster`, `hbpe.content_context`) block that cascade in
 *    turn.
 * 2. **The cascade into `ci.content` is half a delete.** It removes the detail
 *    row and leaves the `ci.entities` base row, an orphan `Content` node with
 *    nothing behind it. `20260819014532_soft_delete_events_and_content_cascade`
 *    chose CASCADE because that content "has no independent existence" and named
 *    "a future purge" as the case it was for, so this deletes the content as
 *    whole aggregates rather than detaching it (which would strand it, the bug
 *    that migration fixed).
 * 3. **Nothing else is a foreign key.** `ci.relationships`, the pipeline
 *    ledgers, `ci.record_sources`, `ci_search.entity_tag` and the rest hold bare
 *    uuids, so deleting the event leaves them dangling. That is not cosmetic: a
 *    stale `ci.record_sources` row wins the `ON CONFLICT DO NOTHING` when the
 *    same source record is imported again, and the re-created event is left
 *    with no provenance.
 *
 * `hbpe.l1_clusters.member_count` is decremented by exactly the memberships
 * deleted (never below zero). HBPE only ever increments it, and it orders each
 * user's top-50 L1 vocabulary, so leaving it high would rank a cluster by
 * events that no longer exist. A cluster that loses its last member stays: the
 * staleness sweep retires inactive clusters, and its label is part of the token
 * corpus.
 *
 * The search index (`ci_search.vectors` / `embeddings` / `index_skips`) is not
 * touched here. The caller announces `EventRemovedEvent` / `ContentRemovedEvent`
 * after the commit, which is how every other delete reaches it, and the nightly
 * orphan sweep covers a delivery that never arrives.
 *
 * Deliberately left alone:
 * - Rows whose foreign key is `SET NULL` survive, detached: `ci.capture_events`,
 *   `ci.files`, `ci.receipts`, `ci.object_observations`, `ci.event_candidates`,
 *   and the other occurrences of a recurring series. A file's bytes have their
 *   own lifecycle.
 * - `ci.graph_deltas` is the audit trail; every other physical delete keeps it.
 * - `ci.entity_merges` is a ledger.
 *
 * `eventPurge.catalog.integration.spec.ts` reads the foreign keys out of the
 * catalog and fails when one appears that this does not account for, so a new
 * blocking reference breaks a test instead of an agent's tool call.
 */
export async function purgeEventDependents(
  manager: EntityManager,
  scope: { ownerUserId: string; eventIds: string[] },
): Promise<EventPurgeResult> {
  const { ownerUserId, eventIds } = scope;

  if (eventIds.length === 0) {
    return { contents: [] };
  }

  // Lock the rows first. HBPE assigns clusters from its own connection, and an
  // insert into `l1_event_cluster` takes a key-share lock on its event: without
  // this, one landing between the membership delete below and the event delete
  // at commit fails the whole purge on the very constraint it just cleared.
  // Holding the locks makes that insert wait, then fail cleanly on its own side.
  await manager.query('SELECT 1 FROM ci.events WHERE event_id = ANY($1::uuid[]) FOR UPDATE', [eventIds]);

  const contents: Array<{ id: string; name: string | null }> = await manager.query(
    `SELECT c.id, e.name
       FROM ci.content c
       JOIN ci.entities e ON e.entity_id = c.id AND e.entity_type = 'Content'
      WHERE c.event_id = ANY($1::uuid[])
        FOR UPDATE OF c`,
    [eventIds],
  );
  const contentIds = contents.map((content) => content.id);
  const entityIds = [...eventIds, ...contentIds];

  await manager.query(
    `WITH gone AS (
       DELETE FROM hbpe.l1_event_cluster WHERE event_id = ANY($1::uuid[]) RETURNING cluster_id
     ), per_cluster AS (
       SELECT cluster_id, count(*)::int AS members FROM gone GROUP BY cluster_id
     )
     UPDATE hbpe.l1_clusters c
        SET member_count = GREATEST(c.member_count - p.members, 0), updated_at = now()
       FROM per_cluster p
      WHERE c.cluster_id = p.cluster_id`,
    [eventIds],
  );

  if (contentIds.length > 0) {
    await manager.query(
      `WITH gone AS (
         DELETE FROM hbpe.l2_content_cluster WHERE content_id = ANY($1::uuid[]) RETURNING cluster_id
       ), per_cluster AS (
         SELECT cluster_id, count(*)::int AS members FROM gone GROUP BY cluster_id
       )
       UPDATE hbpe.l2_clusters c
          SET member_count = GREATEST(c.member_count - p.members, 0), updated_at = now()
         FROM per_cluster p
        WHERE c.cluster_id = p.cluster_id`,
      [contentIds],
    );
    await manager.query('DELETE FROM hbpe.content_context WHERE content_id = ANY($1::uuid[])', [contentIds]);
  }

  // Both directions: `ci.relationships` has no foreign key to `ci.entities`, so
  // an edge pointing AT a deleted node survives it as a ghost.
  await manager.query(
    `DELETE FROM ci.relationships
      WHERE owner_user_id = $1
        AND (from_entity_id = ANY($2::uuid[]) OR to_entity_id = ANY($2::uuid[]))`,
    [ownerUserId, entityIds],
  );

  // Keyed by id alone: a uuid names one entity, whatever type string a given
  // table spells it with.
  for (const table of ['ci.pipeline_state', 'ci.pipeline_dead_letters', 'ci.entity_identifiers'] as const) {
    await manager.query(`DELETE FROM ${table} WHERE entity_id = ANY($1::uuid[])`, [entityIds]);
  }

  for (const table of ['ci_search.entity_tag', 'ci_search.entity_categories'] as const) {
    await manager.query(`DELETE FROM ${table} WHERE entity_id = ANY($1::uuid[])`, [entityIds]);
  }

  // Scoped the way the ledger's own index is, (user, table, record), so this is
  // an index range scan rather than a pass over every record the user imported.
  await manager.query(
    `DELETE FROM ci.record_sources
      WHERE user_id = $1
        AND ((record_table = 'events' AND record_id = ANY($2::uuid[]))
          OR (record_table = 'content' AND record_id = ANY($3::uuid[])))`,
    [ownerUserId, eventIds, contentIds],
  );

  // `parent_event_id` carries no foreign key, so a child keeps pointing at a
  // parent that is gone. SET NULL is what its sibling `recurrence_parent_id`
  // does and what the planning migration says this column was meant to do.
  await manager.query(
    'UPDATE ci.events SET parent_event_id = NULL WHERE user_id = $1 AND parent_event_id = ANY($2::uuid[])',
    [ownerUserId, eventIds],
  );

  // The content goes as aggregates, base row first: that cascades to the detail
  // row, where deleting only the detail (what the event's cascade would do)
  // leaves a `Content` node behind.
  if (contentIds.length > 0) {
    await manager.query(
      "DELETE FROM ci.entities WHERE entity_type = 'Content' AND entity_id = ANY($1::uuid[])",
      [contentIds],
    );
  }

  return { contents };
}
