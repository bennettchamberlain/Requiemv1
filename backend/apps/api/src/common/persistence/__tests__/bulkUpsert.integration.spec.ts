import { randomUUID } from 'node:crypto';

import { DataSource } from 'typeorm';

import { ContentEntity } from '@ci/domains/memory';
import { UserEntity } from '@ci/domains/user';

import { databaseAvailability, resolveConnection } from '../../../domains/__tests__/support/databaseConnection';
import { EventEntity } from '../../../domains/memory/entities/EventEntity';
import { bulkInsertIdempotent } from '../bulkUpsert';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * `inserted`, AGAINST A REAL RETURNING CLAUSE.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The unit tests could not have caught the bug this guards, and it is worth
 * being precise about why.
 *
 * The helper built its RETURNING clause with `.returning([databaseName])`.
 * TypeORM's ARRAY form takes PROPERTY names and silently discards anything it
 * cannot resolve, falling back to its own default set — so for every entity
 * whose column differs from its property the primary key was simply absent from
 * the returned rows, `insertedPks` stayed empty, and NOTHING was ever reported
 * as inserted. `ci.events` keys on `event_id` and `ci.objects` on `object_id`;
 * `ci.content` keys on `id`, where property and column coincide, so it worked
 * and hid the rest.
 *
 * The fake repository in bulkUpsert.test.ts declares `primaryColumns:
 * [{ databaseName: 'id' }]` and implements `returning` as `() => iqb` — it
 * ignores the argument entirely. Every entity in that suite is the case that
 * happened to work, and the one call that mattered was a no-op. Only a real
 * driver disagrees.
 *
 * So these two cases are deliberately paired: an entity whose pk column differs
 * from its property, and one where they match.
 */

const ENV = {
  urlEnvVar: 'IMPORT_TEST_DATABASE_URL',
  probeTimeoutEnvVar: 'IMPORT_TEST_PROBE_TIMEOUT_MS',
};

const availability = databaseAvailability(ENV);
const describeWithDatabase = availability.available ? describe : describe.skip;

if (!availability.available) {
  console.warn(`[persistence/bulkUpsert.integration] SKIPPED — ${availability.reason}`);
}

jest.setTimeout(60_000);

describeWithDatabase(`bulkInsertIdempotent against real Postgres (${availability.target})`, () => {
  let dataSource: DataSource;
  const userId = randomUUID();

  beforeAll(async () => {
    const connection = resolveConnection(ENV);

    if (connection == null) {
      throw new Error('availability said yes but no connection resolved');
    }

    dataSource = new DataSource({
      type: 'postgres',
      ...(connection.url != null
        ? { url: connection.url }
        : {
            host: connection.host,
            port: connection.port,
            username: connection.username,
            password: connection.password,
            database: connection.database,
          }),
      entities: [EventEntity, ContentEntity, UserEntity],
      synchronize: false,
      extra: { options: '-c search_path=ci,public' },
    });

    await dataSource.initialize();

    await dataSource.query(
      `INSERT INTO ci.users (id, name, email) VALUES ($1::uuid, 'bulkUpsert spec', $2)
       ON CONFLICT (id) DO NOTHING`,
      [userId, `bulk-upsert-${userId}@example.invalid`],
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DELETE FROM ci.events WHERE user_id = $1::uuid`, [userId]);
      await dataSource.query(`DELETE FROM ci.content WHERE user_id = $1::uuid`, [userId]);
      await dataSource.query(`DELETE FROM ci.users WHERE id = $1::uuid`, [userId]);
      await dataSource.destroy();
    }
  });

  /** The provenance triple both tables dedupe on. */
  function triple(entity: { sourceType?: string | null; sourceSystem?: string | null; sourceId?: string | null }) {
    return {
      sourceType: entity.sourceType,
      sourceSystem: entity.sourceSystem,
      sourceId: entity.sourceId,
    };
  }

  async function insertEvent(sourceId: string) {
    const repository = dataSource.getRepository(EventEntity);

    return bulkInsertIdempotent({
      repository,
      entities: [
        repository.create({
          id: randomUUID(),
          userId,
          title: 'bulk upsert spec',
          eventType: 'spec',
          startTime: new Date(),
          sourceType: 'spec',
          sourceSystem: 'spec',
          sourceId,
        }),
      ],
      primaryKey: 'id',
      getTriple: triple,
      scope: { userId },
      conflictTarget: '(user_id, source_type, source_system, source_id) WHERE source_id IS NOT NULL',
      tripleColumns: ['source_type', 'source_system', 'source_id'],
      conflictUpdateColumns: [],
    });
  }

  async function insertContent(sourceId: string) {
    const repository = dataSource.getRepository(ContentEntity);

    return bulkInsertIdempotent({
      repository,
      entities: [
        repository.create({
          id: randomUUID(),
          userId,
          type: 'spec',
          title: 'bulk upsert spec',
          sourceType: 'spec',
          sourceSystem: 'spec',
          sourceId,
        }),
      ],
      primaryKey: 'id',
      getTriple: triple,
      scope: { userId },
      conflictTarget: '(user_id, source_type, source_system, source_id) WHERE source_id IS NOT NULL',
      tripleColumns: ['source_type', 'source_system', 'source_id'],
      conflictUpdateColumns: [],
    });
  }

  it('reports inserted for an entity whose pk COLUMN differs from its property', async () => {
    // ci.events: property `id`, column `event_id`. This returned false on a
    // genuine first write, which made the importer report zero events written
    // on a run that wrote 7,656 of them.
    const sourceId = `spec-${randomUUID()}`;

    expect((await insertEvent(sourceId))[0].inserted).toBe(true);
  });

  it('reports NOT inserted when that same row is written again', async () => {
    const sourceId = `spec-${randomUUID()}`;

    await insertEvent(sourceId);

    expect((await insertEvent(sourceId))[0].inserted).toBe(false);
  });

  it('still reports correctly for an entity whose pk column and property match', async () => {
    // ci.content: property and column are both `id` — the case that worked, kept
    // as the control so a fix for one cannot silently break the other.
    const sourceId = `spec-${randomUUID()}`;

    expect((await insertContent(sourceId))[0].inserted).toBe(true);
    expect((await insertContent(sourceId))[0].inserted).toBe(false);
  });

  it('writes exactly one row for a repeated triple', async () => {
    // The flag must describe what the table actually holds.
    const sourceId = `spec-${randomUUID()}`;

    await insertEvent(sourceId);
    await insertEvent(sourceId);

    const [{ count }] = await dataSource.query<Array<{ count: string }>>(
      `SELECT count(*) AS count FROM ci.events WHERE user_id = $1::uuid AND source_id = $2`,
      [userId, sourceId],
    );

    expect(Number(count)).toBe(1);
  });
});
