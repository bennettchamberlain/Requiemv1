import { readFileSync } from 'node:fs';
import path from 'node:path';

import { DataSource, type QueryRunner } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { createSyntheticTestUser } from '../../../__tests__/support/applianceUser';
import { databaseAvailability, resolveConnection } from '../../../__tests__/support/databaseConnection';
import { acquireSchemaWriteLock, type SchemaLock } from '../../../__tests__/support/schemaLock';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE POSITION-NAME BACKFILL (20260818212254), AGAINST REAL POSTGRES.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ffe607646 ("a coordinate pair is not a place name") stopped a NEW import
 * from writing a bare "lat, lng" string into `ci.position.name` — google_fit
 * titles a trackpoint with its own coordinates when it has no waypoint name.
 * This migration is the one-time recovery for rows that already landed under
 * the old behaviour. Pure DML with no application-code counterpart, proved
 * here the same way `backfillCaptureContentRows.integration.spec.ts` proves
 * 20260818174213: applied for real, inside a transaction that always rolls
 * back.
 *
 * Fixtures cover the branches that matter:
 *  - a `name` that IS exactly a coordinate pair (with and without a leading
 *    sign / decimal, the shapes `isCoordinateText` in
 *    `import/push/inputs.ts` accepts) — cleared;
 *  - a real place name that merely CONTAINS digits ("Cafe 40.7, 74.0", a
 *    street address) — untouched, matching `isCoordinateText`'s own test in
 *    `inputs.test.ts`;
 *  - a genuine waypoint name ("Summit") — untouched;
 *  - a `name` already NULL — untouched, and proves the migration is
 *    idempotent rather than merely happening not to double-clear on a second
 *    run;
 *  - a media-filename-shaped `name` — the separate, out-of-scope bug the
 *    migration's own header says it does not touch — untouched.
 */

const availability = databaseAvailability();
const describeWithDatabase = availability.available ? describe : describe.skip;

if (!availability.available) {
  console.warn(`[pipeline/backfillPositionCoordinateNames.integration] SKIPPED — ${availability.reason}`);
}

jest.setTimeout(60_000);

/** The migration's `-- migrate:up` half, applied inside the test transaction. */
function migrationUp(): string {
  const file = path.resolve(
    __dirname,
    '../../../../../db/postgres/migrations/20260818212254_backfill_position_coordinate_names.sql',
  );

  const sql = readFileSync(file, 'utf8');
  const start = sql.indexOf('-- migrate:up');
  const end = sql.indexOf('-- migrate:down');

  if (start < 0 || end < 0) {
    throw new Error(`${file} has no migrate:up / migrate:down markers.`);
  }

  return sql.slice(start + '-- migrate:up'.length, end);
}

describeWithDatabase(
  `backfill_position_coordinate_names against real Postgres (${availability.target})`,
  () => {
    let dataSource: DataSource;
    let runner: QueryRunner;
    let schemaLock: SchemaLock | null = null;
    let ownerUserId: string;

    // One id per fixture row, named for what the fixture proves.
    const bareCoordinateId = uuidv7();
    const signedCoordinateId = uuidv7();
    const integerCoordinateId = uuidv7();
    const numericPlaceNameId = uuidv7();
    const waypointNameId = uuidv7();
    const alreadyNullId = uuidv7();
    const mediaFilenameId = uuidv7();

    function q<T>(text: string, params?: unknown[]): Promise<T> {
      return runner.query(text, params) as Promise<T>;
    }

    /** Seeds one ci.position row at a unique `time` (the table's PK is `(time, user_id)`). */
    async function seedPosition(args: {
      id: string;
      minuteOffset: number;
      name: string | null;
    }): Promise<void> {
      const time = new Date(`2026-08-10T14:${String(args.minuteOffset).padStart(2, '0')}:00.000Z`);

      await q(
        `INSERT INTO ci.position (time, user_id, id, location, name, source)
         VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, $6, 'gps')`,
        [time, ownerUserId, args.id, -117.7217, 33.5147, args.name],
      );
    }

    beforeAll(async () => {
      const connection = resolveConnection();

      if (connection == null) {
        throw new Error(
          'backfillPositionCoordinateNames.integration ran with no database configured; the gate broke.',
        );
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
        entities: [],
        synchronize: false,
        logging: false,
        extra: { max: 2 },
      });

      await dataSource.initialize();

      // SHARED: this migration is pure DML (a single UPDATE against ci.position,
      // no ALTER/CREATE), so it only needs to coexist with other writers, not
      // exclude them. See domains/__tests__/support/schemaLock.ts.
      schemaLock = await acquireSchemaWriteLock(dataSource, 'backfillPositionCoordinateNames');

      runner = dataSource.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();

      ownerUserId = await createSyntheticTestUser(
        (sql, params) => q(sql, params),
        'BackfillPositionCoordinateNames',
      );

      await seedPosition({ id: bareCoordinateId, minuteOffset: 0, name: '33.51469, -117.72169' });
      await seedPosition({ id: signedCoordinateId, minuteOffset: 1, name: '-33.51469, +117.72169' });
      await seedPosition({ id: integerCoordinateId, minuteOffset: 2, name: '33, -117' });
      await seedPosition({ id: numericPlaceNameId, minuteOffset: 3, name: 'Cafe 40.7, 74.0' });
      await seedPosition({ id: waypointNameId, minuteOffset: 4, name: 'Summit' });
      await seedPosition({ id: alreadyNullId, minuteOffset: 5, name: null });
      await seedPosition({
        id: mediaFilenameId,
        minuteOffset: 6,
        name: '07683A42-19ED-4074-828E-95C3902C2F07_3.mov',
      });

      // The migration itself, applied HERE inside the transaction that always
      // rolls back — the real file, not a copy that could drift.
      await runner.query(migrationUp());
    });

    afterAll(async () => {
      if (runner != null) {
        // ALWAYS. The fixtures and everything the migration wrote disappear
        // with this line — nothing here is left for the real appliance to trip
        // over.
        await runner.rollbackTransaction();
        await runner.release();
      }

      await schemaLock?.release();

      if (dataSource?.isInitialized) {
        await dataSource.destroy();
      }
    });

    async function nameOf(id: string): Promise<string | null> {
      const [row] = await q<Array<{ name: string | null }>>(`SELECT name FROM ci.position WHERE id = $1`, [
        id,
      ]);

      return row.name;
    }

    it('clears a bare coordinate pair', async () => {
      expect(await nameOf(bareCoordinateId)).toBeNull();
    });

    it('clears a signed coordinate pair', async () => {
      expect(await nameOf(signedCoordinateId)).toBeNull();
    });

    it('clears a coordinate pair with no decimal part', async () => {
      expect(await nameOf(integerCoordinateId)).toBeNull();
    });

    it('keeps a real place name that merely contains digits', async () => {
      expect(await nameOf(numericPlaceNameId)).toBe('Cafe 40.7, 74.0');
    });

    it('keeps a genuine waypoint name', async () => {
      expect(await nameOf(waypointNameId)).toBe('Summit');
    });

    it('leaves an already-NULL name untouched', async () => {
      expect(await nameOf(alreadyNullId)).toBeNull();
    });

    it('does not touch a media-filename-shaped name — a different, out-of-scope bug', async () => {
      expect(await nameOf(mediaFilenameId)).toBe('07683A42-19ED-4074-828E-95C3902C2F07_3.mov');
    });

    it('is idempotent — running it again clears nothing further and errors on nothing', async () => {
      const before = await q<Array<{ name: string | null }>>(
        `SELECT name FROM ci.position WHERE id = ANY($1::uuid[]) ORDER BY id`,
        [
          [
            bareCoordinateId,
            signedCoordinateId,
            integerCoordinateId,
            numericPlaceNameId,
            waypointNameId,
            alreadyNullId,
            mediaFilenameId,
          ],
        ],
      );

      await runner.query(migrationUp());

      const after = await q<Array<{ name: string | null }>>(
        `SELECT name FROM ci.position WHERE id = ANY($1::uuid[]) ORDER BY id`,
        [
          [
            bareCoordinateId,
            signedCoordinateId,
            integerCoordinateId,
            numericPlaceNameId,
            waypointNameId,
            alreadyNullId,
            mediaFilenameId,
          ],
        ],
      );

      expect(after).toEqual(before);
    });
  },
);
