import { readFileSync } from 'node:fs';
import path from 'node:path';

import { DataSource, type QueryRunner } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { createSyntheticTestUser } from '../../../__tests__/support/applianceUser';
import { databaseAvailability, resolveConnection } from '../../../__tests__/support/databaseConnection';
import { acquireSchemaWriteLock, type SchemaLock } from '../../../__tests__/support/schemaLock';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE NON-PLACE-NAME BACKFILL (20260818235752), AGAINST REAL POSTGRES.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The sequel to 20260818212254 (bare coordinate pairs), covering the two
 * classes that migration's predicate could not see:
 *
 *  - a MEDIA FILENAME — 2,085 rows on a real appliance, because `titleFor`
 *    gives a GPS-bearing photo its filename as a display title and
 *    `toPositionInput` read that title as the position's NAME;
 *  - a LABELLED COORDINATE PAIR — `isCoordinateText` was anchored
 *    `^\s*[-+]?\d`, so `Location 33.51469, -117.72169` (google_location,
 *    kmlgx, nmea) sailed straight through.
 *
 * Proved the same way its predecessor is: the real migration file applied
 * inside a transaction that always rolls back.
 *
 * The fixtures deliberately include the NEGATIVE cases the arms must never
 * touch — a real place name containing digits or a dot, a bare coordinate pair
 * (already cleared by 20260818212254, so this migration must be a no-op on it
 * and the two must stay disjoint), and a `name` already NULL.
 */

const availability = databaseAvailability();
const describeWithDatabase = availability.available ? describe : describe.skip;

if (!availability.available) {
  console.warn(`[pipeline/backfillPositionNonPlaceNames.integration] SKIPPED — ${availability.reason}`);
}

jest.setTimeout(60_000);

/** The migration's `-- migrate:up` half, applied inside the test transaction. */
function migrationUp(): string {
  const file = path.resolve(
    __dirname,
    '../../../../../db/postgres/migrations/20260818235752_backfill_position_non_place_names.sql',
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
  `backfill_position_non_place_names against real Postgres (${availability.target})`,
  () => {
    let dataSource: DataSource;
    let runner: QueryRunner;
    let schemaLock: SchemaLock | null = null;
    let ownerUserId: string;

    // One id per fixture row, named for what the fixture proves.
    const jpegId = uuidv7();
    const uppercaseJpgId = uuidv7();
    const movWithUuidStemId = uuidv7();
    const filenameWithSpaceId = uuidv7();
    const bareUuidStemId = uuidv7();
    const labelledCoordinateId = uuidv7();
    const labelledCoordinateNoSpaceId = uuidv7();
    const gpsLabelId = uuidv7();
    const bareCoordinateId = uuidv7();
    const numericPlaceNameId = uuidv7();
    const dottedPlaceNameId = uuidv7();
    const addressPlaceNameId = uuidv7();
    const waypointNameId = uuidv7();
    const alreadyNullId = uuidv7();

    const allIds = [
      jpegId,
      uppercaseJpgId,
      movWithUuidStemId,
      filenameWithSpaceId,
      bareUuidStemId,
      labelledCoordinateId,
      labelledCoordinateNoSpaceId,
      gpsLabelId,
      bareCoordinateId,
      numericPlaceNameId,
      dottedPlaceNameId,
      addressPlaceNameId,
      waypointNameId,
      alreadyNullId,
    ];

    function q<T>(text: string, params?: unknown[]): Promise<T> {
      return runner.query(text, params) as Promise<T>;
    }

    /** Seeds one ci.position row at a unique `time` (the table's PK is `(time, user_id)`). */
    async function seedPosition(args: {
      id: string;
      minuteOffset: number;
      name: string | null;
    }): Promise<void> {
      const time = new Date(`2026-08-11T09:${String(args.minuteOffset).padStart(2, '0')}:00.000Z`);

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
          'backfillPositionNonPlaceNames.integration ran with no database configured; the gate broke.',
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

      // SHARED: pure DML (a single UPDATE against ci.position, no ALTER/CREATE),
      // so it only needs to coexist with other writers, not exclude them.
      schemaLock = await acquireSchemaWriteLock(dataSource, 'backfillPositionNonPlaceNames');

      runner = dataSource.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();

      ownerUserId = await createSyntheticTestUser(
        (sql, params) => q(sql, params),
        'BackfillPositionNonPlaceNames',
      );

      await seedPosition({ id: jpegId, minuteOffset: 0, name: '20140710_170940.jpg' });
      await seedPosition({ id: uppercaseJpgId, minuteOffset: 1, name: 'IMG_0139.JPG' });
      await seedPosition({
        id: movWithUuidStemId,
        minuteOffset: 2,
        name: 'A20CEAAC-8F30-403E-A17B-E60DBC744DBB_3.mov',
      });
      await seedPosition({ id: filenameWithSpaceId, minuteOffset: 3, name: '2015-01-27 16.56.57.jpg' });
      await seedPosition({
        id: bareUuidStemId,
        minuteOffset: 4,
        name: 'A20CEAAC-8F30-403E-A17B-E60DBC744DBB',
      });
      await seedPosition({
        id: labelledCoordinateId,
        minuteOffset: 5,
        name: 'Location 33.51469, -117.72169',
      });
      await seedPosition({
        id: labelledCoordinateNoSpaceId,
        minuteOffset: 6,
        name: 'Location 12.34000,56.78000',
      });
      await seedPosition({ id: gpsLabelId, minuteOffset: 7, name: 'GPS 12.34, 56.78' });
      await seedPosition({ id: bareCoordinateId, minuteOffset: 8, name: '33.51469, -117.72169' });
      await seedPosition({ id: numericPlaceNameId, minuteOffset: 9, name: 'Cafe 40.7, 74.0' });
      await seedPosition({ id: dottedPlaceNameId, minuteOffset: 10, name: 'A.G. Bartlett Building' });
      await seedPosition({
        id: addressPlaceNameId,
        minuteOffset: 11,
        name: '75 Amherst St, Cambridge, MA 02139, USA',
      });
      await seedPosition({ id: waypointNameId, minuteOffset: 12, name: 'Summit' });
      await seedPosition({ id: alreadyNullId, minuteOffset: 13, name: null });

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

    it('clears a lowercase media filename', async () => {
      expect(await nameOf(jpegId)).toBeNull();
    });

    it('clears an uppercase media extension', async () => {
      expect(await nameOf(uppercaseJpgId)).toBeNull();
    });

    it('clears a UUID-stemmed video filename — the shape the defect report named', async () => {
      expect(await nameOf(movWithUuidStemId)).toBeNull();
    });

    it('clears a media filename that contains a space', async () => {
      // '2015-01-27 16.56.57.jpg' — the one whitespace-bearing filename in the
      // live corpus, still a filename and not a place.
      expect(await nameOf(filenameWithSpaceId)).toBeNull();
    });

    it('clears a bare UUID stem with no extension', async () => {
      expect(await nameOf(bareUuidStemId)).toBeNull();
    });

    it('clears a labelled coordinate pair — the variant the previous predicate could not see', async () => {
      expect(await nameOf(labelledCoordinateId)).toBeNull();
    });

    it('clears the comma-only labelled pair kmlgx emitted', async () => {
      expect(await nameOf(labelledCoordinateNoSpaceId)).toBeNull();
    });

    it('clears the pair behind any generic geo noun, not just "Location"', async () => {
      expect(await nameOf(gpsLabelId)).toBeNull();
    });

    it('leaves a BARE coordinate pair to 20260818212254 — the two are disjoint', async () => {
      // Not a regression: on a real appliance the earlier migration has already
      // run and this row does not exist. Asserting it here is what proves the
      // coordinate arm REQUIRES its label and cannot double-claim that class.
      expect(await nameOf(bareCoordinateId)).toBe('33.51469, -117.72169');
    });

    it('keeps a real place name that merely contains digits', async () => {
      expect(await nameOf(numericPlaceNameId)).toBe('Cafe 40.7, 74.0');
    });

    it('keeps a real place name containing dots — not every dot is a file extension', async () => {
      expect(await nameOf(dottedPlaceNameId)).toBe('A.G. Bartlett Building');
    });

    it('keeps a street address', async () => {
      expect(await nameOf(addressPlaceNameId)).toBe('75 Amherst St, Cambridge, MA 02139, USA');
    });

    it('keeps a genuine waypoint name', async () => {
      expect(await nameOf(waypointNameId)).toBe('Summit');
    });

    it('leaves an already-NULL name untouched', async () => {
      expect(await nameOf(alreadyNullId)).toBeNull();
    });

    it('is idempotent — running it again clears nothing further and errors on nothing', async () => {
      const before = await q<Array<{ name: string | null }>>(
        `SELECT name FROM ci.position WHERE id = ANY($1::uuid[]) ORDER BY id`,
        [allIds],
      );

      await runner.query(migrationUp());

      const after = await q<Array<{ name: string | null }>>(
        `SELECT name FROM ci.position WHERE id = ANY($1::uuid[]) ORDER BY id`,
        [allIds],
      );

      expect(after).toEqual(before);
    });
  },
);
