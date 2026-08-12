import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { LoggerService } from '@ci/common/logging';
import { BrowserActivityService } from '@ci/domains/browser-activity';
import { type GraphEntityInputDto, GraphIngestService } from '@ci/domains/graph';
import { CommunicationService, ContentService, EventService, ItemService } from '@ci/domains/memory';
import { PositionService } from '@ci/domains/position';

import type { StagedEntity } from '../entities/StagedEntityEntity';
import type { StagedItem } from '../entities/StagedItemEntity';
import { destinationsFor, toCanonical, type CanonicalRecord, type Destination } from '../push/canonical';
import { toGraphEntity } from '../push/entities';
import {
  toBrowserActivityInput,
  toCommunicationInput,
  toContentInput,
  toEventInput,
  toInventoryInput,
  toPositionInput,
} from '../push/inputs';
import type { ImportStageRunner, StageOutcome, StageRunContext } from '../types';

/** Staged rows read (and pushed) per batch. */
const PUSH_BATCH = 500;

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
 * ## Idempotency belongs to the destination
 *
 * Nothing here checks whether a record already exists. Every input carries the
 * `(source_type, source_system, source_id)` triple, and each destination table
 * has a `*_source_triple_uniq` index over it, so a re-push is a no-op decided by
 * the database. Re-implementing that check here would be a second answer to a
 * question `ci.*` already answers — and the two would drift.
 */
@Injectable()
export class PushStage implements ImportStageRunner {
  readonly kind = 'push' as const;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly communications: CommunicationService,
    private readonly contents: ContentService,
    private readonly events: EventService,
    private readonly items: ItemService,
    private readonly positions: PositionService,
    private readonly browserActivity: BrowserActivityService,
    private readonly graph: GraphIngestService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(PushStage.name);
  }

  async run(context: StageRunContext): Promise<StageOutcome> {
    // Entities first, always. A communication names its participants by server
    // entity id, so the people have to exist — and be recorded in
    // `entity_mappings` — before the record that points at them is built.
    const entities = await this.pushEntities(context);

    const total = await this.pendingCount(context.runId);

    await context.progress({ processed: 0, total, phase: 'pushing' });

    const counts: DestinationCounts = {};
    let pushed = 0;
    let failed = 0;
    let deduped = 0;

    for (;;) {
      const batch = await this.nextBatch(context.runId);

      if (batch.length === 0) {
        break;
      }

      const outcome = await this.pushBatch(context, batch, counts);

      pushed += outcome.pushed;
      failed += outcome.failed;
      deduped += outcome.deduped;

      await context.progress({ processed: pushed + failed + deduped, total, phase: 'pushing' });
    }

    return {
      // Every staged row is RESOLVED one way or another, and this stage's work
      // is examining all of them — so all three outcomes count toward progress.
      // Reporting only `pushed` made the bar climb to 100% during the push and
      // then jump BACKWARDS when the stage completed: a real import showed
      // 5.8k/10.8k and read as though half of it had failed, when most of the
      // remainder was content that already existed. Whether the work went well
      // is what `partial` and the breakdown below say; this number is progress.
      processed: pushed + deduped + failed,
      total,
      // Rows that could not be sent are not a failed import — the ones that went
      // are in ci.* and useful. The run says `partial` and the ledger says which.
      partial: failed > 0 || entities.skipped > 0,
      // `deduped` is reported separately from `pushed`: it is a real outcome
      // (the record is in ci.*, it just arrived earlier) and reads as neither a
      // write nor a loss.
      detail: { pushed, deduped, failed, destinations: counts, entities },
    };
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

    const result = await this.graph.ingest({ userId: context.userId }, { entities: inputs, relationships: [] });

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
    const reason = result.errors.length > 0 ? result.errors.join('; ') : 'entity not resolved by graph ingest';
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
    const rows = await this.dataSource.query<Array<{ relation: string | null; server_entity_id: string }>>(
      `SELECT r.relation, m.server_entity_id
         FROM ci_import.staged_relationships r
         JOIN ci_import.entity_mappings m ON m.staged_entity_id = r.entity_id
        WHERE r.item_id = $1::uuid`,
      [stagedItemId],
    );

    const byRelation = new Map<string, string[]>();

    for (const row of rows) {
      const relation = row.relation ?? 'participant';
      const existing = byRelation.get(relation);

      if (existing) {
        existing.push(row.server_entity_id);
      } else {
        byRelation.set(relation, [row.server_entity_id]);
      }
    }

    return byRelation;
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
  ): Promise<{ pushed: number; failed: number; deduped: number }> {
    const ctx = { userId: context.userId };
    let pushed = 0;
    let failed = 0;
    let deduped = 0;

    for (const row of batch) {
      const record = toCanonical(row);
      const destinations = destinationsFor(record);

      try {
        const participants = await this.participantsFor(row.id);

        for (const destination of destinations) {
          await this.send(ctx, destination, record, participants);
          counts[destination] = (counts[destination] ?? 0) + 1;
        }

        await this.markPushed(row.id, destinations);
        pushed += 1;
      } catch (err) {
        // A unique violation on a provenance triple is the dedup working, not a
        // failure: something already in ci.* carries this identity. The batch
        // paths absorb it, so reaching here means a destination without an
        // upsert — record it as `skipped`, which the schema defines as "was
        // considered and deliberately not pushed", so a resumed push does not
        // reconsider it forever.
        if (isDuplicateKey(err)) {
          await this.markSkipped(row.id);
          deduped += 1;
          continue;
        }

        await this.markFailed(row.id, (err as Error).message);
        failed += 1;

        this.logger.warn('Staged row failed to push; continuing', {
          runId: context.runId,
          stagedItemId: row.id,
          dataSource: record.sourceSystem,
          kind: record.kind,
          error: (err as Error).message,
        });
      }
    }

    return { pushed, failed, deduped };
  }

  /** Hand one record to the service that owns its destination. */
  private async send(
    ctx: { userId: string },
    destination: Destination,
    record: CanonicalRecord,
    participants: Map<string, string[]>,
  ): Promise<void> {
    switch (destination) {
      case 'communications': {
        const input = toCommunicationInput(record);

        // The whole point of staging edges: a message reaches ci.* with a sender
        // and recipients rather than as text from nobody. `from` is single by
        // definition; everything else addressed is a recipient.
        const [from] = participants.get('from') ?? [];
        const to = [...(participants.get('to') ?? []), ...(participants.get('cc') ?? [])];

        if (from) {
          input.from_entity_id = from;
        }

        if (to.length) {
          input.to_entity_ids = to;
        }

        await this.communications.createMany(ctx, [input]);
        break;
      }

      case 'content':
        await this.contents.createMany(ctx, [toContentInput(record)]);
        break;
      case 'events':
        // An ARRAY, deliberately: `create` is only idempotent on the batched
        // path. Handed a bare object it takes `createOne`, which inserts.
        await this.events.create(ctx, [toEventInput(record)]);
        break;
      case 'inventory':
        await this.items.createMany(ctx, [toInventoryInput(record)]);
        break;
      case 'browser_activity':
        await this.browserActivity.createMany(ctx, [toBrowserActivityInput(record)]);
        break;
      case 'position': {
        const position = toPositionInput(record);

        // `destinationsFor` routes on `rec.coordinates`, and so does this
        // builder — but it returns null rather than throwing, so a disagreement
        // between the two skips the row instead of failing the import.
        if (position != null) {
          await this.positions.create(ctx, [position]);
        }

        break;
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
  private async markPushed(stagedItemId: string, destinations: Destination[]): Promise<void> {
    await this.dataSource.query(
      `UPDATE ci_import.staged_items
          SET push_status = 'pushed', pushed_at = now(), push_error = NULL, pushed_ref = $2::jsonb
        WHERE id = $1::uuid`,
      [stagedItemId, JSON.stringify({ destinations })],
    );
  }

  /** Considered and deliberately not written, because it is already there. */
  private async markSkipped(stagedItemId: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE ci_import.staged_items
          SET push_status = 'skipped', pushed_at = now(), push_error = NULL
        WHERE id = $1::uuid`,
      [stagedItemId],
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
function isDuplicateKey(err: unknown): boolean {
  const wrapped = err as { code?: string; driverError?: { code?: string } };

  return wrapped?.code === '23505' || wrapped?.driverError?.code === '23505';
}
