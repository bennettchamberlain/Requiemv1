import { DataSource } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { createSyntheticTestUser } from '../../../__tests__/support/applianceUser';
import { databaseAvailability, dataSourceConnection } from '../../../__tests__/support/databaseConnection';
import { acquireSchemaWriteLock, type SchemaLock } from '../../../__tests__/support/schemaLock';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT HOLDS A FOREIGN KEY TO AN EVENT, READ OUT OF THE CATALOG.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `purgeEventDependents` deletes what an event's delete would otherwise trip
 * over, and `memory.forget` in `archive_and_delete` mode is only as good as that
 * list. The way it went wrong the first time is the way it will go wrong again:
 * somebody adds a table that references `ci.events` with no `ON DELETE` action,
 * every migration and every test passes, and the first anybody hears of it is an
 * agent whose delete failed with a constraint name.
 *
 * So this suite asks Postgres what refers to `ci.events`, `ci.content` and
 * `ci.entities`, and pins the answer, action included. A new reference, or an
 * existing one whose action changed, fails here, and the failure is the prompt
 * to decide what a purge should do about it: clear it in `purgeEventDependents`,
 * or say here that it is fine as it is.
 *
 * It covers the foreign keys. The tables that name an event by a bare uuid, with
 * no constraint to find, are covered by the residue scan in
 * `CalendarEventService.purge.integration.test.ts`.
 *
 * Opt-in like its neighbours: set `MEMORY_TEST_DATABASE_URL` to a migrated
 * database of your OWN, or run `make test-db`, which provides one.
 */
const DATABASE_ENV = { urlEnvVar: 'MEMORY_TEST_DATABASE_URL' };
const availability = databaseAvailability(DATABASE_ENV);
const describeWithDb = availability.available ? describe : describe.skip;

if (!availability.available) {
  console.warn(`[memory/eventPurge.catalog.integration] SKIPPED — ${availability.reason}`);
}

jest.setTimeout(60_000);

type DeleteAction = 'NO ACTION' | 'RESTRICT' | 'CASCADE' | 'SET NULL' | 'SET DEFAULT';

const ACTIONS: Record<string, DeleteAction> = {
  a: 'NO ACTION',
  r: 'RESTRICT',
  c: 'CASCADE',
  n: 'SET NULL',
  d: 'SET DEFAULT',
};

/**
 * What refers to `ci.events`, keyed `schema.table.columns`, and what each does when
 * the event is deleted.
 */
const REFERS_TO_EVENTS: Record<string, DeleteAction> = {
  // REFUSES the delete. HBPE's cluster membership: 194,203 of 198,747 events on the
  // reference corpus. `purgeEventDependents` deletes these rows first.
  'hbpe.l1_event_cluster.event_id': 'NO ACTION',

  // CASCADES into the content hung off the event: "a row that has no independent
  // existence" (20260819014532). The cascade removes only the detail row and leaves the
  // `Content` base row, so `purgeEventDependents` deletes the content as whole aggregates
  // first, after the HBPE links below that would refuse it.
  'ci.content.event_id': 'CASCADE',

  // CASCADES, harmlessly: a reminder belongs to the planned block it reminds about.
  'ci.reminders.block_id': 'CASCADE',

  // SET NULL: these survive an event's deletion, detached, and are left that way on
  // purpose. A file's bytes and a capture's raw record have their own lifecycles.
  'ci.capture_events.event_id': 'SET NULL',
  'ci.event_candidates.promoted_event_id': 'SET NULL',
  'ci.events.recurrence_parent_id': 'SET NULL',
  'ci.files.event_id': 'SET NULL',
  'ci.object_observations.event_id': 'SET NULL',
  'ci.receipts.event_id': 'SET NULL',
};

/** What refers to `ci.content`, which an event's purge reaches through `content.event_id`. */
const REFERS_TO_CONTENT: Record<string, DeleteAction> = {
  // Both REFUSE the delete of a content row, so they go before it. `purgeEventDependents`.
  'hbpe.content_context.content_id': 'NO ACTION',
  'hbpe.l2_content_cluster.content_id': 'NO ACTION',
};

/**
 * What refuses to delete a graph node outright, of any type. Neither can point at an
 * `Event`: one is a user's own Person, the other a product entity. A delete of one of those
 * fails with a constraint violation, which `memory.forget` reports as not worth retrying.
 */
const REFUSES_A_NODE_DELETE: Record<string, DeleteAction> = {
  'ci.users.entity_id': 'NO ACTION',
  'ci.product_models.product_entity_id': 'NO ACTION',
};

describeWithDb(`what refers to an event, against Postgres (${availability.target})`, () => {
  let dataSource: DataSource;
  let schemaLock: SchemaLock | null = null;

  const ownerId = uuidv7();

  const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> =>
    dataSource.query(sql, params);

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      ...dataSourceConnection(DATABASE_ENV),
      entities: [],
      synchronize: false,
      extra: { options: '-c search_path=ci,public' },
    });
    await dataSource.initialize();
    schemaLock = await acquireSchemaWriteLock(dataSource, 'memory/eventPurge.catalog');
    await createSyntheticTestUser(q, 'EventPurgeCatalog', ownerId);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await q('DELETE FROM ci.events WHERE user_id = $1', [ownerId]);
      await q('DELETE FROM ci.entities WHERE owner_user_id = $1', [ownerId]);
      await q('DELETE FROM ci.users WHERE id = $1', [ownerId]);
      await schemaLock?.release();
      await dataSource.destroy();
    }
  });

  /** The foreign keys that point at `table`, as `schema.table.columns` → delete action. */
  async function referrersOf(table: string): Promise<Record<string, DeleteAction>> {
    const rows = await q<{ child: string; columns: string; action: string }>(
      `SELECT n.nspname || '.' || cl.relname AS child,
              (SELECT string_agg(a.attname, ',' ORDER BY k.ord)
                 FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
                 JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS columns,
              c.confdeltype AS action
         FROM pg_constraint c
         JOIN pg_class cl ON cl.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = cl.relnamespace
        WHERE c.contype = 'f' AND c.confrelid = $1::regclass`,
      [table],
    );

    return Object.fromEntries(rows.map((row) => [`${row.child}.${row.columns}`, ACTIONS[row.action]]));
  }

  it('knows every foreign key that points at ci.events, and what each does to an event’s delete', async () => {
    // A reference missing from here is one the purge has never been asked about. If this
    // fails, decide what a purge does about it (see `purgeEventDependents`), then say so above.
    expect(await referrersOf('ci.events')).toEqual(REFERS_TO_EVENTS);
  });

  it('knows every foreign key that points at ci.content, which an event’s delete cascades into', async () => {
    expect(await referrersOf('ci.content')).toEqual(REFERS_TO_CONTENT);
  });

  it('knows every foreign key that refuses to let a graph node be deleted', async () => {
    const refusing = Object.fromEntries(
      Object.entries(await referrersOf('ci.entities')).filter(([, action]) =>
        ['NO ACTION', 'RESTRICT'].includes(action),
      ),
    );

    expect(refusing).toEqual(REFUSES_A_NODE_DELETE);
  });

  it('premise: deleting an event’s node cascades into its content and leaves the content’s own node behind', async () => {
    const event = uuidv7();
    const content = uuidv7();

    await q(
      `INSERT INTO ci.entities (entity_id, entity_type, name, properties, owner_user_id)
       VALUES ($1, 'Event', 'event', '{}'::jsonb, $3), ($2, 'Content', 'content', '{}'::jsonb, $3)`,
      [event, content, ownerId],
    );
    await q(`INSERT INTO ci.events (event_id, user_id, start_time) VALUES ($1, $2, now())`, [event, ownerId]);
    await q(`INSERT INTO ci.content (id, user_id, event_id) VALUES ($1, $2, $3)`, [content, ownerId, event]);

    await q('DELETE FROM ci.entities WHERE entity_id = $1', [event]);

    // The detail row went with the event: that is `content_event_id_fkey`, ON DELETE CASCADE.
    expect(await q('SELECT 1 FROM ci.content WHERE id = $1', [content])).toEqual([]);
    // Its base row did not. Nothing cascades from a detail row up to the base row it hangs off,
    // so a `Content` node is left that no record stands behind. This is why a purge deletes the
    // content through its base row, and why it is not enough to let the cascade do it.
    expect(await q('SELECT 1 FROM ci.entities WHERE entity_id = $1', [content])).toHaveLength(1);
  });
});
