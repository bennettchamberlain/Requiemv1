import { DataSource } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import type { RequestContext, UserServiceContext } from '@ci/common/context';
import type { LoggerService } from '@ci/common/logging';
import type { EventService } from '@ci/domains/events';
import { DeterministicEdgeBackfillService } from '@ci/domains/maintenance';
import {
  BaseEntity,
  CalendarEventService,
  EventBaseEntity,
  EventEntity,
  GraphDeltaWriter,
  GraphNodeEntity,
  GraphUtilityService,
  KnownPlacesService,
  RelationshipEntity,
  type CreateEventDto,
} from '@ci/domains/memory';
import {
  ConceptRemovedEvent,
  ContentRemovedEvent,
  EventRemovedEvent,
  EventUpdatedEvent,
} from '@ci/domains/memory/events';
import { UserEntity } from '@ci/domains/user';

import { createSyntheticTestUser } from '../../../__tests__/support/applianceUser';
import { databaseAvailability, dataSourceConnection } from '../../../__tests__/support/databaseConnection';
import { acquireSchemaWriteLock, type SchemaLock } from '../../../__tests__/support/schemaLock';
import { ForgetKnowledgeTool } from '../ForgetKnowledgeTool';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * `memory.forget` ON AN EVENT. THE REAL TOOL, THE REAL SERVICES, POSTGRES.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * An event is two rows: the `ci.entities` base row (`is_active`) and the
 * `ci.events` detail row (`is_deleted`). Forget used to flip only the first, so
 * every reader that decides liveness from the second — the calendar, Known
 * places, the location-enrichment stages, HBPE, search hydration — went on
 * returning an event the user had asked the appliance to forget, while every
 * reader of the first — the graph's node reads, the edge matrix's endpoint
 * join — hid it. Deleting an event from the app had the same split, the other
 * way round.
 *
 * Archive mode now moves an event to the trash through
 * `CalendarEventService.remove`, the call `deleteEvent` makes, and `remove`
 * writes both flags. `archive_and_delete` destroys one through
 * `CalendarEventService.purge`, because deleting its graph node outright is
 * refused for any event HBPE has clustered. The unit suite for the tool proves
 * the routing against doubles. A double cannot say whether each reader then
 * agrees, or whether Postgres will let the delete through, so this file drives
 * the real thing and asks.
 *
 * Opt-in like its neighbours: set `MEMORY_TEST_DATABASE_URL` to a migrated
 * database of your OWN, or run `make test-db`, which provides one.
 */
const DATABASE_ENV = { urlEnvVar: 'MEMORY_TEST_DATABASE_URL' };
const availability = databaseAvailability(DATABASE_ENV);
const describeWithDb = availability.available ? describe : describe.skip;

if (!availability.available) {
  console.warn(`[tools/ForgetKnowledgeTool.events.integration] SKIPPED — ${availability.reason}`);
}

jest.setTimeout(120_000);

const DINNER_AT = new Date('2026-08-19T17:00:00Z');
const WINDOW_FROM = new Date('2026-08-18T00:00:00Z');
const WINDOW_TO = new Date('2026-08-21T00:00:00Z');
const KITCHEN = { lat: 34.0522, lng: -118.2437 };

const logger = () =>
  ({
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }) as unknown as LoggerService;

/** Everything one event looks like to each family of reader. */
interface Visibility {
  /** `CalendarEventService` reads — the calendar, the explorer, search hydration. */
  byId: boolean;
  inAll: boolean;
  inPage: boolean;
  inCalendarRange: boolean;
  /** The trash, the only read that returns tombstones. */
  inTrash: boolean;
  /** `GraphUtilityService` reads — the graph explorer, overview counts. */
  graphNode: boolean;
  inGraphList: boolean;
  /** The Places page, which shows event titles under each candidate. */
  inKnownPlaces: boolean;
}

const LIVE: Visibility = {
  byId: true,
  inAll: true,
  inPage: true,
  inCalendarRange: true,
  inTrash: false,
  graphNode: true,
  inGraphList: true,
  inKnownPlaces: true,
};

const GONE: Visibility = {
  byId: false,
  inAll: false,
  inPage: false,
  inCalendarRange: false,
  inTrash: true,
  graphNode: false,
  inGraphList: false,
  inKnownPlaces: false,
};

describeWithDb(`memory.forget on an Event, against Postgres (${availability.target})`, () => {
  let dataSource: DataSource;
  let schemaLock: SchemaLock | null = null;
  let calendar: CalendarEventService;
  let graph: GraphUtilityService;
  let knownPlaces: KnownPlacesService;
  let edges: DeterministicEdgeBackfillService;
  let tool: ForgetKnowledgeTool;

  const ownerId = uuidv7();
  const strangerId = uuidv7();
  const owner = { userId: ownerId } as UserServiceContext;
  const asOwner = { userId: ownerId } as RequestContext;
  const asStranger = { userId: strangerId } as RequestContext;

  /** Every domain event the code under test published, in order. */
  const published: Array<{ name: string; payload: unknown }> = [];
  const signalling = {
    send: jest.fn(async (name: string, payload: unknown) => {
      published.push({ name, payload });

      return [];
    }),
  } as unknown as EventService;

  function publishedOf(name: string): unknown[] {
    return published.filter((event) => event.name === name).map((event) => event.payload);
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      ...dataSourceConnection(DATABASE_ENV),
      entities: [EventEntity, BaseEntity, EventBaseEntity, GraphNodeEntity, RelationshipEntity, UserEntity],
      synchronize: false,
      extra: { options: '-c search_path=ci,public' },
    });
    await dataSource.initialize();
    schemaLock = await acquireSchemaWriteLock(dataSource, 'tools/ForgetKnowledgeTool.events');

    for (const userId of [ownerId, strangerId]) {
      await createSyntheticTestUser((sql, params) => dataSource.query(sql, params), 'ForgetEvents', userId);
    }

    const deltaWriter = new GraphDeltaWriter(dataSource, logger());

    calendar = new CalendarEventService(
      dataSource.getRepository(EventEntity),
      dataSource.getRepository(EventBaseEntity),
      signalling,
      dataSource,
      deltaWriter,
    );
    graph = new GraphUtilityService(
      dataSource.getRepository(GraphNodeEntity),
      dataSource.getRepository(RelationshipEntity),
      logger(),
    );
    knownPlaces = new KnownPlacesService(dataSource, logger(), {} as never);
    edges = new DeterministicEdgeBackfillService(dataSource, deltaWriter, logger());
    tool = new ForgetKnowledgeTool(graph, signalling, calendar, logger());
  });

  async function wipe(userId: string): Promise<void> {
    // HBPE's references to an event have no ON DELETE action: they go before it does.
    await dataSource.query(
      'DELETE FROM hbpe.l1_event_cluster WHERE event_id IN (SELECT event_id FROM ci.events WHERE user_id = $1)',
      [userId],
    );
    await dataSource.query('DELETE FROM hbpe.l1_clusters WHERE user_id = $1', [userId]);
    await dataSource.query('UPDATE ci.users SET entity_id = NULL WHERE id = $1', [userId]);
    await dataSource.query('DELETE FROM ci.relationships WHERE owner_user_id = $1', [userId]);
    await dataSource.query('DELETE FROM ci.graph_deltas WHERE owner_user_id = $1', [userId]);
    await dataSource.query('DELETE FROM ci.events WHERE user_id = $1', [userId]);
    await dataSource.query('DELETE FROM ci.entities WHERE owner_user_id = $1', [userId]);
  }

  beforeEach(() => {
    published.length = 0;
  });

  afterEach(async () => {
    await wipe(ownerId);
    await wipe(strangerId);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query('DELETE FROM ci.users WHERE id = ANY($1::uuid[])', [[ownerId, strangerId]]);
      await schemaLock?.release();
      await dataSource.destroy();
    }
  });

  // ── Fixtures ──────────────────────────────────────────────────────────────

  async function seedEvent(title: string, extra: Partial<CreateEventDto> = {}): Promise<string> {
    const [event] = await calendar.create(owner, { title, start_time: DINNER_AT, ...extra });

    return event.id;
  }

  /** An event with its own coordinate, so the Places page counts it. */
  function seedLocatedEvent(title: string, extra: Partial<CreateEventDto> = {}): Promise<string> {
    return seedEvent(title, {
      location_name: 'Dana’s kitchen',
      location_coordinates: { type: 'Point', coordinates: [KITCHEN.lng, KITCHEN.lat] },
      ...extra,
    });
  }

  async function seedNode(entityType: string, name: string, forUser = ownerId): Promise<string> {
    const id = uuidv7();

    await dataSource.query(
      `INSERT INTO ci.entities (entity_id, entity_type, name, properties, owner_user_id)
       VALUES ($1, $2, $3, '{}'::jsonb, $4)`,
      [id, entityType, name, forUser],
    );

    return id;
  }

  async function seedEdge(from: string, to: string, type: string): Promise<string> {
    const [{ relationship_id }] = await dataSource.query(
      `INSERT INTO ci.relationships (from_entity_id, to_entity_id, relationship_type, owner_user_id)
       VALUES ($1, $2, $3, $4)
       RETURNING relationship_id`,
      [from, to, type, ownerId],
    );

    return relationship_id;
  }

  /** An HBPE L1 cluster with a member count, for an event to be assigned to. */
  async function seedCluster(memberCount: number): Promise<string> {
    const id = uuidv7();

    await dataSource.query(
      `INSERT INTO hbpe.l1_clusters (cluster_id, user_id, l0_class, label, member_count, naming_method)
       VALUES ($1, $2, 'SOCIAL', 'DINNER', $3, 'STATIC')`,
      [id, ownerId, memberCount],
    );

    return id;
  }

  /** What HBPE does to every event it labels, and what then refuses the event's delete. */
  async function assignToCluster(eventId: string, clusterId: string): Promise<void> {
    await dataSource.query(
      'INSERT INTO hbpe.l1_event_cluster (event_id, cluster_id, similarity) VALUES ($1, $2, 0.9)',
      [eventId, clusterId],
    );
  }

  /** A `ci.content` aggregate hanging off an event, the way a photo's content row does. */
  async function seedContent(eventId: string, name: string): Promise<string> {
    const id = await seedNode('Content', name);

    await dataSource.query(
      `INSERT INTO ci.content (id, type, user_id, event_id) VALUES ($1, 'media', $2, $3)`,
      [id, ownerId, eventId],
    );

    return id;
  }

  // ── Probes ────────────────────────────────────────────────────────────────

  /** Both halves of the aggregate, or `undefined` once neither row exists. */
  async function flags(id: string): Promise<{ is_deleted: boolean; is_active: boolean } | undefined> {
    const rows = await dataSource.query(
      `SELECT ev.is_deleted, e.is_active
         FROM ci.events ev
         JOIN ci.entities e ON e.entity_id = ev.event_id
        WHERE ev.event_id = $1`,
      [id],
    );

    return rows[0];
  }

  async function visibility(id: string): Promise<Visibility> {
    const page = { first: 100 };
    const nodes = await graph.queryNodes(ownerId, { entityType: 'Event' }, { limit: 200 });
    const candidates = await knownPlaces.buildKnownPlaces(owner);

    return {
      byId: (await calendar.findById(owner, id)) !== null,
      inAll: (await calendar.findAll(owner)).some((event) => event.id === id),
      inPage: (await calendar.findPage(owner, page)).entities.some((event) => event.id === id),
      inCalendarRange: (await calendar.findInRange(owner, WINDOW_FROM, WINDOW_TO)).some(
        (event) => event.id === id,
      ),
      inTrash: (await calendar.findDeletedPage(owner, page)).entities.some((event) => event.id === id),
      graphNode: (await graph.getNodeById(id, ownerId)) !== null,
      inGraphList: nodes.some((node) => node.entity_id === id),
      inKnownPlaces: candidates.some((candidate) =>
        candidate.sampleEvents.some((sample) => sample.id === id),
      ),
    };
  }

  async function eventNodeCount(): Promise<number> {
    const counts = await graph.getEntityTypeCounts(ownerId);

    return counts.find((row) => row.entityType === 'Event')?.count ?? 0;
  }

  async function edgesOf(id: string): Promise<Array<{ relationship_type: string; is_active: boolean }>> {
    return dataSource.query(
      `SELECT relationship_type, is_active
         FROM ci.relationships
        WHERE from_entity_id = $1 OR to_entity_id = $1
        ORDER BY relationship_type`,
      [id],
    );
  }

  async function deltasOf(id: string): Promise<Array<{ change_type: string; change_source: string }>> {
    return dataSource.query(
      `SELECT change_type, change_source
         FROM ci.graph_deltas
        WHERE entity_id = $1
        ORDER BY changed_at, delta_id`,
      [id],
    );
  }

  async function forget(
    entityIds: string[],
    mode: 'archive' | 'archive_and_delete' = 'archive',
    who: RequestContext = asOwner,
  ) {
    return tool.execute(who, { entityIds, mode });
  }

  // ── Archive mode ──────────────────────────────────────────────────────────

  describe('archive mode', () => {
    it('tombstones both halves of the aggregate and keeps both rows', async () => {
      const id = await seedEvent('Dinner with Dana');

      expect(await flags(id)).toEqual({ is_deleted: false, is_active: true });

      const result = await forget([id]);

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        archivedEntityIds: [id],
        restorableEventIds: [id],
        mode: 'archive',
      });
      expect(result.data?.warnings).toBeUndefined();

      // Nothing was destroyed: the row is in the trash, not gone, and the graph
      // node is deactivated rather than deleted.
      expect(await flags(id)).toEqual({ is_deleted: true, is_active: false });

      // `remove` wrote the graph delta in the same transaction, and told search
      // exactly once. The tool added neither of its own.
      expect(await deltasOf(id)).toEqual([
        { change_type: 'created', change_source: 'CalendarEventService.create' },
        { change_type: 'deleted', change_source: 'CalendarEventService.remove' },
      ]);
      expect(publishedOf(EventRemovedEvent)).toEqual([{ eventId: id }]);
    });

    it('leaves every reader agreeing that the event is gone, and the next event untouched', async () => {
      const forgotten = await seedLocatedEvent('Dinner with Dana');
      const kept = await seedLocatedEvent('Lunch with Dana');

      expect(await visibility(forgotten)).toEqual(LIVE);
      expect(await visibility(kept)).toEqual(LIVE);
      expect(await eventNodeCount()).toBe(2);

      await forget([forgotten]);

      expect(await visibility(forgotten)).toEqual(GONE);
      expect(await visibility(kept)).toEqual(LIVE);
      expect(await eventNodeCount()).toBe(1);
    });

    it('leaves the event’s edges as they were, and derives no new ones onto it', async () => {
      const dana = await seedNode('Person', 'Dana');
      const kitchen = await seedNode('Location', 'Dana’s kitchen');
      const forgotten = await seedEvent('Dinner with Dana', {
        participant_entity_ids: [dana],
        location_entity_id: kitchen,
      });
      const kept = await seedEvent('Lunch with Dana', {
        participant_entity_ids: [dana],
        location_entity_id: kitchen,
      });

      // The tombstone cascades nothing. That is what lets `restore` put the
      // event back exactly as it was, and it is how `deleteEvent` has always
      // left them.
      await seedEdge(dana, forgotten, 'FRIEND_OF_EVENT');
      await seedEdge(forgotten, kitchen, 'HOSTED_AT');

      const result = await forget([forgotten]);

      expect(result.data?.archivedRelationshipIds).toEqual([]);
      expect(await edgesOf(forgotten)).toEqual([
        { relationship_type: 'FRIEND_OF_EVENT', is_active: true },
        { relationship_type: 'HOSTED_AT', is_active: true },
      ]);

      // The edge matrix joins both endpoints on `ci.entities.is_active`. A
      // tombstone that only set `ci.events.is_deleted` would be invisible to
      // it, and it would go on wiring the deleted event into the graph.
      const created = await edges.materializeForSourceIds(ownerId, 'events', [forgotten, kept]);

      expect(created).toBe(2);
      expect(await edgesOf(kept)).toEqual([
        { relationship_type: 'LOCATED_AT', is_active: true },
        { relationship_type: 'PARTICIPATED_IN', is_active: true },
      ]);
      expect((await edgesOf(forgotten)).map((edge) => edge.relationship_type)).toEqual([
        'FRIEND_OF_EVENT',
        'HOSTED_AT',
      ]);
    });

    it('is undone by restore, which brings every reader back', async () => {
      const dana = await seedNode('Person', 'Dana');
      const id = await seedLocatedEvent('Dinner with Dana', { participant_entity_ids: [dana] });

      await forget([id]);

      expect(await visibility(id)).toEqual(GONE);

      published.length = 0;

      const restored = await calendar.restore(owner, id);

      expect(restored?.id).toBe(id);
      expect(await flags(id)).toEqual({ is_deleted: false, is_active: true });
      expect(await visibility(id)).toEqual(LIVE);
      expect(await eventNodeCount()).toBe(1);

      // Search is told to index it again, and the edge matrix may wire it in.
      expect(publishedOf(EventUpdatedEvent)).toEqual([{ eventId: id }]);
      expect(await edges.materializeForSourceIds(ownerId, 'events', [id])).toBe(1);
    });

    it('treats a tombstone left by the old delete, which kept the graph node active, as already forgotten', async () => {
      const id = await seedEvent('Dinner with Dana');

      await calendar.remove(owner, id);
      // `remove` did not used to touch the base row; put it back the way a
      // deletion made before that change left it.
      await dataSource.query('UPDATE ci.entities SET is_active = true WHERE entity_id = $1', [id]);

      expect(await flags(id)).toEqual({ is_deleted: true, is_active: true });

      published.length = 0;

      const result = await forget([id]);

      // `remove` has nothing live left to tombstone, so the node takes the
      // generic path, which is exactly the half that was missing.
      expect(result.success).toBe(true);
      expect(result.data?.restorableEventIds).toBeUndefined();
      expect(await flags(id)).toEqual({ is_deleted: true, is_active: false });
      expect(published).toEqual([]);

      // And it is still in the trash, so Undo works.
      expect((await calendar.restore(owner, id))?.id).toBe(id);
      expect(await flags(id)).toEqual({ is_deleted: false, is_active: true });
    });

    it('refuses to forget somebody else’s event', async () => {
      const id = await seedEvent('Dinner with Dana');

      const result = await forget([id], 'archive', asStranger);

      expect(result.success).toBe(true);
      expect(result.data?.archivedEntityIds).toEqual([]);
      expect(result.data?.warnings).toEqual([`Entity ${id} not found or not owned by user`]);
      expect(await flags(id)).toEqual({ is_deleted: false, is_active: true });
      expect(published).not.toContainEqual(expect.objectContaining({ name: EventRemovedEvent }));
    });

    it('sends an event through the tombstone and a concept through the generic path, in one call', async () => {
      const dana = await seedNode('Person', 'Dana');
      const event = await seedEvent('Dinner with Dana');
      const concept = await seedNode('Concept', 'Jazz');
      const conceptEdge = await seedEdge(concept, dana, 'RELATED_TO');
      const missing = uuidv7();

      const result = await forget([event, concept, missing]);

      expect(result.success).toBe(true);
      expect(result.data?.archivedEntityIds).toEqual([event, concept]);
      expect(result.data?.restorableEventIds).toEqual([event]);
      expect(result.data?.warnings).toEqual([`Entity ${missing} not found or not owned by user`]);

      expect(await flags(event)).toEqual({ is_deleted: true, is_active: false });

      // The concept has no detail row to tombstone: its node is deactivated,
      // its own edges go with it, and search drops it, exactly as before.
      const [conceptRow] = await dataSource.query('SELECT is_active FROM ci.entities WHERE entity_id = $1', [
        concept,
      ]);
      const [edgeRow] = await dataSource.query(
        'SELECT is_active FROM ci.relationships WHERE relationship_id = $1',
        [conceptEdge],
      );

      expect(conceptRow).toEqual({ is_active: false });
      expect(edgeRow).toEqual({ is_active: false });
      expect(publishedOf(ConceptRemovedEvent)).toEqual([{ conceptId: concept }]);
      expect(publishedOf(EventRemovedEvent)).toEqual([{ eventId: event }]);
    });
  });

  // ── Archive-and-delete mode ───────────────────────────────────────────────

  describe('archive_and_delete mode', () => {
    it('destroys an event outright, rather than moving it to the trash', async () => {
      const dana = await seedNode('Person', 'Dana');
      const id = await seedEvent('Dinner with Dana');
      const outbound = await seedEdge(id, dana, 'HOSTED_BY');
      const inbound = await seedEdge(dana, id, 'ATTENDED');

      const result = await forget([id], 'archive_and_delete');

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({ archivedEntityIds: [id], mode: 'archive_and_delete' });
      expect(result.data?.restorableEventIds).toBeUndefined();
      expect(result.data?.purgedContentIds).toBeUndefined();

      // Both rows are gone, not tombstoned, so there is nothing for restore to find, and
      // the event's edges went with it, the one pointing AT it as well as the one leaving it.
      expect(await flags(id)).toBeUndefined();
      expect(await dataSource.query('SELECT 1 FROM ci.entities WHERE entity_id = $1', [id])).toEqual([]);
      expect(await dataSource.query('SELECT 1 FROM ci.events WHERE event_id = $1', [id])).toEqual([]);
      expect(
        await dataSource.query('SELECT 1 FROM ci.relationships WHERE relationship_id = ANY($1::uuid[])', [
          [outbound, inbound],
        ]),
      ).toEqual([]);
      expect(await calendar.restore(owner, id)).toBeNull();

      // The deletion went through the aggregate, so search was told once and the audit
      // trail has it.
      expect(publishedOf(EventRemovedEvent)).toEqual([{ eventId: id }]);
      expect(await deltasOf(id)).toEqual([
        { change_type: 'created', change_source: 'CalendarEventService.create' },
        { change_type: 'deleted', change_source: 'CalendarEventService.purge' },
      ]);
    });

    it('destroys an event HBPE has clustered, which deleting its graph node cannot', async () => {
      const cluster = await seedCluster(5);
      const id = await seedEvent('Dinner with Dana');
      await assignToCluster(id, cluster);

      expect(
        await dataSource.query('SELECT 1 FROM hbpe.l1_event_cluster WHERE event_id = $1', [id]),
      ).toHaveLength(1);

      const result = await forget([id], 'archive_and_delete');

      // This is the case that used to fail with
      //   update or delete on table "events" violates foreign key constraint
      //   "l1_event_cluster_event_id_fkey" on table "l1_event_cluster"
      // and call itself retryable.
      expect(result.error).toBeUndefined();
      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({ archivedEntityIds: [id], mode: 'archive_and_delete' });
      expect(await flags(id)).toBeUndefined();
      expect(await dataSource.query('SELECT 1 FROM hbpe.l1_event_cluster WHERE event_id = $1', [id])).toEqual(
        [],
      );

      // The cluster is the user's HBPE vocabulary, not the event's: it stays, one member lighter.
      expect(
        await dataSource.query('SELECT member_count FROM hbpe.l1_clusters WHERE cluster_id = $1', [cluster]),
      ).toEqual([{ member_count: 4 }]);
    });

    it('is why events do not take the generic delete: deleting a clustered event’s node is still refused', async () => {
      const cluster = await seedCluster(1);
      const dana = await seedNode('Person', 'Dana');
      const id = await seedEvent('Dinner with Dana');
      await assignToCluster(id, cluster);
      const edge = await seedEdge(dana, id, 'ATTENDED');

      await expect(graph.deactivateEntities([id], ownerId, true)).rejects.toMatchObject({
        driverError: { code: '23503', constraint: 'l1_event_cluster_event_id_fkey' },
      });

      // Refused, and refused whole: the edge that was about to go with the node is still there.
      expect(await flags(id)).toEqual({ is_deleted: false, is_active: true });
      expect(
        await dataSource.query('SELECT 1 FROM ci.relationships WHERE relationship_id = $1', [edge]),
      ).toHaveLength(1);
    });

    it('destroys an event that is already in the trash', async () => {
      const cluster = await seedCluster(3);
      const id = await seedEvent('Dinner with Dana');
      // Clustered, so only `purge` can delete it. An unclustered event in the trash would be deleted by
      // the generic path just the same, and the test would pass without proving that `purge` reaches it.
      await assignToCluster(id, cluster);

      const archived = await forget([id]);

      expect(archived.data?.restorableEventIds).toEqual([id]);
      expect(await flags(id)).toEqual({ is_deleted: true, is_active: false });

      // Its graph node is inactive now, so this is only reachable if a delete looks for
      // inactive nodes: the usual order is "forget it, and later erase it".
      const result = await forget([id], 'archive_and_delete');

      expect(result.success).toBe(true);
      expect(result.data?.archivedEntityIds).toEqual([id]);
      expect(result.data?.warnings).toBeUndefined();
      expect(await flags(id)).toBeUndefined();
      expect(await calendar.restore(owner, id)).toBeNull();
      expect(
        await dataSource.query('SELECT member_count FROM hbpe.l1_clusters WHERE cluster_id = $1', [cluster]),
      ).toEqual([{ member_count: 2 }]);
    });

    it('takes the content attached to the event with it, and says which', async () => {
      const id = await seedEvent('Dinner with Dana');
      const photo = await seedContent(id, 'Photo of dinner');
      const other = await seedEvent('Lunch with Dana');
      const otherPhoto = await seedContent(other, 'Photo of lunch');

      const result = await forget([id], 'archive_and_delete');

      expect(result.success).toBe(true);
      // The caller named one event. The content is reported apart from it.
      expect(result.data?.archivedEntityIds).toEqual([id]);
      expect(result.data?.purgedContentIds).toEqual([photo]);

      // Gone as a whole aggregate: no `Content` node left behind without a record.
      expect(await dataSource.query('SELECT 1 FROM ci.content WHERE id = $1', [photo])).toEqual([]);
      expect(await dataSource.query('SELECT 1 FROM ci.entities WHERE entity_id = $1', [photo])).toEqual([]);
      expect(publishedOf(ContentRemovedEvent)).toEqual([{ contentId: photo }]);

      // Another event's content is not.
      expect(await dataSource.query('SELECT 1 FROM ci.content WHERE id = $1', [otherPhoto])).toHaveLength(1);
      expect(await flags(other)).toEqual({ is_deleted: false, is_active: true });
    });

    it('sends an event and a concept down their own paths, in one call', async () => {
      const dana = await seedNode('Person', 'Dana');
      const cluster = await seedCluster(2);
      const event = await seedEvent('Dinner with Dana');
      await assignToCluster(event, cluster);
      const concept = await seedNode('Concept', 'Jazz');
      await seedEdge(concept, dana, 'RELATED_TO');
      await seedEdge(dana, concept, 'LIKES');

      const result = await forget([event, concept], 'archive_and_delete');

      expect(result.success).toBe(true);
      expect(result.data?.archivedEntityIds).toEqual([event, concept]);
      expect(await flags(event)).toBeUndefined();
      expect(await dataSource.query('SELECT 1 FROM ci.entities WHERE entity_id = $1', [concept])).toEqual([]);
      expect(publishedOf(ConceptRemovedEvent)).toEqual([{ conceptId: concept }]);
      expect(
        await dataSource.query(
          'SELECT 1 FROM ci.relationships WHERE from_entity_id = $1 OR to_entity_id = $1',
          [concept],
        ),
      ).toEqual([]);
    });

    it('refuses to destroy somebody else’s event', async () => {
      const id = await seedEvent('Dinner with Dana');

      const result = await forget([id], 'archive_and_delete', asStranger);

      expect(result.success).toBe(true);
      expect(result.data?.archivedEntityIds).toEqual([]);
      expect(result.data?.warnings).toEqual([`Entity ${id} not found or not owned by user`]);
      expect(await flags(id)).toEqual({ is_deleted: false, is_active: true });
      expect(publishedOf(EventRemovedEvent)).toEqual([]);
      expect(publishedOf(ContentRemovedEvent)).toEqual([]);
    });
  });

  describe('archive_and_delete mode, for every other type', () => {
    it('takes a node’s edges in both directions, not just the ones leaving it', async () => {
      const dana = await seedNode('Person', 'Dana');
      const jazz = await seedNode('Concept', 'Jazz');
      const outbound = await seedEdge(jazz, dana, 'RELATED_TO');
      // This one points AT the node. Nothing used to delete it, and `ci.relationships` has no
      // foreign key to `ci.entities` to do it instead, so it stayed, pointing at nothing.
      const inbound = await seedEdge(dana, jazz, 'LIKES');
      const unrelated = await seedEdge(dana, await seedNode('Concept', 'Blues'), 'LIKES');

      const result = await forget([jazz], 'archive_and_delete');

      expect(result.success).toBe(true);
      expect(await dataSource.query('SELECT 1 FROM ci.entities WHERE entity_id = $1', [jazz])).toEqual([]);
      expect(
        await dataSource.query('SELECT 1 FROM ci.relationships WHERE relationship_id = ANY($1::uuid[])', [
          [outbound, inbound],
        ]),
      ).toEqual([]);
      expect(
        await dataSource.query('SELECT 1 FROM ci.relationships WHERE relationship_id = $1', [unrelated]),
      ).toHaveLength(1);
    });

    it('does not touch the edges of a node it does not own', async () => {
      const mine = await seedNode('Concept', 'Jazz');
      const theirs = await seedNode('Concept', 'Jazz', strangerId);

      // An edge of the stranger's that happens to name my node's id is the stranger's to keep.
      const [{ relationship_id }] = await dataSource.query(
        `INSERT INTO ci.relationships (from_entity_id, to_entity_id, relationship_type, owner_user_id)
         VALUES ($1, $2, 'SAME_AS', $3) RETURNING relationship_id`,
        [theirs, mine, strangerId],
      );

      const result = await forget([mine], 'archive_and_delete');

      expect(result.success).toBe(true);
      expect(
        await dataSource.query('SELECT 1 FROM ci.relationships WHERE relationship_id = $1', [
          relationship_id,
        ]),
      ).toHaveLength(1);
      expect(await dataSource.query('SELECT 1 FROM ci.entities WHERE entity_id = $1', [theirs])).toHaveLength(
        1,
      );
    });

    it('deletes a node that was archived earlier', async () => {
      const jazz = await seedNode('Concept', 'Jazz');

      await forget([jazz]);

      expect(await forget([jazz])).toMatchObject({
        success: true,
        data: { archivedEntityIds: [], warnings: [`Entity ${jazz} not found or not owned by user`] },
      });

      const result = await forget([jazz], 'archive_and_delete');

      expect(result.data?.archivedEntityIds).toEqual([jazz]);
      expect(await dataSource.query('SELECT 1 FROM ci.entities WHERE entity_id = $1', [jazz])).toEqual([]);
    });

    it('is refused whole by a foreign key, and says that trying again will not help', async () => {
      // `ci.users.entity_id` references the user's own Person with no ON DELETE action.
      const me = await seedNode('Person', 'Me');
      const dana = await seedNode('Person', 'Dana');
      const outbound = await seedEdge(me, dana, 'KNOWS');
      const inbound = await seedEdge(dana, me, 'KNOWS');

      await dataSource.query('UPDATE ci.users SET entity_id = $1 WHERE id = $2', [me, ownerId]);

      const result = await forget([me], 'archive_and_delete');

      expect(result.success).toBe(false);
      expect(result.error).toMatchObject({
        code: 'CONSTRAINT_VIOLATION',
        retryable: false,
        details: { constraint: 'users_entity_id_fkey', table: 'users' },
      });
      expect(result.error?.message).toContain('mode "archive"');

      // Nothing changed: the node and both edges are as they were. The edges were deleted
      // first, in the same transaction, and the refused delete took that back.
      expect(await dataSource.query('SELECT 1 FROM ci.entities WHERE entity_id = $1', [me])).toHaveLength(1);
      expect(
        await dataSource.query('SELECT 1 FROM ci.relationships WHERE relationship_id = ANY($1::uuid[])', [
          [outbound, inbound],
        ]),
      ).toHaveLength(2);
    });
  });
});
