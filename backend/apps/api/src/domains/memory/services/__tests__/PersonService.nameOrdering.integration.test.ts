import { DataSource } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import type { UserServiceContext } from '@ci/common/context';
import type { LoggerService } from '@ci/common/logging';
import type { EventService } from '@ci/domains/events';

import { createSyntheticTestUser } from '../../../__tests__/support/applianceUser';
import { databaseAvailability, resolveConnection } from '../../../__tests__/support/databaseConnection';
import { acquireSchemaWriteLock, type SchemaLock } from '../../../__tests__/support/schemaLock';
import { BaseEntity } from '../../entities/BaseEntity';
import { PersonEntity } from '../../entities/PersonEntity';
import { PersonService } from '../PersonService';

/**
 * `findAll`'s default ordering, proved against a real Postgres.
 *
 * `PersonService.spec.ts` mocks the repository, so it cannot show what the
 * CASE expression in `findAll`'s ORDER BY actually does once Postgres
 * evaluates it — that is exactly the part a mock cannot check, because it
 * would just be re-stating the same regex in TypeScript and asserting it
 * agrees with itself.
 *
 * The bug this guards: a live import's People page opened on 30 straight rows
 * of "1003", "11112000", "+12013836559" — every real name in the table sorted
 * behind them, because plain `name ASC` puts digits ahead of letters. The
 * fix ranks a name that looks like a bare digit-string/phone-number or a
 * call-log-heading leftover ("Missed call from") behind anything else, without
 * changing what rows exist or what search finds.
 *
 * Opt-in in the same sense as the rest of the DB-backed suites: skips with a
 * clear reason when nothing is listening at `DATABASE_URL` /
 * `MEMORY_TEST_DATABASE_URL` / `DATABASE_HOST` + `DATABASE_PASSWORD`. A
 * developer running the normal dev stack (`docker compose up -d`, `.env`
 * populated) has this already; nothing extra to opt in for locally.
 */
const ENV = { urlEnvVar: 'MEMORY_TEST_DATABASE_URL' };
const availability = databaseAvailability(ENV);
const describeWithDb = availability.available ? describe : describe.skip;

if (!availability.available) {
   
  console.warn(`[PersonService.nameOrdering.integration] SKIPPED — ${availability.reason}`);
}

jest.setTimeout(60_000);

describeWithDb(`PersonService.findAll — plausible names before garbage (${availability.target})`, () => {
  let dataSource: DataSource;
  let schemaLock: SchemaLock | null = null;
  let service: PersonService;
  let userId: string;

  const send = jest.fn<Promise<string[]>, [string, Record<string, unknown>]>(async () => []);
  const noopLogger = {
    setContext: () => undefined,
    log: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  } as unknown as LoggerService;

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
      entities: [BaseEntity, PersonEntity],
      synchronize: false,
      extra: { options: '-c search_path=ci,public' },
    });

    await dataSource.initialize();

    // SHARED: this suite commits real ci.entities / ci.users rows, which a
    // migration suite may be altering inside its own transaction. See
    // domains/__tests__/support/schemaLock.ts.
    schemaLock = await acquireSchemaWriteLock(dataSource, 'PersonService.nameOrdering');

    userId = await createSyntheticTestUser(
      (sql, params) => dataSource.query(sql, params),
      'PersonService-nameOrdering',
    );

    service = new PersonService(dataSource.getRepository(PersonEntity), noopLogger, {
      send,
    } as unknown as EventService);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query('DELETE FROM ci.entities WHERE owner_user_id = $1', [userId]);
      await dataSource.query('DELETE FROM ci.users WHERE id = $1', [userId]);
      // Before destroy(): the lock is held on a runner from this pool.
      await schemaLock?.release();
      await dataSource.destroy();
    }
  });

  it('ranks a plausible human name above digit-strings, phone numbers, and call-log headings', async () => {
    const repo = dataSource.getRepository(PersonEntity);

    // Deliberately out of every order (name, insertion, id) the query could
    // fall back to by accident, so a passing assertion means the CASE rank is
    // actually doing the work.
    const rows: Array<{ name: string | null; label: string }> = [
      { name: 'Missed call from\n', label: 'call-log heading' },
      { name: 'Bob Jones', label: 'real name (B)' },
      { name: '+12013836559', label: 'phone number' },
      { name: null, label: 'no name at all' },
      { name: '1003', label: 'bare digit string' },
      { name: 'Alice Smith', label: 'real name (A)' },
    ];

    for (const row of rows) {
      await repo.save(repo.create({ id: uuidv7(), name: row.name, userId, properties: {} }));
    }

    const result = await service.findAll({ userId } as UserServiceContext);
    const names = result.map((p) => p.name);

    // The two real names lead, alphabetically — untouched by the new rank,
    // since both fall in the same (plausible) tier.
    expect(names.slice(0, 2)).toEqual(['Alice Smith', 'Bob Jones']);

    // Every garbage-tier name sorts behind both real names.
    const garbageNames = new Set(['+12013836559', '1003', 'Missed call from\n']);
    expect(new Set(names.slice(2, 5))).toEqual(garbageNames);

    // A row with no name at all still sorts dead last, same as before this
    // change (NULLS LAST on the existing secondary key).
    expect(names[5]).toBeNull();
  });
});
