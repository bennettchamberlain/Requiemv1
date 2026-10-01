import { DataSource } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import type { UserServiceContext } from '@ci/common/context';
import type { HbpeNotifyService } from '@ci/common/hbpe';
import type { LoggerService } from '@ci/common/logging';
import type { EventService } from '@ci/domains/events';
import { UserEntity } from '@ci/domains/user';

import { createSyntheticTestUser } from '../../../__tests__/support/applianceUser';
import { databaseAvailability, dataSourceConnection } from '../../../__tests__/support/databaseConnection';
import { acquireSchemaWriteLock, type SchemaLock } from '../../../__tests__/support/schemaLock';
import { BaseEntity } from '../../entities/BaseEntity';
import { EventBaseEntity } from '../../entities/EventBaseEntity';
import { EventEntity } from '../../entities/EventEntity';
import { ContentRemovedEvent, EventRemovedEvent } from '../../events';
import { platformIdentity } from '../../identity';
import { CalendarEventService } from '../CalendarEventService';
import { GraphDeltaWriter } from '../GraphDeltaWriter';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * `CalendarEventService.purge`: DESTROYING AN EVENT, AGAINST POSTGRES.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `purge` is the physical delete behind `memory.forget`'s `archive_and_delete`.
 * A plain delete of an event's `ci.entities` row cannot work for an event HBPE
 * has clustered (`hbpe.l1_event_cluster.event_id` has no `ON DELETE` action),
 * and where it does work it leaves the event's edges, ledgers and provenance
 * pointing at nothing and orphans the `Content` base rows of whatever hung off
 * the event. See {@link purgeEventDependents} for the reasons in full.
 *
 * Each world below is an event with everything a real one accumulates: an HBPE
 * cluster membership, a clustered piece of content attached to it, edges in
 * both directions, pipeline ledgers, provenance, a tag, a category, an
 * identifier, and a child event. The suite purges one world and asks the
 * catalog, not a list of the tables the fix happens to know about, whether
 * anything still names it.
 *
 * Opt-in like its neighbours: set `MEMORY_TEST_DATABASE_URL` to a migrated
 * database of your OWN, or run `make test-db`, which provides one.
 */
const DATABASE_ENV = { urlEnvVar: 'MEMORY_TEST_DATABASE_URL' };
const availability = databaseAvailability(DATABASE_ENV);
const describeWithDb = availability.available ? describe : describe.skip;

if (!availability.available) {
  console.warn(`[memory/CalendarEventService.purge.integration] SKIPPED — ${availability.reason}`);
}

jest.setTimeout(180_000);

const AT = new Date('2026-08-19T17:00:00Z');

const logger = () =>
  ({
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }) as unknown as LoggerService;

/** One event and everything that accumulates around it. */
interface World {
  event: string;
  child: string;
  content: string;
  person: string;
  tag: string;
}

/** How many rows of each kind name a world, so two worlds can be compared. */
type Footprint = Record<string, number | string | null>;

describeWithDb(`CalendarEventService.purge, against Postgres (${availability.target})`, () => {
  let dataSource: DataSource;
  let schemaLock: SchemaLock | null = null;
  let deltaWriter: GraphDeltaWriter;
  let service: CalendarEventService;

  const ownerId = uuidv7();
  const strangerId = uuidv7();
  const owner = { userId: ownerId } as UserServiceContext;
  const stranger = { userId: strangerId } as UserServiceContext;

  let l1Cluster: string;
  let l2Cluster: string;
  /** A cluster no world belongs to, whose row the purge must not touch. */
  let controlCluster: string;

  const published: Array<{ name: string; payload: unknown }> = [];
  const signalling = {
    send: jest.fn(async (name: string, payload: unknown) => {
      published.push({ name, payload });

      return [];
    }),
  } as unknown as EventService;
  const notifyEvents = jest.fn(async () => undefined);
  const hbpeNotify = { notifyEvents } as unknown as HbpeNotifyService;

  function publishedOf(name: string): unknown[] {
    return published.filter((event) => event.name === name).map((event) => event.payload);
  }

  const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> =>
    dataSource.query(sql, params);

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      ...dataSourceConnection(DATABASE_ENV),
      entities: [EventEntity, BaseEntity, EventBaseEntity, UserEntity],
      synchronize: false,
      extra: { options: '-c search_path=ci,public' },
    });
    await dataSource.initialize();
    schemaLock = await acquireSchemaWriteLock(dataSource, 'memory/CalendarEventService.purge');

    for (const userId of [ownerId, strangerId]) {
      await createSyntheticTestUser(q, 'EventPurge', userId);
    }

    deltaWriter = new GraphDeltaWriter(dataSource, logger());
    service = new CalendarEventService(
      dataSource.getRepository(EventEntity),
      dataSource.getRepository(EventBaseEntity),
      signalling,
      dataSource,
      deltaWriter,
      hbpeNotify,
    );
  });

  async function wipe(userId: string): Promise<void> {
    // HBPE's references to the user's rows have no ON DELETE action: they go first.
    await q(
      'DELETE FROM hbpe.l1_event_cluster WHERE event_id IN (SELECT event_id FROM ci.events WHERE user_id = $1)',
      [userId],
    );
    await q(
      'DELETE FROM hbpe.l2_content_cluster WHERE content_id IN (SELECT id FROM ci.content WHERE user_id = $1)',
      [userId],
    );
    await q('DELETE FROM hbpe.content_context WHERE user_id = $1', [userId]);
    await q('DELETE FROM hbpe.l2_clusters WHERE user_id = $1', [userId]);
    await q('DELETE FROM hbpe.l1_clusters WHERE user_id = $1', [userId]);
    await q(
      'DELETE FROM ci_search.entity_tag WHERE tag_id IN (SELECT id FROM ci_search.tags WHERE user_id = $1)',
      [userId],
    );
    await q(
      'DELETE FROM ci_search.entity_categories WHERE category_tag_id IN (SELECT id FROM ci_search.tags WHERE user_id = $1)',
      [userId],
    );
    await q('DELETE FROM ci_search.tags WHERE user_id = $1', [userId]);
    await q('DELETE FROM ci.pipeline_state WHERE user_id = $1', [userId]);
    await q('DELETE FROM ci.pipeline_dead_letters WHERE user_id = $1', [userId]);
    await q('DELETE FROM ci.record_sources WHERE user_id = $1', [userId]);
    await q('DELETE FROM ci.entity_identifiers WHERE owner_user_id = $1', [userId]);
    await q('DELETE FROM ci.relationships WHERE owner_user_id = $1', [userId]);
    await q('DELETE FROM ci.graph_deltas WHERE owner_user_id = $1', [userId]);
    await q('DELETE FROM ci.content WHERE user_id = $1', [userId]);
    await q('DELETE FROM ci.events WHERE user_id = $1', [userId]);
    await q('DELETE FROM ci.entities WHERE owner_user_id = $1', [userId]);
  }

  beforeEach(async () => {
    published.length = 0;
    notifyEvents.mockClear();

    // Shared by every world in a test, so a purge that touched a cluster it should
    // not have, or decremented one by the wrong amount, shows.
    l1Cluster = uuidv7();
    l2Cluster = uuidv7();
    controlCluster = uuidv7();

    await q(
      `INSERT INTO hbpe.l1_clusters (cluster_id, user_id, l0_class, label, member_count, naming_method)
       VALUES ($1, $2, 'SOCIAL', 'DINNER', 5, 'STATIC'),
              ($3, $2, 'WORK', 'MEETING', 7, 'STATIC')`,
      [l1Cluster, ownerId, controlCluster],
    );
    await q(
      `INSERT INTO hbpe.l2_clusters (cluster_id, user_id, l0_class, l1_cluster_id, label, member_count, naming_method)
       VALUES ($1, $2, 'SOCIAL', $3, 'PHOTOS', 3, 'LLM')`,
      [l2Cluster, ownerId, l1Cluster],
    );
    // Aged, so "untouched" can be told from "rewritten to the same value".
    await q(`UPDATE hbpe.l1_clusters SET updated_at = '2020-01-01T00:00:00Z' WHERE cluster_id = $1`, [
      controlCluster,
    ]);
  });

  afterEach(async () => {
    await wipe(ownerId);
    await wipe(strangerId);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await q('DELETE FROM ci.users WHERE id = ANY($1::uuid[])', [[ownerId, strangerId]]);
      await schemaLock?.release();
      await dataSource.destroy();
    }
  });

  // ── Fixtures ──────────────────────────────────────────────────────────────

  /**
   * An event, its content, and a row in every table that is known to name either.
   *
   * What `service.create` writes itself (the base row, the detail row, the creation
   * delta, the provenance ledger entry for the event) is deliberately left to it, so
   * the world carries what a real event does and not only what this suite remembered
   * to insert.
   */
  async function seedWorld(label: string, options: { clustered?: boolean } = {}): Promise<World> {
    const clustered = options.clustered ?? true;
    const identity = platformIdentity('purge-test', label, uuidv7());
    const [event] = await service.create(owner, {
      title: `${label}: dinner with Dana`,
      start_time: AT,
      source_type: 'import',
      source_system: identity.system,
      source_id: identity.id,
    });
    const [child] = await service.create(owner, { title: `${label}: dessert`, start_time: AT });

    // `create` does not carry `parent_event_id` over from the DTO (only `update` does), so a child made
    // that way has no parent at all. An importer writes the link; so does this.
    await q('UPDATE ci.events SET parent_event_id = $1 WHERE event_id = $2', [event.id, child.id]);

    const person = uuidv7();
    const content = uuidv7();
    const tag = uuidv7();

    await q(
      `INSERT INTO ci.entities (entity_id, entity_type, name, properties, owner_user_id)
       VALUES ($1, 'Person', $2, '{}'::jsonb, $3), ($4, 'Content', $5, '{}'::jsonb, $3)`,
      [person, `${label}: Dana`, ownerId, content, `${label}: photo`],
    );
    await q(
      `INSERT INTO ci.content (id, type, user_id, event_id, source_type, source_system, source_id)
       VALUES ($1, 'media', $2, $3, 'import', 'photos', $4)`,
      [content, ownerId, event.id, `${label}-photo-${uuidv7()}`],
    );

    if (clustered) {
      await q(`INSERT INTO hbpe.l1_event_cluster (event_id, cluster_id, similarity) VALUES ($1, $2, 0.9)`, [
        event.id,
        l1Cluster,
      ]);
      await q(`INSERT INTO hbpe.l2_content_cluster (content_id, cluster_id, similarity) VALUES ($1, $2, 1)`, [
        content,
        l2Cluster,
      ]);
      await q(
        `INSERT INTO hbpe.content_context (content_id, user_id, l0_class, l1_cluster_id)
         VALUES ($1, $2, 'SOCIAL', $3)`,
        [content, ownerId, l1Cluster],
      );
    }

    // An edge into the event, one out of it, and the same for its content.
    await q(
      `INSERT INTO ci.relationships (from_entity_id, to_entity_id, relationship_type, owner_user_id)
       VALUES ($1, $2, 'ATTENDED', $4), ($2, $1, 'HOSTED_BY', $4),
              ($3, $2, 'DOCUMENTS', $4), ($1, $3, 'PHOTOGRAPHED_IN', $4)`,
      [person, event.id, content, ownerId],
    );

    for (const [entityType, entityId] of [
      ['event', event.id],
      ['content', content],
    ]) {
      await q(
        `INSERT INTO ci.pipeline_state (entity_type, entity_id, stage, status, user_id)
         VALUES ($1, $2, 'index.embed', 'done', $3), ($1, $2, 'index.vector', 'done', $3)`,
        [entityType, entityId, ownerId],
      );
      await q(
        `INSERT INTO ci.pipeline_dead_letters (queue, event_name, entity_type, entity_id, payload, error, user_id)
         VALUES ('search-index', 'x.updated', $1, $2, '{}'::jsonb, 'boom', $3)`,
        [entityType, entityId, ownerId],
      );
    }

    await q(
      `INSERT INTO ci.record_sources (user_id, record_table, record_id, source_type, source_system, source_id)
       VALUES ($1, 'content', $2, 'import', 'photos', $3)`,
      [ownerId, content, `${label}-photo-ledger-${uuidv7()}`],
    );
    await q(`INSERT INTO ci_search.tags (id, label, user_id) VALUES ($1, $2, $3)`, [
      tag,
      `${label}-tag`,
      ownerId,
    ]);

    for (const entityId of [event.id, content]) {
      await q(`INSERT INTO ci_search.entity_tag (entity_type, entity_id, tag_id) VALUES ('event', $1, $2)`, [
        entityId,
        tag,
      ]);
      await q(
        `INSERT INTO ci_search.entity_categories (entity_type, entity_id, category_tag_id)
         VALUES ('event', $1, $2)`,
        [entityId, tag],
      );
    }

    await q(
      `INSERT INTO ci.entity_identifiers (entity_id, owner_user_id, kind, value_normalized)
       VALUES ($1, $2, 'handle', $3)`,
      [event.id, ownerId, `${label}-handle-${uuidv7()}`],
    );

    // `create` announced two events and told HBPE twice. That was the fixture, not the purge.
    published.length = 0;
    notifyEvents.mockClear();

    return { event: event.id, child: child.id, content, person, tag };
  }

  // ── Probes ────────────────────────────────────────────────────────────────

  async function count(sql: string, params: unknown[]): Promise<number> {
    const [row] = await q<{ n: string }>(sql, params);

    return Number(row.n);
  }

  /** Every kind of row that names a world, as numbers, so before and after can be compared. */
  async function footprint(world: World): Promise<Footprint> {
    const ids = [world.event, world.content];
    const named = (table: string, column: string) =>
      count(`SELECT count(*) AS n FROM ${table} WHERE ${column} = ANY($1::uuid[])`, [ids]);

    const [child] = await q<{ parent_event_id: string | null }>(
      'SELECT parent_event_id FROM ci.events WHERE event_id = $1',
      [world.child],
    );

    return {
      entities: await named('ci.entities', 'entity_id'),
      events: await named('ci.events', 'event_id'),
      content: await named('ci.content', 'id'),
      l1Memberships: await named('hbpe.l1_event_cluster', 'event_id'),
      l2Links: await named('hbpe.l2_content_cluster', 'content_id'),
      contentContexts: await named('hbpe.content_context', 'content_id'),
      edgesFrom: await named('ci.relationships', 'from_entity_id'),
      edgesTo: await named('ci.relationships', 'to_entity_id'),
      pipelineState: await named('ci.pipeline_state', 'entity_id'),
      deadLetters: await named('ci.pipeline_dead_letters', 'entity_id'),
      identifiers: await named('ci.entity_identifiers', 'entity_id'),
      recordSources: await named('ci.record_sources', 'record_id'),
      tags: await named('ci_search.entity_tag', 'entity_id'),
      categories: await named('ci_search.entity_categories', 'entity_id'),
      childParent: child ? child.parent_event_id : 'GONE',
    };
  }

  /**
   * Every column in the application schemas that still holds one of these ids, as
   * `schema.table.column`, found by asking the catalog for every uuid column rather
   * than by checking the tables a fix remembered. The audit log is the one place a
   * deleted row's id is meant to survive.
   */
  async function residue(ids: string[]): Promise<string[]> {
    const columns = await q<{ schema: string; table: string; column: string }>(
      `SELECT n.nspname AS schema, c.relname AS "table", a.attname AS "column"
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid AND c.relkind IN ('r', 'p') AND NOT c.relispartition
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname IN ('ci', 'ci_search', 'hbpe')
          AND a.attnum > 0 AND NOT a.attisdropped
          AND a.atttypid = 'uuid'::regtype
        ORDER BY 1, 2, 3`,
    );

    const found: string[] = [];

    for (let offset = 0; offset < columns.length; offset += 12) {
      await Promise.all(
        columns.slice(offset, offset + 12).map(async ({ schema, table, column }) => {
          const hit = await q(
            `SELECT 1 FROM "${schema}"."${table}" WHERE "${column}" = ANY($1::uuid[]) LIMIT 1`,
            [ids],
          );

          if (hit.length > 0 && !(schema === 'ci' && table === 'graph_deltas')) {
            found.push(`${schema}.${table}.${column}`);
          }
        }),
      );
    }

    return found.sort();
  }

  async function memberCounts(): Promise<{ l1: number; l2: number; control: number }> {
    const [l1] = await q<{ member_count: number }>(
      'SELECT member_count FROM hbpe.l1_clusters WHERE cluster_id = $1',
      [l1Cluster],
    );
    const [l2] = await q<{ member_count: number }>(
      'SELECT member_count FROM hbpe.l2_clusters WHERE cluster_id = $1',
      [l2Cluster],
    );
    const [control] = await q<{ member_count: number }>(
      'SELECT member_count FROM hbpe.l1_clusters WHERE cluster_id = $1',
      [controlCluster],
    );

    return { l1: l1.member_count, l2: l2.member_count, control: control.member_count };
  }

  // ── The purge ─────────────────────────────────────────────────────────────

  it('destroys a clustered event and its clustered content, and leaves nothing that names them', async () => {
    const world = await seedWorld('target');
    const ids = [world.event, world.content];

    // The scan has to be able to see the fixture, or it proves nothing.
    expect(await residue(ids)).toEqual(
      expect.arrayContaining([
        'ci.content.event_id',
        'ci.entities.entity_id',
        'ci.entity_identifiers.entity_id',
        'ci.events.event_id',
        'ci.events.parent_event_id',
        'ci.pipeline_dead_letters.entity_id',
        'ci.pipeline_state.entity_id',
        'ci.record_sources.record_id',
        'ci.relationships.from_entity_id',
        'ci.relationships.to_entity_id',
        'ci_search.entity_categories.entity_id',
        'ci_search.entity_tag.entity_id',
        'hbpe.content_context.content_id',
        'hbpe.l1_event_cluster.event_id',
        'hbpe.l2_content_cluster.content_id',
      ]),
    );

    const purged = await service.purge(owner, world.event);

    expect(purged).toEqual({ id: world.event, contentIds: [world.content] });
    expect(await residue(ids)).toEqual([]);

    // Spelled out as well: the content's BASE row is gone, not just its detail. Deleting only
    // the event's row cascades into `ci.content` and leaves a `Content` node behind.
    expect(
      await q(`SELECT 1 FROM ci.entities WHERE entity_type = 'Content' AND owner_user_id = $1`, [ownerId]),
    ).toEqual([]);
  });

  it('takes exactly its own rows: a bystander with the same dependents is as it was', async () => {
    const target = await seedWorld('target');
    const bystander = await seedWorld('bystander');
    const before = await footprint(bystander);

    // Every kind of row is present, or "unchanged" would prove nothing about it.
    expect(Object.values(before)).not.toContain(0);
    expect(before.childParent).toBe(bystander.event);

    await service.purge(owner, target.event);

    expect(await footprint(bystander)).toEqual(before);
    expect(await footprint(target)).toEqual(
      expect.objectContaining({ entities: 0, events: 0, content: 0, l1Memberships: 0, edgesFrom: 0 }),
    );
    // The person both worlds' edges run to is not part of either.
    expect(await q('SELECT 1 FROM ci.entities WHERE entity_id = $1', [target.person])).toHaveLength(1);
  });

  it('takes the edges of both directions, and only the edges that touch the event or its content', async () => {
    const target = await seedWorld('target');
    const bystander = await seedWorld('bystander');
    const unrelated = await q<{ relationship_id: string }>(
      `INSERT INTO ci.relationships (from_entity_id, to_entity_id, relationship_type, owner_user_id)
       VALUES ($1, $2, 'KNOWS', $3) RETURNING relationship_id`,
      [target.person, bystander.person, ownerId],
    );

    const touching = `SELECT count(*) AS n FROM ci.relationships
                       WHERE from_entity_id = ANY($1::uuid[]) OR to_entity_id = ANY($1::uuid[])`;

    // Two of each direction for the event and its content together, seeded.
    expect(await count(touching, [[target.event, target.content]])).toBe(4);

    await service.purge(owner, target.event);

    expect(await count(touching, [[target.event, target.content]])).toBe(0);
    expect(
      await count('SELECT count(*) AS n FROM ci.relationships WHERE relationship_id = $1', [
        unrelated[0].relationship_id,
      ]),
    ).toBe(1);
  });

  it('lowers each cluster’s member count by the memberships it deleted, and no other cluster’s', async () => {
    const target = await seedWorld('target');
    await seedWorld('bystander');

    expect(await memberCounts()).toEqual({ l1: 5, l2: 3, control: 7 });

    await service.purge(owner, target.event);

    // One L1 membership and one L2 link went. The bystander's are still there.
    expect(await memberCounts()).toEqual({ l1: 4, l2: 2, control: 7 });
    expect(
      await count('SELECT count(*) AS n FROM hbpe.l1_event_cluster WHERE cluster_id = $1', [l1Cluster]),
    ).toBe(1);

    // A cluster nobody belonged to is not rewritten: not its count, not its timestamp.
    const [control] = await q<{ updated_at: Date }>(
      'SELECT updated_at FROM hbpe.l1_clusters WHERE cluster_id = $1',
      [controlCluster],
    );

    expect(control.updated_at.toISOString()).toBe('2020-01-01T00:00:00.000Z');
  });

  it('never takes a member count below zero, and keeps a cluster that loses its last member', async () => {
    const target = await seedWorld('target');

    // HBPE only ever increments, and a count can already be wrong: the membership says one
    // event, the count says none.
    await q('UPDATE hbpe.l1_clusters SET member_count = 0 WHERE cluster_id = $1', [l1Cluster]);

    await service.purge(owner, target.event);

    expect((await memberCounts()).l1).toBe(0);
    expect(await count('SELECT count(*) AS n FROM hbpe.l1_clusters WHERE cluster_id = $1', [l1Cluster])).toBe(
      1,
    );
  });

  it('detaches a child event rather than deleting it', async () => {
    const target = await seedWorld('target');

    expect(await q('SELECT parent_event_id FROM ci.events WHERE event_id = $1', [target.child])).toEqual([
      { parent_event_id: target.event },
    ]);

    await service.purge(owner, target.event);

    const [child] = await q<{ parent_event_id: string | null; is_deleted: boolean }>(
      'SELECT parent_event_id, is_deleted FROM ci.events WHERE event_id = $1',
      [target.child],
    );

    expect(child).toEqual({ parent_event_id: null, is_deleted: false });
  });

  it('purges an event that is already in the trash', async () => {
    const target = await seedWorld('target');

    expect(await service.remove(owner, target.event)).toBe(true);
    expect(await service.findById(owner, target.event)).toBeNull();

    const purged = await service.purge(owner, target.event);

    expect(purged).toEqual({ id: target.event, contentIds: [target.content] });
    expect(await residue([target.event, target.content])).toEqual([]);
    // Nothing is left to restore.
    expect(await service.restore(owner, target.event)).toBeNull();
  });

  it('purges an event nothing has clustered and nothing hangs off, the case that always worked', async () => {
    const world = await seedWorld('target', { clustered: false });

    await q('DELETE FROM ci.content WHERE id = $1', [world.content]);
    await q('DELETE FROM ci.entities WHERE entity_id = $1', [world.content]);

    const purged = await service.purge(owner, world.event);

    expect(purged).toEqual({ id: world.event, contentIds: [] });
    expect(await residue([world.event])).toEqual([]);
  });

  it('answers null, and changes nothing, for somebody else’s event and for none at all', async () => {
    const world = await seedWorld('target');
    const before = await footprint(world);

    expect(await service.purge(stranger, world.event)).toBeNull();
    expect(await service.purge(owner, uuidv7())).toBeNull();

    expect(await footprint(world)).toEqual(before);
    expect(published).toEqual([]);
    expect(notifyEvents).not.toHaveBeenCalled();
  });

  it('is all or nothing: when the last step fails, every earlier delete is rolled back', async () => {
    const world = await seedWorld('target');
    const before = await footprint(world);
    const counts = await memberCounts();

    // The audit write is the last thing before the event's own row goes, so by the time it
    // throws every clean-up statement has already run.
    const failing = jest.spyOn(deltaWriter, 'entityDeleted').mockRejectedValueOnce(new Error('disk full'));

    await expect(service.purge(owner, world.event)).rejects.toThrow('disk full');
    failing.mockRestore();

    expect(await footprint(world)).toEqual(before);
    expect(await memberCounts()).toEqual(counts);
    // And nothing was announced for a delete that did not happen.
    expect(published).toEqual([]);
    expect(notifyEvents).not.toHaveBeenCalled();

    // So the same call can simply be made again.
    expect(await service.purge(owner, world.event)).toEqual({ id: world.event, contentIds: [world.content] });
    expect(await residue([world.event, world.content])).toEqual([]);
  });

  it('waits for HBPE when it labels the event from another connection at the same moment', async () => {
    const world = await seedWorld('target', { clustered: false });
    const hbpe = dataSource.createQueryRunner();

    await hbpe.connect();
    await hbpe.startTransaction();

    let purging: Promise<unknown> | undefined;

    try {
      // What HBPE does: assigning an event takes a key-share lock on its row, and the membership is
      // invisible to everyone else until it commits.
      await hbpe.query(
        'INSERT INTO hbpe.l1_event_cluster (event_id, cluster_id, similarity) VALUES ($1, $2, 0.9)',
        [world.event, l1Cluster],
      );

      let settled = false;

      purging = service.purge(owner, world.event);
      purging.then(
        () => (settled = true),
        () => (settled = true),
      );

      // Anything that is not a wait finishes well inside this.
      await new Promise((resolve) => setTimeout(resolve, 1500));
      expect(settled).toBe(false);

      await hbpe.commitTransaction();
    } catch (error) {
      await hbpe.rollbackTransaction().catch(() => undefined);
      throw error;
    } finally {
      await hbpe.release();
    }

    // Having waited, the purge sees the membership that just committed and deletes it too. Without the
    // lock it deleted the memberships it could see, and then the event delete tripped over this one.
    expect(await purging).toEqual({ id: world.event, contentIds: [world.content] });
    expect(await residue([world.event, world.content])).toEqual([]);
  });

  it('keeps the audit trail, and adds a deletion to it for the event and for each piece of content', async () => {
    const world = await seedWorld('target');

    await service.purge(owner, world.event);

    const deltas = await q<{
      entity_id: string;
      entity_type: string;
      change_type: string;
      change_source: string;
      change_reason: string | null;
    }>(
      `SELECT entity_id, entity_type, change_type, change_source, change_reason
         FROM ci.graph_deltas
        WHERE entity_id = ANY($1::uuid[])
        ORDER BY changed_at, delta_id`,
      [[world.event, world.content]],
    );

    // The event's own creation entry is still there; the purge added to it.
    expect(deltas).toEqual([
      expect.objectContaining({ entity_id: world.event, change_type: 'created' }),
      {
        entity_id: world.event,
        entity_type: 'Event',
        change_type: 'deleted',
        change_source: 'CalendarEventService.purge',
        change_reason: null,
      },
      {
        entity_id: world.content,
        entity_type: 'Content',
        change_type: 'deleted',
        change_source: 'CalendarEventService.purge',
        change_reason: `attached to purged event ${world.event}`,
      },
    ]);
  });

  it('announces the deletion after it has committed: search for each, HBPE for the day', async () => {
    const world = await seedWorld('target');

    await service.purge(owner, world.event);

    expect(publishedOf(EventRemovedEvent)).toEqual([{ eventId: world.event }]);
    expect(publishedOf(ContentRemovedEvent)).toEqual([{ contentId: world.content }]);
    expect(notifyEvents).toHaveBeenCalledWith(ownerId, [AT]);
  });
});
