import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import dotenv from 'dotenv';
import { DataSource, type QueryRunner } from 'typeorm';

import { NodeEntity } from '@ci/domains/graph';

import { DeltaEntity } from '../entities/DeltaEntity';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ci.graph_deltas IS WRITTEN BY THE DATABASE NOW — proof, against the database
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The measurement that started this: on a live appliance, `ci.entities` = 170
 * and `ci.graph_deltas` = 0. `DeltaEntitySubscriber` hooked TypeORM's
 * afterInsert/afterUpdate/afterRemove, and `GraphIngestService` — the path
 * essentially every entity arrives by — writes with
 * `.createQueryBuilder().insert()`, which emits no subscriber events. So the
 * table has been empty since it was created, while
 * `backend/apps/summary/src/ci/summary/insight_aggregator.py` has been building
 * the "what changed in your graph" section of every insight summary out of it.
 * Zero rows reads exactly like "nothing happened".
 *
 * `20260809182943_graph_delta_triggers.sql` replaces the subscriber with
 * statement-level triggers. This spec exists because that migration cannot be
 * unit tested: what it claims is that *no write path can avoid it*, and the
 * only way to find out is to write, by every path there is, into real Postgres.
 *
 * ## The first test is the bug
 *
 * `describe('without the triggers')` drops them inside its own transaction,
 * inserts entities exactly the way the import path does, and asserts that
 * NOTHING is recorded. That is not a historical curiosity — it is the
 * production behaviour this change ends, and it is what a dropped trigger would
 * bring straight back, silently, with every read path still returning zero rows
 * and no error anywhere.
 *
 * ## How it stays out of the operator's data
 *
 * Same discipline as `DeadLetterReaperListener.spec.ts`, one notch stricter.
 * Every test runs inside a transaction that is **always rolled back** — the
 * migration's DDL included. The triggers exist only inside that transaction, so
 * no other session can even see them, nothing is committed, there is nothing to
 * clean up, and a `kill -9` mid-run leaves the appliance untouched because the
 * aborted transaction takes the lot.
 *
 * Two consequences worth knowing:
 *
 *  - The transaction is REPEATABLE READ. The count assertions are `before + n`
 *    diffs, and under READ COMMITTED a live appliance committing its own deltas
 *    between the two counts would move the number underneath the assertion.
 *  - `CREATE TRIGGER` takes SHARE ROW EXCLUSIVE on `ci.entities` and
 *    `ci.relationships`, so a concurrent write by the running appliance waits
 *    for the rollback. Each test is milliseconds; that is the price of testing
 *    a trigger on a live table, and it is paid in full at rollback.
 */

// The rest of the toolchain runs with DOTENV_CONFIG_PATH pointing at the
// repo-root .env, and `src/bootstrap.ts` is what turns that into process.env for
// the running app. Test files never import bootstrap, so the same load happens
// here, at module scope, BEFORE anything reads process.env.
dotenv.config({ path: path.resolve(process.cwd(), process.env.DOTENV_CONFIG_PATH ?? '.env') });

// ---------------------------------------------------------------------------
// Connection resolution
// ---------------------------------------------------------------------------
//
// Deliberately a local copy of what `domains/pipeline/__tests__/harness` does
// rather than an import: `.dependency-cruiser.mjs` forbids one domain reaching
// into another's internals, and a test harness is internals. The contract is
// the one documented in that harness's README — same variables, same
// precedence, same rule that the password is the only field with no default,
// because its absence is exactly the signal "there is no database here".

interface Connection {
  url?: string;
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
}

const DEFAULT_HOST = 'localhost';
const DEFAULT_PORT = 5432;
const DEFAULT_USERNAME = 'companion';
const DEFAULT_DATABASE = 'companion';

function resolveConnection(): Connection | null {
  const url = process.env.AUDIT_TEST_DATABASE_URL ?? process.env.DATABASE_URL;

  if (url != null && url.trim().length > 0) {
    try {
      const parsed = new URL(url);

      return {
        url,
        host: parsed.hostname,
        port: parsed.port.length > 0 ? Number(parsed.port) : DEFAULT_PORT,
        username: decodeURIComponent(parsed.username) || DEFAULT_USERNAME,
        password: decodeURIComponent(parsed.password),
        database: parsed.pathname.replace(/^\//, '') || DEFAULT_DATABASE,
      };
    } catch {
      return null;
    }
  }

  const password = process.env.DATABASE_PASSWORD;

  if (password == null || password.length === 0) {
    return null;
  }

  return {
    host: process.env.DATABASE_HOST ?? DEFAULT_HOST,
    port: Number(process.env.DATABASE_PORT ?? DEFAULT_PORT),
    username: process.env.DATABASE_USERNAME ?? DEFAULT_USERNAME,
    database: process.env.DATABASE_NAME ?? DEFAULT_DATABASE,
    password,
  };
}

/**
 * TCP reachability, SYNCHRONOUSLY — jest has to choose `describe` vs
 * `describe.skip` while the module is evaluated, and this file compiles to
 * CommonJS, so there is no top-level await. One short-lived child process doing
 * a `net.connect`, depending on nothing but a node builtin.
 */
function isPortOpen(host: string, port: number, timeoutMs: number): boolean {
  const script =
    "const net = require('node:net');" +
    'const socket = net.connect({ host: process.argv[1], port: Number(process.argv[2]) });' +
    'socket.setTimeout(Number(process.argv[3]));' +
    "socket.on('connect', () => { socket.destroy(); process.exit(0); });" +
    "socket.on('timeout', () => { socket.destroy(); process.exit(1); });" +
    "socket.on('error', () => { process.exit(1); });";

  const probe = spawnSync(process.execPath, ['-e', script, host, String(port), String(timeoutMs)], {
    timeout: timeoutMs + 5_000,
    stdio: 'ignore',
  });

  return probe.status === 0;
}

const connection = resolveConnection();
const available =
  connection != null &&
  isPortOpen(connection.host, connection.port, Number(process.env.AUDIT_TEST_PROBE_TIMEOUT_MS ?? 2_000));
const reason =
  connection == null
    ? 'no database configured — set DATABASE_PASSWORD / DATABASE_URL (or AUDIT_TEST_DATABASE_URL)'
    : `nothing listening on ${connection.host}:${connection.port}`;

if (!available) {
  // Printed once per run so a skipped suite is never mistaken for a passing one.
  console.warn(`[graphDeltaTrigger.spec] SKIPPED — ${reason}`);
}

const describeWithDatabase = available ? describe : describe.skip;

// ---------------------------------------------------------------------------
// The migration under test, read from disk
// ---------------------------------------------------------------------------

/**
 * The triggers migration, split into the half that installs it and the
 * `DROP TRIGGER` statements out of its down half.
 *
 * Read from the real file rather than restated here: a copy would let the file
 * and the thing under test drift apart, and drift is what this whole subsystem
 * is being rebuilt to remove. Found by suffix so regenerating the migration's
 * timestamp (the only sanctioned way to make one) does not break the suite.
 */
function readMigration(): { up: string; triggerDrops: string } {
  const dir = path.resolve(__dirname, '../../../..', 'db/postgres/migrations');
  const file = readdirSync(dir)
    .filter((name) => name.endsWith('_graph_delta_triggers.sql'))
    .sort()
    .pop();

  if (file == null) {
    throw new Error(`No *_graph_delta_triggers.sql migration found in ${dir}`);
  }

  const sql = readFileSync(path.join(dir, file), 'utf8');
  const [up, down] = sql.split(/^-- migrate:down$/m);

  if (up == null || !/CREATE TRIGGER/i.test(up)) {
    throw new Error(`${file} has no -- migrate:up section that creates triggers`);
  }

  const drops = (down ?? '').split('\n').filter((line) => line.startsWith('DROP TRIGGER'));

  if (drops.length !== 6) {
    throw new Error(
      `${file}'s down section drops ${drops.length} triggers, expected 6 (insert/update/delete on entities and relationships)`,
    );
  }

  return { up, triggerDrops: drops.join('\n') };
}

const MIGRATION = available ? readMigration() : { up: '', triggerDrops: '' };

// ---------------------------------------------------------------------------

interface DeltaRow {
  delta_id: string;
  entity_id: string | null;
  relationship_id: string | null;
  node_type: string;
  entity_type: string | null;
  relationship_type: string | null;
  from_entity_id: string | null;
  to_entity_id: string | null;
  change_type: string;
  changed_fields: Record<string, { old?: unknown; new?: unknown }>;
  change_source: string | null;
  change_reason: string | null;
  changed_at: Date;
  owner_user_id: string | null;
}

describeWithDatabase('ci.graph_deltas triggers (real Postgres)', () => {
  let dataSource: DataSource;
  let runner: QueryRunner;
  /** A real user, because ci.entities.owner_user_id is a foreign key into ci.users. */
  let userId: string;

  beforeAll(async () => {
    if (connection == null) {
      throw new Error('availability said yes but no connection resolved');
    }

    dataSource = new DataSource({
      type: 'postgres',
      // Discrete fields rather than a URL assembled here: the dev password ends
      // in `!` and must not have to survive percent-encoding.
      ...(connection.url != null
        ? { url: connection.url }
        : {
            host: connection.host,
            port: connection.port,
            username: connection.username,
            password: connection.password,
            database: connection.database,
          }),
      // NodeEntity is here for one reason: the regression test writes through
      // `.createQueryBuilder().insert().into(NodeEntity)`, which is the exact
      // call GraphIngestService makes and the exact call the subscriber could
      // not see. DeltaEntity is here so the READ path — which survives this
      // change — can be pointed at what the trigger wrote.
      entities: [NodeEntity, DeltaEntity],
      synchronize: false,
      logging: false,
      extra: { max: 2 },
    });

    await dataSource.initialize();

    // Three outcomes, deliberately different: no database → skipped above; a
    // database missing the tables → FAIL here naming the fix, because that is a
    // broken setup and skipping would turn a migration mistake into a green run.
    const probe = dataSource.createQueryRunner();
    await probe.connect();
    await probe.startTransaction();

    try {
      const [present] = (await probe.query(
        `SELECT to_regclass('ci.graph_deltas')::text AS deltas,
                to_regclass('ci.entities')::text     AS entities,
                to_regclass('ci.relationships')::text AS relationships`,
      )) as Array<{ deltas: string | null; entities: string | null; relationships: string | null }>;

      if (present.deltas == null || present.entities == null || present.relationships == null) {
        throw new Error(
          'ci.graph_deltas / ci.entities / ci.relationships are missing — run ' +
            '`yarn workspace @ci/be-api migrate` and re-run this suite.',
        );
      }

      const users = (await probe.query(`SELECT id FROM ci.users ORDER BY id LIMIT 1`)) as Array<{
        id: string;
      }>;

      if (users.length === 0) {
        throw new Error(
          'This suite needs one row in ci.users: ci.entities.owner_user_id is a foreign key, and ' +
            'owner_user_id is the column every consumer query filters on.',
        );
      }

      userId = users[0].id;
    } finally {
      // Even the probe. Nothing this file runs is ever committed.
      await probe.rollbackTransaction();
      await probe.release();
    }
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    runner = dataSource.createQueryRunner();
    await runner.connect();
    // REPEATABLE READ: the count assertions are diffs, and a live appliance
    // committing deltas of its own mid-test would otherwise move the baseline.
    await runner.startTransaction('REPEATABLE READ');
  });

  afterEach(async () => {
    // ALWAYS a rollback — the triggers, the entities, the deltas, all of it.
    await runner.rollbackTransaction();
    await runner.release();
  });

  /** Apply the migration inside this test's transaction. Visible to nobody else. */
  async function applyTriggers(): Promise<void> {
    await runner.query(MIGRATION.up);
  }

  /**
   * Take the triggers away inside this test's transaction.
   *
   * Not a no-op just because the dev database has not run the migration yet:
   * once it has, "what production does today" would quietly start testing the
   * fixed behaviour and pass for the wrong reason. This makes the untriggered
   * state explicit, and it doubles as the assertion that dropping the triggers
   * brings the silence straight back.
   */
  async function removeTriggers(): Promise<void> {
    await runner.query(MIGRATION.triggerDrops);
  }

  async function totalDeltas(): Promise<number> {
    const [row] = (await runner.query(`SELECT count(*)::int AS n FROM ci.graph_deltas`)) as Array<{
      n: number;
    }>;

    return row.n;
  }

  async function deltasForEntity(entityId: string): Promise<DeltaRow[]> {
    return (await runner.query(`SELECT * FROM ci.graph_deltas WHERE entity_id = $1::uuid`, [
      entityId,
    ])) as DeltaRow[];
  }

  async function deltasForRelationship(relationshipId: string): Promise<DeltaRow[]> {
    return (await runner.query(`SELECT * FROM ci.graph_deltas WHERE relationship_id = $1::uuid`, [
      relationshipId,
    ])) as DeltaRow[];
  }

  /** One entity, written by raw SQL — no ORM anywhere in the path. */
  async function insertEntityRaw(
    fields: { entityId?: string; entityType?: string; name?: string; description?: string } = {},
  ): Promise<string> {
    const entityId = fields.entityId ?? randomUUID();

    await runner.query(
      `INSERT INTO ci.entities (entity_id, entity_type, name, description, owner_user_id)
       VALUES ($1::uuid, $2, $3, $4, $5::uuid)`,
      [
        entityId,
        fields.entityType ?? 'Person',
        fields.name ?? 'Raw Insert',
        fields.description ?? null,
        userId,
      ],
    );

    return entityId;
  }

  /**
   * Entities written the way `GraphIngestService` writes them: TypeORM's query
   * builder, values in bulk. This is the call that never fired the subscriber.
   */
  async function insertEntitiesViaQueryBuilder(count: number, prefix: string): Promise<string[]> {
    const rows = Array.from({ length: count }, (_unused, index) => ({
      entityId: randomUUID(),
      entityType: 'Concept',
      name: `${prefix} ${index}`,
      description: null,
      properties: {},
      userId,
    }));

    await runner.manager.createQueryBuilder().insert().into(NodeEntity).values(rows).execute();

    return rows.map((row) => row.entityId);
  }

  // -------------------------------------------------------------------------
  // The bug, pinned
  // -------------------------------------------------------------------------

  describe('without the triggers — what production does today', () => {
    it('records nothing for a query-builder bulk insert, which is how the graph is written', async () => {
      await removeTriggers();

      const before = await totalDeltas();

      const ids = await insertEntitiesViaQueryBuilder(5, 'unrecorded');

      // Five entities exist and not one delta does. `DeltaEntitySubscriber` was
      // registered in AuditModule and looked exactly like it handled this.
      const [entities] = (await runner.query(
        `SELECT count(*)::int AS n FROM ci.entities WHERE entity_id = ANY($1::uuid[])`,
        [ids],
      )) as Array<{ n: number }>;

      expect(entities.n).toBe(5);
      expect(await totalDeltas()).toBe(before);
      expect(await deltasForEntity(ids[0])).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // The trigger
  // -------------------------------------------------------------------------

  describe('after the migration', () => {
    beforeEach(async () => {
      await applyTriggers();
    });

    it('records one delta for a single-row insert', async () => {
      const entityId = randomUUID();

      // Zero, and on the appliance this was written against the whole table was
      // zero. Scoped rather than global so the assertion still means "this write
      // was not recorded before" on a machine that has since recorded plenty.
      expect(await deltasForEntity(entityId)).toHaveLength(0);

      const before = await totalDeltas();

      await insertEntityRaw({ entityId, name: 'Ada Lovelace', description: 'first' });

      expect(await totalDeltas()).toBe(before + 1);

      const [delta] = await deltasForEntity(entityId);
      expect(delta.node_type).toBe('entity');
      expect(delta.change_type).toBe('created');
      expect(delta.entity_type).toBe('Person');
      expect(delta.relationship_id).toBeNull();
      // Every consumer query is `WHERE owner_user_id = :user_id`. A delta
      // without it is a delta the summary can never see.
      expect(delta.owner_user_id).toBe(userId);
      expect(delta.changed_fields.name).toEqual({ new: 'Ada Lovelace' });
      expect(delta.changed_fields.description).toEqual({ new: 'first' });
    });

    it('records 1,000 deltas for a 1,000-row bulk insert — in ONE statement', async () => {
      const before = await totalDeltas();

      // An observer: a statement-level trigger on ci.graph_deltas itself, which
      // therefore counts the delta trigger's own INSERTs and how many rows each
      // one wrote. This is the property that made a trigger affordable — the
      // ingest path measures ~6,200 records/sec on set-based writes, and a
      // FOR EACH ROW trigger would have spent it.
      await runner.query(`CREATE TABLE ci.graph_delta_probe (rows_written bigint)`);
      await runner.query(
        `CREATE FUNCTION ci.graph_delta_probe_count() RETURNS trigger LANGUAGE plpgsql AS $probe$
           BEGIN INSERT INTO ci.graph_delta_probe SELECT count(*) FROM written; RETURN NULL; END;
         $probe$`,
      );
      await runner.query(
        `CREATE TRIGGER graph_delta_probe AFTER INSERT ON ci.graph_deltas
           REFERENCING NEW TABLE AS written
           FOR EACH STATEMENT EXECUTE FUNCTION ci.graph_delta_probe_count()`,
      );

      // Set-based: one INSERT ... SELECT, 1,000 rows.
      await runner.query(
        `INSERT INTO ci.entities (entity_type, name, owner_user_id)
         SELECT 'Concept', 'bulk ' || g, $1::uuid FROM generate_series(1, 1000) AS g`,
        [userId],
      );

      expect(await totalDeltas()).toBe(before + 1000);

      const probe = (await runner.query(
        `SELECT count(*)::int AS statements, coalesce(sum(rows_written), 0)::int AS rows FROM ci.graph_delta_probe`,
      )) as Array<{ statements: number; rows: number }>;

      expect(probe[0]).toEqual({ statements: 1, rows: 1000 });
    });

    it('is declared FOR EACH STATEMENT with transition tables, on both tables, for all three operations', async () => {
      const rows = (await runner.query(
        `SELECT tgname, pg_get_triggerdef(oid) AS def
           FROM pg_trigger
          WHERE NOT tgisinternal
            AND tgrelid IN ('ci.entities'::regclass, 'ci.relationships'::regclass)
            AND tgname LIKE '%graph_delta%'
          ORDER BY tgname`,
      )) as Array<{ tgname: string; def: string }>;

      expect(rows.map((row) => row.tgname)).toEqual([
        'entities_graph_delta_delete',
        'entities_graph_delta_insert',
        'entities_graph_delta_update',
        'relationships_graph_delta_delete',
        'relationships_graph_delta_insert',
        'relationships_graph_delta_update',
      ]);

      for (const row of rows) {
        expect(row.def).toMatch(/FOR EACH STATEMENT/);
        expect(row.def).toMatch(/REFERENCING/);
      }
    });

    it("records a write made through TypeORM's query builder — the path that defeated the subscriber", async () => {
      const before = await totalDeltas();

      const ids = await insertEntitiesViaQueryBuilder(50, 'query builder');

      expect(await totalDeltas()).toBe(before + 50);

      const [delta] = await deltasForEntity(ids[0]);
      expect(delta.change_type).toBe('created');
      expect(delta.owner_user_id).toBe(userId);
    });

    it('records a write made by raw SQL, with no ORM in the path at all', async () => {
      const before = await totalDeltas();

      // Not `runner.manager`, not a repository, not an entity class: a string of
      // SQL, which is what every migration, script and psql session sends. A
      // subscriber cannot see this by construction; a trigger cannot miss it.
      const entityId = randomUUID();
      await runner.query(
        `INSERT INTO ci.entities (entity_id, entity_type, name, owner_user_id)
         VALUES ('${entityId}'::uuid, 'Person', 'Raw SQL Person', '${userId}'::uuid)`,
      );

      expect(await totalDeltas()).toBe(before + 1);
      expect((await deltasForEntity(entityId))[0].change_type).toBe('created');
    });

    it('records an update with the fields that changed, old and new', async () => {
      const entityId = await insertEntityRaw({ name: 'Grace Hopper', description: 'first' });
      const before = await totalDeltas();

      await runner.query(`UPDATE ci.entities SET description = $2 WHERE entity_id = $1::uuid`, [
        entityId,
        'second',
      ]);

      expect(await totalDeltas()).toBe(before + 1);

      const updates = (await deltasForEntity(entityId)).filter((row) => row.change_type === 'updated');
      expect(updates).toHaveLength(1);
      expect(updates[0].changed_fields.description).toEqual({ old: 'first', new: 'second' });
      // The display anchor. `summarizer.py` and `summary_functions.py` both
      // label an entity delta with changed_fields["name"]["new"] or ["old"] —
      // without this, an edit to a description reaches the LLM as
      // "UPDATED Person: Unknown".
      expect(updates[0].changed_fields.name).toEqual({ old: 'Grace Hopper', new: 'Grace Hopper' });
      // Untracked columns stay out of the record.
      expect(Object.keys(updates[0].changed_fields).sort()).toEqual(['description', 'name']);
    });

    it('records nothing for an update that touches no tracked field', async () => {
      const entityId = await insertEntityRaw({ name: 'Untouched' });
      const before = await totalDeltas();

      // What the enrichment pipeline does constantly. One delta per embedding
      // backfill would bury the changes a human would recognise.
      await runner.query(
        `UPDATE ci.entities SET last_accessed = now(), updated_at = now() WHERE entity_id = $1::uuid`,
        [entityId],
      );

      expect(await totalDeltas()).toBe(before);
    });

    it('uses the archived and merged vocabulary the CHECK constraint pins', async () => {
      const target = await insertEntityRaw({ name: 'Canonical' });
      const entityId = await insertEntityRaw({ name: 'Duplicate' });

      await runner.query(`UPDATE ci.entities SET is_archived = TRUE WHERE entity_id = $1::uuid`, [entityId]);
      await runner.query(
        `UPDATE ci.entities SET merged_into_entity_id = $2::uuid WHERE entity_id = $1::uuid`,
        [entityId, target],
      );

      const types = (await deltasForEntity(entityId)).map((row) => row.change_type).sort();
      expect(types).toEqual(['archived', 'created', 'merged']);
    });

    it('records a removal, and keeps the id of the thing that was removed', async () => {
      const entityId = await insertEntityRaw({ name: 'Deleted Person', description: 'gone' });
      const before = await totalDeltas();

      await runner.query(`DELETE FROM ci.entities WHERE entity_id = $1::uuid`, [entityId]);

      expect(await totalDeltas()).toBe(before + 1);

      const deletions = (await deltasForEntity(entityId)).filter((row) => row.change_type === 'deleted');
      expect(deletions).toHaveLength(1);
      // The whole reason the migration drops graph_deltas' FK to ci.entities:
      // with it, this row could not be written at all (the referent is already
      // gone), and ON DELETE SET NULL was erasing the id from the deltas that
      // were already there.
      expect(deletions[0].entity_id).toBe(entityId);
      expect(deletions[0].changed_fields.name).toEqual({ old: 'Deleted Person' });
      expect(deletions[0].changed_fields.description).toEqual({ old: 'gone' });
    });

    it('records relationships as their own node_type, with the endpoints', async () => {
      const from = await insertEntityRaw({ name: 'From' });
      const to = await insertEntityRaw({ name: 'To' });
      const relationshipId = randomUUID();

      await runner.query(
        `INSERT INTO ci.relationships (relationship_id, from_entity_id, to_entity_id, relationship_type, owner_user_id)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'KNOWS', $4::uuid)`,
        [relationshipId, from, to, userId],
      );
      await runner.query(`UPDATE ci.relationships SET strength = 0.5 WHERE relationship_id = $1::uuid`, [
        relationshipId,
      ]);
      await runner.query(`UPDATE ci.relationships SET is_active = FALSE WHERE relationship_id = $1::uuid`, [
        relationshipId,
      ]);
      await runner.query(`DELETE FROM ci.relationships WHERE relationship_id = $1::uuid`, [relationshipId]);

      const deltas = await deltasForRelationship(relationshipId);
      expect(deltas.map((row) => row.change_type).sort()).toEqual([
        'archived',
        'created',
        'deleted',
        'updated',
      ]);

      for (const delta of deltas) {
        // `_get_recently_changed_relationships` filters on node_type and
        // DISTINCT ONs the relationship_id, so both must be real on every row —
        // including the deletion, or every removed edge would collapse into one.
        expect(delta.node_type).toBe('relationship');
        expect(delta.relationship_id).toBe(relationshipId);
        expect(delta.relationship_type).toBe('KNOWS');
        expect(delta.from_entity_id).toBe(from);
        expect(delta.to_entity_id).toBe(to);
        expect(delta.entity_id).toBeNull();
        expect(delta.owner_user_id).toBe(userId);
      }

      const updated = deltas.find((row) => row.change_type === 'updated');
      expect(updated?.changed_fields.strength).toEqual({ old: 1, new: 0.5 });
    });

    // -----------------------------------------------------------------------
    // The consumer
    // -----------------------------------------------------------------------

    it('answers the query insight_aggregator.py actually runs', async () => {
      const entityId = await insertEntityRaw({ name: 'Visible To The Summary' });

      // `_get_graph_deltas`, verbatim apart from :named -> $n binding. If this
      // column list ever stops matching, the summary silently loses its "what
      // changed in your graph" section again — which is the failure this whole
      // change exists to end.
      const rows = (await runner.query(
        `SELECT
            delta_id,
            entity_id,
            relationship_id,
            node_type,
            entity_type,
            relationship_type,
            from_entity_id,
            to_entity_id,
            change_type,
            changed_fields,
            change_reason,
            changed_at
        FROM ci.graph_deltas
        WHERE owner_user_id = $1::uuid
          AND changed_at >= $2::timestamptz
          AND changed_at < $3::timestamptz
        ORDER BY changed_at DESC
        LIMIT 50`,
        [userId, new Date(Date.now() - 3_600_000), new Date(Date.now() + 3_600_000)],
      )) as DeltaRow[];

      const mine = rows.find((row) => row.entity_id === entityId);
      expect(mine).toBeDefined();
      // What the renderer prints: "- CREATED Person: Visible To The Summary".
      expect(mine?.change_type).toBe('created');
      expect(mine?.entity_type).toBe('Person');
      expect(mine?.changed_fields.name?.new).toBe('Visible To The Summary');

      // `has_new_data` gates whether insights are generated at all.
      const [gate] = (await runner.query(
        `SELECT EXISTS (
            SELECT 1 FROM ci.graph_deltas WHERE owner_user_id = $1::uuid AND changed_at >= $2::timestamptz
         ) AS has_new_data`,
        [userId, new Date(Date.now() - 3_600_000)],
      )) as Array<{ has_new_data: boolean }>;

      expect(gate.has_new_data).toBe(true);
    });

    it('writes rows the surviving read path can map', async () => {
      // DeltaService and DeltaEntity are untouched by this change — they are the
      // read path. This asserts the trigger's output still lands in the shape
      // the entity declares, column names and jsonb included.
      const entityId = await insertEntityRaw({ name: 'Read Path' });

      const [delta] = await runner.manager.getRepository(DeltaEntity).find({ where: { entityId } });

      expect(delta).toBeDefined();
      expect(delta.nodeType).toBe('entity');
      expect(delta.changeType).toBe('created');
      expect(delta.ownerUserId).toBe(userId);
      expect(delta.changeSource).toBe('db_trigger');
      expect(delta.changedFields.name).toEqual({ new: 'Read Path' });
      expect(delta.changedAt).toBeInstanceOf(Date);
      expect(DeltaEntity.toEgressType(delta).deltaId).toBe(delta.deltaId);
    });
  });
});
