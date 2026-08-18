import { randomUUID } from 'node:crypto';

import { DataSource } from 'typeorm';

import { databaseAvailability, resolveConnection } from '../../../__tests__/support/databaseConnection';
import { LifeContextService } from '../LifeContextService';

/**
 * LifeContextService's raw SQL, EXECUTED against the real schema.
 *
 * Both of this service's queries were broken, and every unit test passed
 * because they mock the DataSource — a mock cannot know that a column name is
 * wrong. Between them they named FIVE columns that do not exist:
 *
 *   hasNoveltySinceLastRun  gd.user_id, gd.created_at, c.created_at
 *   buildForUser            delta, user_id, created_at
 *
 * Postgres reports only the FIRST unknown column, so the errors masked each
 * other: correcting `gd.user_id` merely revealed `gd.created_at`. And because
 * `hasNoveltySinceLastRun` is called first by SmartRotationListener, it threw
 * before `buildForUser` was ever reached — hiding a second, entirely separate
 * broken query behind the first. The live appliance had dead-lettered
 * `smart.rotation.work` on `column gd.user_id does not exist` accordingly.
 *
 * Executing each query once with a random user id is enough: no row can match,
 * but Postgres validates columns, joins and casts long before it cares.
 */

const availability = databaseAvailability();
const describeWithDatabase = availability.available ? describe : describe.skip;

if (!availability.available) {
  console.warn(`[personalization/LifeContextService.integration] SKIPPED — ${availability.reason}`);
}

jest.setTimeout(60_000);

describeWithDatabase(`LifeContextService SQL agrees with the live schema (${availability.target})`, () => {
  let dataSource: DataSource;
  let service: LifeContextService;

  beforeAll(async () => {
    const connection = resolveConnection();

    if (connection == null) {
      throw new Error('databaseAvailability passed but no connection resolved');
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
    });
    await dataSource.initialize();

    // Only `dataSource` participates in the SQL under test. The collaborators
    // are stubbed rather than wired, so this stays a schema test and does not
    // quietly become an end-to-end personalization test.
    service = new LifeContextService(
      dataSource,
      {
        getUserContextForLLM: async () => null,
        formatContextForSystemPrompt: () => '',
      } as never,
      { getProfile: async () => ({ trustMode: 'balanced', insightVolumeMultiplier: 1 }) } as never,
      { countPending: async () => 0 } as never,
      {
        setContext: () => undefined,
        log: () => undefined,
        debug: () => undefined,
        error: () => undefined,
      } as never,
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  it('hasNoveltySinceLastRun executes — graph_deltas, communications and events all resolve', async () => {
    await expect(service.hasNoveltySinceLastRun(randomUUID(), 'insights')).resolves.toEqual(
      expect.any(Boolean),
    );
  });

  it('buildForUser executes — the graph-delta projection resolves', async () => {
    // The second query, which the first one's throw had been hiding.
    const context = await service.buildForUser(randomUUID());

    expect(Array.isArray(context.recentGraphDeltas)).toBe(true);
  });

  it('names only columns that ci.graph_deltas actually has', async () => {
    // A direct guard on the specific drift: `user_id`/`created_at`/`delta` are
    // the names the broken queries used, and none of them exist. If the schema
    // ever gains them this test should be revisited, not deleted.
    const rows = (await dataSource.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'ci' AND table_name = 'graph_deltas'`,
    )) as { column_name: string }[];
    const columns = new Set(rows.map((r) => r.column_name));

    expect(columns.has('owner_user_id')).toBe(true);
    expect(columns.has('changed_at')).toBe(true);
    expect(columns.has('user_id')).toBe(false);
    expect(columns.has('created_at')).toBe(false);
    expect(columns.has('delta')).toBe(false);
  });
});
