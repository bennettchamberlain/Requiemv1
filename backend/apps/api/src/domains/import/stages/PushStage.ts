import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { LoggerService } from '@ci/common/logging';
import { BrowserActivityService } from '@ci/domains/browser-activity';
import { EventService as SignallingEventService } from '@ci/domains/events';
import { type GraphEntityInputDto, GraphIngestService } from '@ci/domains/graph';
// The events leaf, NOT the maintenance barrel: the barrel would close the
// module cycle maintenance → llm → tools → import.
import { SEARCH_INDEX_BACKFILL_QUEUE, SearchIndexBackfillRequestEvent } from '@ci/domains/maintenance/events';
import { CommunicationService, ContentService, EventService, ItemService } from '@ci/domains/memory';
import { PositionService } from '@ci/domains/position';

import type { StagedEntity } from '../entities/StagedEntityEntity';
import type { StagedItem } from '../entities/StagedItemEntity';
import {
  backfillEntityTypesFor,
  destinationsFor,
  toCanonical,
  type CanonicalRecord,
  type Destination,
} from '../push/canonical';
import { isGraphExcluded, toGraphEntity } from '../push/entities';
import {
  isFacebookMessengerRecord,
  isWhatsAppRecord,
  toBrowserActivityInput,
  toCommunicationInput,
  toContentInput,
  toEventInput,
  toFacebookMessengerCommunicationInput,
  toInventoryInput,
  toPositionInput,
  toWhatsAppCommunicationInput,
} from '../push/inputs';
import { type IsSelf, makeIsSelf, NOBODY_IS_SELF, readSelfIdentity } from '../push/self';
import {
  DATABASE_FREE_FLOOR_BYTES,
  DatabaseVolumeFullError,
  isOutOfDiskError,
  readDatabaseSpace,
  type DatabaseSpace,
} from '../storage/databaseSpace';
import type { ImportStageRunner, StageOutcome, StageRunContext } from '../types';

/** Staged rows read (and pushed) per batch. */
const PUSH_BATCH = 500;

/**
 * The order a batch's destinations are written in.
 *
 * The per-row loop this replaced wrote each row's destinations in
 * `destinationsFor` order; keeping a fixed order here preserves that for every
 * row at once — an Audible listen still reaches `content` before `events`.
 */
const DESTINATION_ORDER: readonly Destination[] = [
  'communications',
  'content',
  'events',
  'inventory',
  'browser_activity',
  'position',
];

/** One staged row's journey through a batch: what it is, where it goes, what happened. */
interface RowPlan {
  row: StagedItem;
  record: CanonicalRecord;
  destinations: Destination[];
  participants: Map<string, string[]>;
  /** True once ANY destination reported a write for this row. */
  wrote: boolean;
  /** Set only by the per-row retry, and only for a genuine failure. */
  failure: string | null;
}

/**
 * How often the push re-measures the database volume mid-run.
 *
 * `pg_database_size` stats every file the database owns, so this cannot be
 * per-batch: a 460k-row import is ~920 batches. Fifteen seconds is far shorter
 * than the time it takes to write {@link DATABASE_FREE_FLOOR_BYTES} of rows,
 * which is what the reading has to stay ahead of.
 */
const SPACE_CHECK_INTERVAL_MS = 15_000;

/** What one batch's fan-out produced, per destination. */
type DestinationCounts = Partial<Record<Destination, number>>;

/**
 * Send staged rows into `ci.*`.
 *
 * The stage that makes an import real: everything before it wrote to a scratchpad
 * that is deleted with the run. It fans each staged row out through
 * `destinationsFor` — one row can legitimately reach several destinations, a
 * geotagged photo being both a timeline capture and a GPS donor — and calls the
 * in-process services rather than an HTTP client, which is the whole reason
 * upstream's 8.6k-line transport layer does not come along.
 *
 * ## Resumability
 *
 * Push state is per-row, not a cursor. Each staged item carries its own
 * `push_status`, so a poisoned record sits at `failed` while the rest of the run
 * completes, and a resumed push costs O(remaining) rather than re-sending
 * everything before the failure. That is also why this reads by
 * `push_status = 'pending'` rather than by offset: the query IS the resume
 * point, and it shrinks as the run drains.
 *
 * The counters do NOT shrink with it: a resume seeds them from the rows the
 * ledger already holds settled, so `processed`/`total` carry on from where the
 * dead attempt stopped rather than restarting against the remainder.
 *
 * ## Idempotency belongs to the destination
 *
 * Nothing here checks whether a record already exists. Every input carries the
 * `(source_type, source_system, source_id)` triple, and each destination table
 * has a `*_source_triple_uniq` index over it, so a re-push is a no-op decided by
 * the database. Re-implementing that check here would be a second answer to a
 * question `ci.*` already answers — and the two would drift.
 *
 * ## Running out of disk is a STAGE failure, not a row failure
 *
 * The per-row quarantine above is right for a poisoned record and catastrophic
 * for a full volume: nothing about the next row is different, so a disk-full
 * push marched through the remaining rows marking every one of them `failed`,
 * hammering a full database on the way, and finished "partial" over an import
 * that had simply run out of room. The real incident surfaced as an OCI error
 * from the container runtime with nothing in the import saying what happened.
 *
 * So the stage watches the database's own volume — see `storage/databaseSpace`
 * — and stops on the first sign of the end: a free-space reading under the
 * floor, or SQLSTATE 53100 from any row. Stopping leaves the untouched rows
 * `pending`, which is exactly the state the push resumes from once somebody
 * frees space.
 */
@Injectable()
export class PushStage implements ImportStageRunner {
  readonly kind = 'push' as const;

  /** When {@link assertDatabaseHasRoom} last measured. See SPACE_CHECK_INTERVAL_MS. */
  private lastSpaceCheck = 0;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly communications: CommunicationService,
    private readonly contents: ContentService,
    private readonly events: EventService,
    private readonly items: ItemService,
    private readonly positions: PositionService,
    private readonly browserActivity: BrowserActivityService,
    private readonly graph: GraphIngestService,
    private readonly signals: SignallingEventService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(PushStage.name);
  }

  async run(context: StageRunContext): Promise<StageOutcome> {
    // The other half of the disk budget. `archive/unpack` preflights the
    // SCRATCH volume before extracting; this is the volume the rows land on,
    // and until now nothing measured it at all.
    const space = await this.assertDatabaseHasRoom(context);

    // What earlier attempts already settled — read BEFORE `pushEntities` moves
    // rows off 'pending', or this attempt's own work would be counted twice.
    const prior = await this.settledCounts(context.runId);

    // Entities first, always. A communication names its participants by server
    // entity id, so the people have to exist — and be recorded in
    // `entity_mappings` — before the record that points at them is built.
    const attempt = await this.pushEntities(context);

    const entities = {
      resolved: prior.entities.resolved + attempt.resolved,
      skipped: prior.entities.skipped + attempt.skipped,
      failed: prior.entities.failed + attempt.failed,
    };

    // Entities count toward this stage's total, because resolving them IS part
    // of its work — and because the parse stage already counts them, so leaving
    // them out made the two steps disagree about the same import. A real Amazon
    // archive read 10,890 and saved 10,808, and the missing 82 were exactly the
    // entities: not a loss, but nothing on the page said so.
    //
    // Taken from the outcome rather than a second COUNT: `pushEntities` has
    // already moved these rows off 'pending', so counting them now would return
    // zero. On a resumed push the outcome alone would ALSO be zero — those
    // entities were settled by the earlier attempt — which is what the prior
    // ledger counts folded in above restore.
    const entitiesProcessed = entities.resolved + entities.skipped + entities.failed;

    // Per-destination counts cover this attempt only: the ledger records THAT a
    // row settled, not where it landed, so a resume cannot reconstruct them.
    const counts: DestinationCounts = {};
    let pushed = prior.items.pushed;
    let deduped = prior.items.deduped;
    let failed = prior.items.failed;

    const total = (await this.pendingCount(context.runId)) + entitiesProcessed + pushed + deduped + failed;

    await context.progress({
      processed: entitiesProcessed + pushed + failed + deduped,
      total,
      phase: 'pushing',
    });

    let latestSpace = space;

    // Who "me" is, resolved ONCE for the whole run. WhatsApp and Messenger
    // decide each message's direction by matching its sender against the owner
    // (see push/self), and a run is hundreds of thousands of records — this
    // cannot be a per-record, or even a per-batch, lookup. Unconditional
    // rather than deferred until the first chat record: it is one owner-scoped
    // query per run, which is cheaper than the state needed to defer it.
    const isSelf = await this.resolveIsSelf(context);

    for (;;) {
      const batch = await this.nextBatch(context.runId);

      if (batch.length === 0) {
        break;
      }

      const outcome = await this.pushBatch(context, batch, counts, isSelf);

      pushed += outcome.pushed;
      failed += outcome.failed;
      deduped += outcome.deduped;

      await context.progress({
        processed: entitiesProcessed + pushed + failed + deduped,
        total,
        phase: 'pushing',
      });

      // On a timer, not per batch. `pg_database_size` stats every file the
      // database owns, so at 500 rows a batch a 460k-row import would run it
      // ~920 times; a volume with gigabytes of headroom cannot cross the floor
      // inside fifteen seconds of pushing.
      latestSpace = await this.assertDatabaseHasRoom(context, latestSpace);
    }

    // Everything is in ci.* now; make it searchable. Bulk-pushed rows emit no
    // per-row *CreatedEvent, so without this kick they wait for the pipeline's
    // hourly index sweeps.
    const searchIndex = await this.kickSearchIndexBackfill(context, counts, entities.resolved);

    return {
      // Every staged row is RESOLVED one way or another, and this stage's work
      // is examining all of them — so all three outcomes count toward progress.
      // Reporting only `pushed` made the bar climb to 100% during the push and
      // then jump BACKWARDS when the stage completed: a real import showed
      // 5.8k/10.8k and read as though half of it had failed, when most of the
      // remainder was content that already existed. Whether the work went well
      // is what `partial` and the breakdown below say; this number is progress.
      processed: entitiesProcessed + pushed + deduped + failed,
      total,
      // Rows that could not be sent are not a failed import — the ones that went
      // are in ci.* and useful. The run says `partial` and the ledger says which.
      partial: failed > 0 || entities.skipped > 0,
      // `deduped` is reported separately from `pushed`: it is a real outcome
      // (the record is in ci.*, it just arrived earlier) and reads as neither a
      // write nor a loss.
      detail: {
        pushed,
        deduped,
        failed,
        destinations: counts,
        entities,
        // Reported whether or not it was ever close to the floor. An import
        // that filled a volume is obvious afterwards; what nobody could see is
        // how much room the last one left, which is the number that says
        // whether the next one will fit.
        storage: {
          databaseBytes: latestSpace.databaseBytes,
          databaseFreeBytes: latestSpace.freeBytes,
          databaseDataDir: latestSpace.dataDir,
        },
        // What the post-push search-index kick did (absent when nothing was
        // written, so there was nothing to index).
        ...(searchIndex ? { searchIndex } : {}),
      },
    };
  }

  /**
   * Post-push search-index kick: request pipeline sweeps of the `index.embed_*`
   * and `index.vector*` stages for exactly the entity types this push wrote, so
   * imported rows become searchable (embeddings + keyword tsvectors) with every
   * row's outcome recorded in `ci.pipeline_state`. Requested over pg-boss
   * ({@link SearchIndexBackfillRequestEvent}, consumed by the pipeline domain's
   * `SearchIndexSweepRequestListener`) rather than by injecting a service: the
   * module dependency would close the cycle maintenance → llm → tools → import,
   * and the queued job survives a process killed between the push completing
   * and the sweeps starting.
   *
   * `person` rides along whenever the entity lane resolved anything: pushed
   * people are raw `GraphIngestService` upserts that emit no `PersonCreatedEvent`,
   * so without the sweep they are never searchable. `entities.resolved` is the
   * CUMULATIVE count (prior attempts included) because a resumed push may be
   * re-running precisely because the attempt that resolved them died before
   * this kick.
   *
   * Fail-soft by design: the rows are safely in `ci.*` and the sweep is
   * idempotent, so a failure to enqueue the request must not fail — or retry —
   * the push stage. It is reported in the stage detail instead, and the missing
   * rows remain exactly what the next sweep (or a manual orchestrate) picks up.
   *
   * Scope caveat, deliberate: destination counts exist for THIS attempt only
   * (the ledger records that a row settled, not where it landed), so a resumed
   * push whose earlier attempt wrote rows and died before kicking requests only
   * what the resume itself wrote. Widening that would mean sweeping every type
   * on every resume; the un-swept remainder is what `/v1/ingest/finish` and the
   * CLI `backfill` command exist for.
   */
  private async kickSearchIndexBackfill(
    context: StageRunContext,
    counts: DestinationCounts,
    entitiesResolved: number,
  ): Promise<Record<string, unknown> | null> {
    const wrote = (Object.entries(counts) as Array<[Destination, number]>)
      .filter(([, count]) => count > 0)
      .map(([destination]) => destination);

    const entityTypes: string[] = [...backfillEntityTypesFor(wrote)];
    if (entitiesResolved > 0) {
      entityTypes.push('person');
    }

    if (entityTypes.length === 0) {
      return null;
    }

    try {
      await this.signals.send(
        SearchIndexBackfillRequestEvent,
        // userId scopes the pipeline sweeps the listener starts — they are
        // per-user by design, like everything on the ledger.
        { userId: context.userId, entityTypes, requestedBy: `import-run:${context.runId}` },
        { queue: SEARCH_INDEX_BACKFILL_QUEUE },
      );
      this.logger.log('Post-push search-index backfill requested', {
        runId: context.runId,
        entityTypes,
      });

      return { requested: entityTypes };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn('Post-push search-index request failed; rows remain for the next sweep', {
        runId: context.runId,
        entityTypes,
        error: message,
      });

      return { requested: entityTypes, error: message };
    }
  }

  /**
   * Stop before the database volume runs out, rather than after.
   *
   * Returns the reading so the caller can report it. Throttled to
   * {@link SPACE_CHECK_INTERVAL_MS}: passing the previous reading in means a
   * mid-push call inside the window returns it unchanged instead of paying for
   * another `pg_database_size`. The first call of a stage always measures.
   *
   * A volume this process cannot see (`freeBytes: null` — the api and the
   * database in separate containers with no shared mount, and
   * `CI_IMPORT_DB_DATA_DIR` unset) is not treated as full: the push proceeds
   * and relies on {@link isOutOfDiskError} to turn the eventual write failure
   * into the same message. Guessing "full" from an unreadable probe would
   * refuse every import on the shipped topology.
   */
  private async assertDatabaseHasRoom(
    context: StageRunContext,
    previous?: DatabaseSpace,
  ): Promise<DatabaseSpace> {
    const now = Date.now();

    if (previous != null && now - this.lastSpaceCheck < SPACE_CHECK_INTERVAL_MS) {
      return previous;
    }

    this.lastSpaceCheck = now;

    const space = await readDatabaseSpace(this.dataSource);

    if (space.freeBytes != null && space.freeBytes < DATABASE_FREE_FLOOR_BYTES) {
      const error = new DatabaseVolumeFullError(
        space,
        `the push stops while at least ${DATABASE_FREE_FLOOR_BYTES / 1024 ** 3}GiB of headroom is ` +
          `required for the database to stay recoverable`,
      );

      this.logger.error(error, { runId: context.runId });

      throw error;
    }

    return space;
  }

  /**
   * Resolve every staged entity to a `ci.entities` row, and remember what it
   * became.
   *
   * Resolution goes through `GraphIngestService`, which upserts on
   * `(owner_user_id, entity_type, 'import:<sourceSystem>', uuidv5(key))` — so
   * this is cheap to repeat and safe to resume: the second run of a stage that
   * died halfway re-resolves the entities it already did and gets the same ids
   * back. It also indexes each entity's emails and phones into
   * `ci.entity_identifiers`, which is how a person imported from one export is
   * later matched to the same person in another.
   *
   * Only an entity with neither a handle nor a name is SKIPPED — there is
   * nothing to key it on, so every run would mint another row for it.
   *
   * Batched deliberately: `ingest` resolves a whole array in a bounded number of
   * statements, and entity counts here are small next to item counts (82 against
   * 10,808 in a real Amazon archive), so one call covers the run.
   */
  private async pushEntities(
    context: StageRunContext,
  ): Promise<{ resolved: number; skipped: number; failed: number }> {
    await context.progress({ processed: 0, total: null, phase: 'resolving people' });

    const staged = await this.dataSource.query<StagedEntity[]>(
      `SELECT id, run_id AS "runId", user_id AS "userId", type, name, metadata,
              identity_key AS "identityKey", data_source AS "dataSource"
         FROM ci_import.staged_entities
        WHERE run_id = $1::uuid AND push_status = 'pending'
        ORDER BY id`,
      [context.runId],
    );

    // Several staged rows can share a natural key — the same artist reached by
    // two parsers in one archive — so the key maps to a LIST. Ingest is given
    // each key once, and every staged row holding it gets the resulting id.
    const byKey = new Map<string, StagedEntity[]>();
    const inputs: GraphEntityInputDto[] = [];
    let skipped = 0;

    for (const row of staged) {
      // Bookkeeping types never reach the graph — see isGraphExcluded. Marked
      // `skipped` rather than left pending so the row reaches a terminal state
      // and a resumed push does not reconsider it.
      if (isGraphExcluded(row)) {
        skipped += 1;
        await this.markEntity(row.id, 'skipped', null);
        continue;
      }

      const input = toGraphEntity(row);

      if (input == null) {
        skipped += 1;
        await this.markEntity(row.id, 'skipped', null);
        continue;
      }

      const sharing = byKey.get(input.key);

      if (sharing) {
        sharing.push(row);
        continue;
      }

      byKey.set(input.key, [row]);
      inputs.push(input);
    }

    if (inputs.length === 0) {
      this.logger.log('Resolved staged entities', { runId: context.runId, resolved: 0, skipped, failed: 0 });

      return { resolved: 0, skipped, failed: 0 };
    }

    const result = await this.graph.ingest(
      { userId: context.userId },
      { entities: inputs, relationships: [] },
    );

    let resolved = 0;

    for (const mapping of result.entities) {
      for (const row of byKey.get(mapping.key) ?? []) {
        await this.recordEntityMapping(row.id, context.userId, mapping.entityId);
        await this.markEntity(row.id, 'pushed', null);
        resolved += 1;
      }

      byKey.delete(mapping.key);
    }

    // Whatever ingest did not echo back failed; its reason is in `errors`, which
    // is per-batch rather than per-entity, so the whole list is recorded against
    // each unresolved row.
    const reason =
      result.errors.length > 0 ? result.errors.join('; ') : 'entity not resolved by graph ingest';
    let failed = 0;

    for (const rows of byKey.values()) {
      for (const row of rows) {
        await this.markEntity(row.id, 'failed', reason);
        failed += 1;

        // Logged, not just recorded: an entity that will not resolve costs every
        // record that names it its participants, so it is worth seeing in the
        // log rather than only in a column someone has to go looking for.
        this.logger.warn('Staged entity failed to resolve; continuing', {
          runId: context.runId,
          stagedEntityId: row.id,
          identityKey: row.identityKey,
          error: reason,
        });
      }
    }

    this.logger.log('Resolved staged entities', {
      runId: context.runId,
      resolved,
      skipped,
      failed,
    });

    return { resolved, skipped, failed };
  }

  private async recordEntityMapping(
    stagedEntityId: string,
    userId: string,
    serverEntityId: string,
  ): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO ci_import.entity_mappings (staged_entity_id, user_id, server_entity_id)
            VALUES ($1::uuid, $2::uuid, $3::uuid)
       ON CONFLICT (staged_entity_id) DO UPDATE
            SET server_entity_id = EXCLUDED.server_entity_id, synced_at = now()`,
      [stagedEntityId, userId, serverEntityId],
    );
  }

  private async markEntity(
    stagedEntityId: string,
    status: 'pushed' | 'failed' | 'skipped',
    error: string | null,
  ): Promise<void> {
    await this.dataSource.query(
      // `$2` is used twice. It deduces today because both uses are text, but
      // that is luck, not design — the identical shape in `recordProgress` threw
      // "inconsistent types deduced" because one use was numeric. Cast at both
      // sites so a future change to the status type cannot resurrect it.
      `UPDATE ci_import.staged_entities
          SET push_status = $2::text,
              push_error = $3::text,
              pushed_at = CASE WHEN $2::text = 'pushed' THEN now() END
        WHERE id = $1::uuid`,
      [stagedEntityId, status, error],
    );
  }

  /**
   * The server entity ids a staged item's edges point at, by relation.
   *
   * Joined through `entity_mappings`, so an edge whose entity was skipped or
   * failed simply contributes nothing — the record still pushes, with the
   * participants that did resolve.
   */
  private async participantsFor(stagedItemId: string): Promise<Map<string, string[]>> {
    return (await this.participantsForMany([stagedItemId])).get(stagedItemId) ?? new Map();
  }

  /**
   * The same lookup for a whole batch, in ONE query.
   *
   * Asked per row, this was the first of the three round trips every staged row
   * cost — 704,226 of them on the import that prompted the change. Rows with no
   * edges are simply absent from the result map, which callers read as an empty
   * Map, so the query returns only what exists rather than one row per id.
   */
  private async participantsForMany(
    stagedItemIds: readonly string[],
  ): Promise<Map<string, Map<string, string[]>>> {
    const byItem = new Map<string, Map<string, string[]>>();

    if (stagedItemIds.length === 0) {
      return byItem;
    }

    const rows = await this.dataSource.query<
      Array<{ item_id: string; relation: string | null; server_entity_id: string }>
    >(
      `SELECT r.item_id, r.relation, m.server_entity_id
         FROM ci_import.staged_relationships r
         JOIN ci_import.entity_mappings m ON m.staged_entity_id = r.entity_id
        WHERE r.item_id = ANY($1::uuid[])`,
      [stagedItemIds],
    );

    for (const row of rows) {
      const relation = row.relation ?? 'participant';
      let byRelation = byItem.get(row.item_id);

      if (!byRelation) {
        byRelation = new Map<string, string[]>();
        byItem.set(row.item_id, byRelation);
      }

      const existing = byRelation.get(relation);

      if (existing) {
        existing.push(row.server_entity_id);
      } else {
        byRelation.set(relation, [row.server_entity_id]);
      }
    }

    return byItem;
  }

  private async pendingCount(runId: string): Promise<number> {
    const [{ count }] = await this.dataSource.query<Array<{ count: string }>>(
      `SELECT count(*) FROM ci_import.staged_items
        WHERE run_id = $1::uuid AND push_status = 'pending'`,
      [runId],
    );

    return Number(count);
  }

  /**
   * What earlier attempts of this stage settled, straight from the ledger.
   *
   * A resumed or retried push seeds its counters here rather than at zero, so
   * `processed` and `total` describe the RUN, not the attempt: a push killed at
   * 50k/305k resumes at 50k/305k instead of restarting the arithmetic against
   * the 255k remainder. On a first attempt every count is zero.
   */
  private async settledCounts(runId: string): Promise<{
    items: { pushed: number; deduped: number; failed: number };
    entities: { resolved: number; skipped: number; failed: number };
  }> {
    const rows = await this.dataSource.query<Array<{ kind: string; status: string; count: string }>>(
      `SELECT 'item' AS kind, push_status AS status, count(*) AS count
         FROM ci_import.staged_items
        WHERE run_id = $1::uuid AND push_status <> 'pending'
        GROUP BY push_status
       UNION ALL
       SELECT 'entity' AS kind, push_status AS status, count(*) AS count
         FROM ci_import.staged_entities
        WHERE run_id = $1::uuid AND push_status <> 'pending'
        GROUP BY push_status`,
      [runId],
    );

    const items = { pushed: 0, deduped: 0, failed: 0 };
    const entities = { resolved: 0, skipped: 0, failed: 0 };

    for (const row of rows) {
      const count = Number(row.count);

      if (row.kind === 'item') {
        if (row.status === 'pushed') {
          items.pushed = count;
        } else if (row.status === 'skipped') {
          items.deduped = count;
        } else if (row.status === 'failed') {
          items.failed = count;
        }
      } else {
        if (row.status === 'pushed') {
          entities.resolved = count;
        } else if (row.status === 'skipped') {
          entities.skipped = count;
        } else if (row.status === 'failed') {
          entities.failed = count;
        }
      }
    }

    return { items, entities };
  }

  /**
   * The next slice of unpushed rows.
   *
   * Ordered by id, which is a v7 uuid — so this walks the run in the order the
   * parser staged it, and a record's participants and its edges stay near each
   * other rather than being scattered across batches.
   */
  private async nextBatch(runId: string): Promise<StagedItem[]> {
    return this.dataSource.query<StagedItem[]>(
      `SELECT id, run_id AS "runId", user_id AS "userId", data_source AS "dataSource",
              classification, content_hash AS "contentHash", occurred_at AS "occurredAt",
              timespan_end AS "timespanEnd", latitude, longitude, filename,
              media_type AS "mediaType", original_location AS "originalLocation",
              intermediate_location AS "intermediateLocation", metadata,
              created_at AS "createdAt"
         FROM ci_import.staged_items
        WHERE run_id = $1::uuid AND push_status = 'pending'
        ORDER BY id
        LIMIT $2`,
      [runId, PUSH_BATCH],
    );
  }

  /**
   * The owner's own display names, as a predicate — one query for the run.
   *
   * FAIL SAFE, deliberately: a lookup that finds nothing, or one that throws,
   * yields {@link NOBODY_IS_SELF}, so every WhatsApp/Messenger message keeps
   * the `inbound` default this repo shipped before the mappers were wired in.
   * The alternatives are both worse than a blank — failing the push over a
   * missing display name strands an import that is otherwise fine, and
   * guessing writes a false authorship claim into somebody's memory. Logged at
   * warn either way, because a corpus that silently classifies every message
   * inbound is the bug this change exists to fix.
   */
  private async resolveIsSelf(context: StageRunContext): Promise<IsSelf> {
    try {
      const identity = await readSelfIdentity(this.dataSource, context.userId);
      const isSelf = makeIsSelf(identity);

      if (isSelf === NOBODY_IS_SELF) {
        this.logger.warn('No owner name resolved; chat messages stay inbound', {
          runId: context.runId,
          userId: context.userId,
        });
      }

      return isSelf;
    } catch (err) {
      this.logger.warn('Owner lookup failed; chat messages stay inbound', {
        runId: context.runId,
        userId: context.userId,
        error: (err as Error).message,
      });

      return NOBODY_IS_SELF;
    }
  }

  /**
   * Push one batch, row by row.
   *
   * Per-row rather than per-destination-bulk deliberately: a single malformed
   * record must not fail the 499 staged beside it, and the only way to know
   * WHICH row a bulk rejection belonged to is not to bulk it. The destinations
   * are the expensive part of an import only in aggregate; a batch of 500 is
   * where the cost actually lives, and that is still batched.
   */
  private async pushBatch(
    context: StageRunContext,
    batch: StagedItem[],
    counts: DestinationCounts,
    isSelf: IsSelf,
  ): Promise<{ pushed: number; failed: number; deduped: number }> {
    const ctx = { userId: context.userId };

    // ONE query for the batch's edges, not one per row.
    const participantsByItem = await this.participantsForMany(batch.map((row) => row.id));

    const plans: RowPlan[] = batch.map((row) => {
      const record = toCanonical(row);

      return {
        row,
        record,
        destinations: destinationsFor(record),
        participants: participantsByItem.get(row.id) ?? new Map<string, string[]>(),
        wrote: false,
        failure: null,
      };
    });

    // One call per DESTINATION for the whole batch, rather than one call per
    // row per destination. Ordering across destinations is preserved from the
    // per-row loop: a row reaching several still reaches them in this order.
    for (const destination of DESTINATION_ORDER) {
      const group = plans.filter((plan) => plan.failure == null && plan.destinations.includes(destination));

      if (group.length === 0) {
        continue;
      }

      await this.sendGroup(ctx, destination, group, counts, isSelf, context);
    }

    return this.recordOutcomes(context, plans);
  }

  /**
   * Send one destination's share of a batch, degrading to per-row on failure.
   *
   * The batch call is ONE transaction, so a single unacceptable row would roll
   * back every other row with it — and the per-row quarantine this stage is
   * built on (a bad record is marked `failed` and the import continues) would
   * become "one bad record fails 500 good ones". So a failed group is retried
   * row by row through the original {@link send}, which reaches exactly the
   * outcomes it always did: a duplicate key is `skipped`, anything else is that
   * ONE row `failed`.
   *
   * Out of disk is rethrown without the retry: nothing about the next row
   * avoids it, and 500 more attempts only delay the stage failing with a cause.
   */
  private async sendGroup(
    ctx: { userId: string },
    destination: Destination,
    group: RowPlan[],
    counts: DestinationCounts,
    isSelf: IsSelf,
    context: StageRunContext,
  ): Promise<void> {
    try {
      const wrote = await this.sendMany(ctx, destination, group, isSelf);

      for (const [index, plan] of group.entries()) {
        if (wrote[index]) {
          counts[destination] = (counts[destination] ?? 0) + 1;
          plan.wrote = true;
        }
      }

      return;
    } catch (err) {
      if (isOutOfDiskError(err)) {
        throw new DatabaseVolumeFullError(
          await readDatabaseSpace(this.dataSource),
          `the database refused a write while saving ${group.length} ${destination} record(s)`,
        );
      }

      this.logger.warn('Batched push failed; retrying the group row by row', {
        runId: context.runId,
        destination,
        rows: group.length,
        error: (err as Error).message,
      });
    }

    for (const plan of group) {
      try {
        if (await this.send(ctx, destination, plan.record, plan.participants, isSelf)) {
          counts[destination] = (counts[destination] ?? 0) + 1;
          plan.wrote = true;
        }
      } catch (err) {
        if (isDuplicateKey(err)) {
          // The dedup working, not a failure: something already in ci.* carries
          // this identity. Leaving `wrote` false lands the row in `skipped`,
          // which is terminal, so a resumed push does not reconsider it.
          continue;
        }

        if (isOutOfDiskError(err)) {
          throw new DatabaseVolumeFullError(
            await readDatabaseSpace(this.dataSource),
            `the database refused a write while saving ${plan.record.sourceSystem} record ${plan.row.id}`,
          );
        }

        plan.failure = (err as Error).message;

        this.logger.warn('Staged row failed to push; continuing', {
          runId: context.runId,
          stagedItemId: plan.row.id,
          dataSource: plan.record.sourceSystem,
          kind: plan.record.kind,
          error: plan.failure,
        });
      }
    }
  }

  /**
   * Write the batch's outcomes to the ledger in three statements, not 500.
   *
   * Rows are grouped by the destination set they reached, because `pushed_ref`
   * carries it — typically one or two distinct sets in a batch, since a batch
   * of Google Voice messages all take the same lane.
   */
  private async recordOutcomes(
    context: StageRunContext,
    plans: RowPlan[],
  ): Promise<{ pushed: number; failed: number; deduped: number }> {
    const pushedByDestinations = new Map<string, string[]>();
    const skipped: string[] = [];
    const failures: Array<{ id: string; error: string }> = [];

    for (const plan of plans) {
      if (plan.failure != null) {
        failures.push({ id: plan.row.id, error: plan.failure });
        continue;
      }

      // `wrote` is per DESTINATION, and a row can reach several. It counts as a
      // write if ANY destination wrote it: an Audible listen whose audiobook
      // already exists still produces a new event, so calling the whole row a
      // duplicate would lose the event it did create.
      if (plan.wrote) {
        const key = JSON.stringify(plan.destinations);
        const existing = pushedByDestinations.get(key);

        if (existing) {
          existing.push(plan.row.id);
        } else {
          pushedByDestinations.set(key, [plan.row.id]);
        }

        continue;
      }

      // Marked the same way as a row whose duplicate surfaced as a 23505,
      // because it is the same outcome reached by a quieter route: every
      // destination already held this record.
      skipped.push(plan.row.id);
    }

    let pushed = 0;

    for (const [key, ids] of pushedByDestinations) {
      await this.markPushedMany(ids, JSON.parse(key) as Destination[]);
      pushed += ids.length;
    }

    await this.markSkippedMany(skipped);

    for (const failure of failures) {
      await this.markFailed(failure.id, failure.error);
    }

    if (failures.length > 0) {
      this.logger.warn('Batch finished with failed rows', {
        runId: context.runId,
        failed: failures.length,
      });
    }

    return { pushed, failed: failures.length, deduped: skipped.length };
  }

  /**
   * Decide a communication's sender and recipients from its staged edges.
   *
   * Importers stage edges under three vocabularies, and this used to honour
   * only one. `from`/`to`/`cc` is the mail-shaped vocabulary the email
   * importers emit. A CHAT importer has no such split — a 1:1 conversation has
   * one other party — so imessage and whatsapp stage `participant` instead, and
   * record which way the message went in the edge's own metadata.
   *
   * Reading only from/to left every chat message with no sender at all. On a
   * real import that was 432,173 iMessages — every message the owner has ever
   * exchanged, staged WITH 290,043 resolved participant edges, and connected to
   * nobody. The Person entities existed; the messages simply never pointed at
   * them.
   *
   * The direction is what disambiguates a `participant`: on an inbound message
   * the other party is the SENDER, on an outbound one they are the RECIPIENT.
   * An explicit from/to edge always wins, so nothing about the mail path
   * changes.
   */
  private resolveCorrespondents(
    participants: Map<string, string[]>,
    direction: string | undefined,
  ): { from?: string; to: string[] } {
    const [explicitFrom] = participants.get('from') ?? [];
    const explicitTo = [...(participants.get('to') ?? []), ...(participants.get('cc') ?? [])];

    if (explicitFrom != null || explicitTo.length > 0) {
      return { from: explicitFrom, to: explicitTo };
    }

    const others = participants.get('participant') ?? [];

    if (others.length === 0) {
      return { to: [] };
    }

    // Outbound: the owner sent it, so every participant is a recipient. Inbound
    // (and unknown, which `toCommunicationInput` defaults to inbound): the
    // first participant is who it came from, and any others share the thread.
    if (direction === 'outbound') {
      return { to: others };
    }

    const [first, ...rest] = others;

    return { from: first, to: rest };
  }

  /**
   * Hand a whole batch's share of ONE destination to the service that owns it,  /**
   * Hand a whole batch's share of ONE destination to the service that owns it,
   * and report per row whether that destination actually wrote.
   *
   * The services have always taken arrays — `createManyDetailed` returns one
   * {@link BulkInsertResult} per input, in input order, and chunks internally
   * against the bind-param limit. The per-row path called them with
   * single-element arrays, so a 704,226-row import made 704,226 round trips
   * where it could have made ~1,400. Nothing about the mapping changes here;
   * only how many rows travel per call.
   *
   * The returned array is aligned with `group`, index for index. A service that
   * returns fewer results than inputs would silently mark the tail as
   * not-written, so the length is checked rather than trusted.
   */
  private async sendMany(
    ctx: { userId: string },
    destination: Destination,
    group: RowPlan[],
    isSelf: IsSelf,
  ): Promise<boolean[]> {
    switch (destination) {
      case 'communications': {
        const inputs = group.map((plan) => {
          // WhatsApp and Messenger get their own mappers — see `send`.
          const input = isWhatsAppRecord(plan.record)
            ? toWhatsAppCommunicationInput(plan.record, isSelf)
            : isFacebookMessengerRecord(plan.record)
              ? toFacebookMessengerCommunicationInput(plan.record, isSelf)
              : toCommunicationInput(plan.record);

          const { from, to } = this.resolveCorrespondents(plan.participants, input.direction);

          if (from) {
            input.from_entity_id = from;
          }

          if (to.length) {
            input.to_entity_ids = to;
          }

          return input;
        });

        return aligned(await this.communications.createManyDetailed(ctx, inputs), group, destination);
      }

      case 'content':
        return aligned(
          await this.contents.createManyDetailed(
            ctx,
            group.map((plan) => toContentInput(plan.record)),
          ),
          group,
          destination,
        );

      case 'events':
        return aligned(
          await this.events.createDetailed(
            ctx,
            group.map((plan) => toEventInput(plan.record)),
          ),
          group,
          destination,
        );

      case 'inventory':
        return aligned(
          await this.items.createManyDetailed(
            ctx,
            group.map((plan) => toInventoryInput(plan.record)),
          ),
          group,
          destination,
        );

      case 'browser_activity':
        return aligned(
          await this.browserActivity.createManyDetailed(
            ctx,
            group.map((plan) => toBrowserActivityInput(plan.record)),
          ),
          group,
          destination,
        );

      case 'position': {
        // `destinationsFor` routes on `rec.coordinates`, and so does this
        // builder — but it returns null rather than throwing, so a disagreement
        // between the two skips the row instead of failing the import.
        const built = group.map((plan) => toPositionInput(plan.record));
        const positions = built.filter((position): position is NonNullable<typeof position> => position != null);

        if (positions.length > 0) {
          // PositionService has no upsert-reporting variant: positions carry no
          // provenance triple, so every call writes.
          //
          // emitCreated:false, like every other destination on this path: bulk
          // ingest defers indexing to the post-load batch machinery, and the
          // default would emit one position.created per GPS point.
          await this.positions.create(ctx, positions, { emitCreated: false });
        }

        return built.map((position) => position != null);
      }
    }
  }

  /**
   * Hand one record to the service that owns its destination, and report whether
   * that destination actually WROTE a row.
   *
   * Every destination upserts, so a collision is absorbed silently rather than
   * raised — which is correct for ingest and useless for reporting. Counting
   * sends instead of writes claimed 7,339 content records for an archive that
   * produced 2,354: content is keyed on the work, so 4,443 Audible listening
   * sessions collapse onto 88 audiobooks. The `*Detailed` variants exist to tell
   * the two apart.
   */
  private async send(
    ctx: { userId: string },
    destination: Destination,
    record: CanonicalRecord,
    participants: Map<string, string[]>,
    isSelf: IsSelf,
  ): Promise<boolean> {
    switch (destination) {
      case 'communications': {
        // WhatsApp and Messenger get their own mappers, because their exports
        // carry no "this one is me" signal for the generic path to read: a
        // `_chat.txt` line is a display name and a body, so `directionFor`
        // returns null and every message — the owner's own included — takes
        // toCommunicationInput's `inbound` default. Both mappers decide
        // direction by matching the sender against the owner instead, and the
        // WhatsApp one also reads thread_id off `Conversation`, which the
        // generic path never looks at (it reads ThreadId/Thread/MessageID), so
        // without this branch every WhatsApp message also loses its chat
        // grouping. Everything else is unchanged.
        const input = isWhatsAppRecord(record)
          ? toWhatsAppCommunicationInput(record, isSelf)
          : isFacebookMessengerRecord(record)
            ? toFacebookMessengerCommunicationInput(record, isSelf)
            : toCommunicationInput(record);

        // The whole point of staging edges: a message reaches ci.* with a sender
        // and recipients rather than as text from nobody. `from` is single by
        // definition; everything else addressed is a recipient.
        const { from, to } = this.resolveCorrespondents(participants, input.direction);

        if (from) {
          input.from_entity_id = from;
        }

        if (to.length) {
          input.to_entity_ids = to;
        }

        return wroteAnything(await this.communications.createManyDetailed(ctx, [input]));
      }

      case 'content':
        return wroteAnything(await this.contents.createManyDetailed(ctx, [toContentInput(record)]));
      case 'events':
        // An ARRAY, deliberately: `createDetailed` is the batched path, and only
        // the batched path is idempotent. A bare object takes `createOne`, which
        // inserts unconditionally.
        return wroteAnything(await this.events.createDetailed(ctx, [toEventInput(record)]));
      case 'inventory':
        return wroteAnything(await this.items.createManyDetailed(ctx, [toInventoryInput(record)]));
      case 'browser_activity':
        return wroteAnything(
          await this.browserActivity.createManyDetailed(ctx, [toBrowserActivityInput(record)]),
        );
      case 'position': {
        const position = toPositionInput(record);

        // `destinationsFor` routes on `rec.coordinates`, and so does this
        // builder — but it returns null rather than throwing, so a disagreement
        // between the two skips the row instead of failing the import.
        if (position == null) {
          return false;
        }

        // PositionService has no upsert-reporting variant: positions carry no
        // provenance triple, so every call writes.
        //
        // emitCreated:false, like every other destination on this path: bulk
        // ingest defers indexing to the post-load batch machinery, and the
        // default would emit one position.created per GPS point — a Location
        // History import is hundreds of thousands of them, each a warning when
        // nothing listens on that queue.
        await this.positions.create(ctx, [position], { emitCreated: false });

        return true;
      }
    }
  }

  /**
   * Record where a row went.
   *
   * `pushed_ref` holds the destinations rather than the created ids: a row can
   * reach several, the services return differently-shaped rows, and what the
   * relationship wiring needs to know is which lane a record took.
   */
  private async markPushedMany(stagedItemIds: string[], destinations: Destination[]): Promise<void> {
    if (stagedItemIds.length === 0) {
      return;
    }

    await this.dataSource.query(
      `UPDATE ci_import.staged_items
          SET push_status = 'pushed', pushed_at = now(), push_error = NULL, pushed_ref = $2::jsonb
        WHERE id = ANY($1::uuid[])`,
      [stagedItemIds, JSON.stringify({ destinations })],
    );
  }

  /** Considered and deliberately not written, because it is already there. */
  private async markSkippedMany(stagedItemIds: string[]): Promise<void> {
    if (stagedItemIds.length === 0) {
      return;
    }

    await this.dataSource.query(
      `UPDATE ci_import.staged_items
          SET push_status = 'skipped', pushed_at = now(), push_error = NULL
        WHERE id = ANY($1::uuid[])`,
      [stagedItemIds],
    );
  }

  private async markFailed(stagedItemId: string, error: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE ci_import.staged_items
          SET push_status = 'failed', push_error = $2
        WHERE id = $1::uuid`,
      [stagedItemId, error],
    );
  }
}

/**
 * Postgres 23505 — unique violation — however the driver wrapped it.
 *
 * Checked on both the error and its `driverError`, because TypeORM surfaces the
 * code in different places depending on which query path raised it.
 */
/** Whether a batch ingest call wrote at least one row, rather than finding them all. */
/**
 * Read a batched service's results back onto the rows that produced them.
 *
 * The contract is one result per input in input order; a shorter array would
 * quietly report the tail as "already there" and mark real writes as skipped,
 * so a mismatch fails the group instead — the caller's row-by-row retry then
 * gets the honest per-row answer.
 */
function aligned<Entity>(
  results: Array<{ inserted: boolean; entity: Entity }>,
  group: RowPlan[],
  destination: Destination,
): boolean[] {
  if (results.length !== group.length) {
    throw new Error(
      `${destination} returned ${results.length} result(s) for ${group.length} input(s); ` +
        `the batched write cannot be attributed to rows`,
    );
  }

  return results.map((result) => result.inserted);
}

function wroteAnything(results: ReadonlyArray<{ inserted: boolean }>): boolean {
  return results.some((result) => result.inserted);
}

function isDuplicateKey(err: unknown): boolean {
  const wrapped = err as { code?: string; driverError?: { code?: string } };

  return wrapped?.code === '23505' || wrapped?.driverError?.code === '23505';
}
