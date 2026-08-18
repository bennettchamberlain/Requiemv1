import { randomUUID } from 'node:crypto';

import { DataSource } from 'typeorm';

import { databaseAvailability, resolveConnection } from '../../../__tests__/support/databaseConnection';
import type { UserDataArchive } from '../../types';
import { UserDataPortabilityService } from '../UserDataPortabilityService';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DOES THE ROLLBACK ACTUALLY ROLL BACK, AGAINST A REAL POSTGRES.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `importArchive`/`importNdjsonStream` run a transactional
 * delete-every-discovered-table-then-restore-from-archive across a user's
 * entire personal database. The unit tests (UserDataPortabilityService.test.ts)
 * pin the SERVICE's call sequence with a mocked QueryRunner — commit only on
 * success, rollback and rethrow on failure, delete-before-insert. What a mock
 * cannot prove is the thing that actually matters in production: that
 * `queryRunner.rollbackTransaction()` genuinely undoes the delete on a real
 * connection. A mock's `rollbackTransaction` is a no-op jest.fn(); this test
 * is the one place that calls the real one and then reads the table back.
 *
 * Every discovered table also gets deleted-for-this-user once as a side
 * effect of running `importArchive` at all (discoverUserTables enumerates
 * every ci/ci_search/hbpe table with a user_id/owner_user_id column, and the
 * service deletes across ALL of them, not just the ones under test) — for a
 * disposable user id with zero rows anywhere else, every one of those is a
 * real no-op DELETE against the live schema, incidentally proving the
 * dynamically-quoted `"${schema}"."${table}"` SQL is valid for the whole
 * table set, the same class of drift CrossTableHydrationService's
 * integration spec exists to catch in personalization's hand-written SQL.
 */

const PORTABILITY_DATABASE_ENV = {
  urlEnvVar: 'PORTABILITY_TEST_DATABASE_URL',
  probeTimeoutEnvVar: 'PORTABILITY_TEST_PROBE_TIMEOUT_MS',
};

const availability = databaseAvailability(PORTABILITY_DATABASE_ENV);
const describeWithDatabase = availability.available ? describe : describe.skip;

if (!availability.available) {
  console.warn(`[portability/UserDataPortabilityService.integration] SKIPPED — ${availability.reason}`);
}

jest.setTimeout(120_000);

describeWithDatabase(`UserDataPortabilityService transaction boundary against a live Postgres (${availability.target})`, () => {
  let dataSource: DataSource;
  let service: UserDataPortabilityService;

  const testUserId = randomUUID();
  const noopServices = {
    fileService: { getFileContent: jest.fn(), putObject: jest.fn() },
    userService: { findById: jest.fn() },
    logger: {
      setContext: () => undefined,
      log: () => undefined,
      warn: () => undefined,
      debug: () => undefined,
      error: () => undefined,
    },
  };

  const notesFor = async (): Promise<Array<{ id: string; title: string }>> =>
    dataSource.query('SELECT id, title FROM ci.notes WHERE user_id = $1::uuid ORDER BY title', [testUserId]);

  beforeAll(async () => {
    const connection = resolveConnection(PORTABILITY_DATABASE_ENV);

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

    service = new UserDataPortabilityService(
      dataSource,
      noopServices.fileService as never,
      noopServices.userService as never,
      noopServices.logger as never,
    );

    // A disposable user, invented for this file alone: `ci.notes.user_id`
    // has an FK into `ci.users`, so the seeded rows below need a real parent.
    await dataSource.query('INSERT INTO ci.users (id) VALUES ($1::uuid)', [testUserId]);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query('DELETE FROM ci.notes WHERE user_id = $1::uuid', [testUserId]);
      await dataSource.query('DELETE FROM ci.users WHERE id = $1::uuid', [testUserId]);
      await dataSource.destroy();
    }
  });

  afterEach(async () => {
    await dataSource.query('DELETE FROM ci.notes WHERE user_id = $1::uuid', [testUserId]);
  });

  it('commits: delete-then-restore leaves exactly the archived rows behind, nothing stale', async () => {
    const staleId = randomUUID();
    await dataSource.query('INSERT INTO ci.notes (id, title, user_id) VALUES ($1::uuid, $2, $3::uuid)', [
      staleId,
      'stale-before-import',
      testUserId,
    ]);

    const freshId = randomUUID();
    const archive: UserDataArchive = {
      version: 1,
      exportedAt: new Date().toISOString(),
      userId: testUserId,
      profile: null,
      tables: { 'ci.notes': [{ id: freshId, title: 'from-archive', user_id: testUserId }] },
      fileBlobs: [],
    };

    const result = await service.importArchive({ userId: testUserId } as never, archive);

    expect(result.rowsImported).toBeGreaterThanOrEqual(1);

    const rows = await notesFor();
    // The pre-existing row is gone (delete ran) and only the archived row
    // survives (insert ran) — not both, which is what "delete-then-restore"
    // promises and a delete-without-a-matching-insert-scope would break.
    expect(rows).toEqual([{ id: freshId, title: 'from-archive' }]);
  });

  it('rolls back a failed import, leaving the pre-existing row exactly as it was', async () => {
    const keptId = randomUUID();
    await dataSource.query('INSERT INTO ci.notes (id, title, user_id) VALUES ($1::uuid, $2, $3::uuid)', [
      keptId,
      'kept',
      testUserId,
    ]);

    // Two archive rows share the same id: the delete phase removes the
    // pre-existing row, the first insert re-adds a row at that id, and the
    // SECOND insert at the same id hits `notes_pkey` — a real constraint
    // violation partway through the restore, not a simulated one.
    const archive: UserDataArchive = {
      version: 1,
      exportedAt: new Date().toISOString(),
      userId: testUserId,
      profile: null,
      tables: {
        'ci.notes': [
          { id: keptId, title: 'replacement', user_id: testUserId },
          { id: keptId, title: 'duplicate-id-forces-a-real-pg-error', user_id: testUserId },
        ],
      },
      fileBlobs: [],
    };

    await expect(service.importArchive({ userId: testUserId } as never, archive)).rejects.toThrow();

    const rows = await notesFor();

    // If rollback genuinely ran, the ORIGINAL row survives untouched. If it
    // silently didn't — delete committed, insert half-failed, nothing
    // undone — the table would be empty or hold "replacement" instead. This
    // is the exact failure mode the audit flags as the largest data-loss
    // surface in the slice.
    expect(rows).toEqual([{ id: keptId, title: 'kept' }]);
  });

  it('importNdjsonStream — the actual streaming production path — restores rows via the same real transaction', async () => {
    // importArchive above is the "legacy single-json export for small
    // accounts and tests" (see its own doc comment); importNdjsonStream is
    // what real exports/imports use. Both funnel through the same
    // setReplicationRole → delete → insert sequence, but only running this
    // one through a real Postgres proves the streaming entry point wires up
    // to that sequence correctly too, not just its legacy sibling.
    noopServices.userService.findById = jest.fn().mockResolvedValue({ email: 'jane@example.com' });

    const freshId = randomUUID();
    const lines = [
      {
        type: 'manifest',
        version: 1,
        format: 'ndjson',
        exportedAt: new Date().toISOString(),
        userId: testUserId,
        profile: null,
      },
      { type: 'row', table: 'ci.notes', row: { id: freshId, title: 'from-ndjson-stream', user_id: testUserId } },
    ];
    const text = `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`;
    const req = {
      setEncoding: () => undefined,
       
      [Symbol.asyncIterator]: async function* () {
        yield text;
      },
    } as never;

    const result = await service.importNdjsonStream({ userId: testUserId } as never, req, 'jane@example.com');

    expect(result.rowsImported).toBeGreaterThanOrEqual(1);

    const rows = await notesFor();
    expect(rows).toEqual([{ id: freshId, title: 'from-ndjson-stream' }]);
  });
});
