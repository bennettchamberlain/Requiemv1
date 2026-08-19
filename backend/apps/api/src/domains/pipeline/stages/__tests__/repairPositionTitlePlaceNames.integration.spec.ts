import { readFileSync } from 'node:fs';
import path from 'node:path';

import { DataSource, type QueryRunner } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { createSyntheticTestUser } from '../../../__tests__/support/applianceUser';
import { databaseAvailability, resolveConnection } from '../../../__tests__/support/databaseConnection';
import { acquireSchemaWriteLock, type SchemaLock } from '../../../__tests__/support/schemaLock';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE TITLE-AS-PLACE-NAME REPAIR (20260819055246), AGAINST REAL POSTGRES.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The fifth upstream of `ci.position.name`, and the last of the four non-place
 * classes: a TITLE. `titleFor` gives every record a display label, and a record
 * reaches the position partition whenever it carries coordinates — so a
 * geotagged tweet donated its clipped body and an Uber leg with no recorded
 * address donated the ride narration. `promote.place_position` then minted a
 * Location entity per sentence and the Places list rendered it as a venue.
 *
 * Two halves, and the second is why this spec exists rather than reusing the
 * shape of its predecessor:
 *
 *  1. the names are nulled, exactly as 20260818212254 / 20260818235752 do;
 *  2. the Location entities minted FROM those names are deleted — and the
 *     deletion is scoped by a JOIN on the name, not by a predicate over
 *     `ci.entities.name` alone. `promote.place` mints legitimately long
 *     Locations out of ICS calendar `LOCATION` fields ('Mintz, Levin, Cohn,
 *     Ferris, Glovsky and Popeo, P.C., 3580 Carmel Mountain Road, Suite 300,
 *     San Diego, CA, us, 92130' is 19 words and a real place someone went to),
 *     and a name-only predicate matched 27 of them on a second appliance
 *     corpus. The negative fixture below is that exact row.
 *
 * Proved the way its predecessors are: the real migration file applied inside a
 * transaction that always rolls back.
 */

const availability = databaseAvailability();
const describeWithDatabase = availability.available ? describe : describe.skip;

if (!availability.available) {
  console.warn(`[pipeline/repairPositionTitlePlaceNames.integration] SKIPPED — ${availability.reason}`);
}

jest.setTimeout(60_000);

/** The migration's `-- migrate:up` half, applied inside the test transaction. */
function migrationUp(): string {
  const file = path.resolve(
    __dirname,
    '../../../../../db/postgres/migrations/20260819055246_repair_position_title_place_names.sql',
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
  `repair_position_title_place_names against real Postgres (${availability.target})`,
  () => {
    let dataSource: DataSource;
    let runner: QueryRunner;
    let schemaLock: SchemaLock | null = null;
    let ownerUserId: string;

    // One id per fixture row, named for what the fixture proves.
    const clippedTweetId = uuidv7();
    const bangSentenceId = uuidv7();
    const rideNarrationId = uuidv7();
    const longestRealPlaceId = uuidv7();
    const dottedPlaceNameId = uuidv7();
    const atSignPlaceNameId = uuidv7();
    const addressPlaceNameId = uuidv7();
    const alreadyNullId = uuidv7();

    const allIds = [
      clippedTweetId,
      bangSentenceId,
      rideNarrationId,
      longestRealPlaceId,
      dottedPlaceNameId,
      atSignPlaceNameId,
      addressPlaceNameId,
      alreadyNullId,
    ];

    // The two Location entities: one minted from the narration (must go), one a
    // legitimately wordy calendar place with no bad position behind it (must
    // stay). Ids are chosen here so the fixtures can wire the link.
    const narrationPlaceId = uuidv7();
    const wordyCalendarPlaceId = uuidv7();

    const NARRATION =
      'Uber ride from 110 E 30th St, Austin, TX 78705, US to 101 Red River St, Austin, TX 78701, US (request)';
    // 14 words / 90 characters — the longest genuine name on the corpus, and
    // LONGER than an 89-character narration, which is why the bound is in words.
    const LONGEST_REAL_PLACE =
      'Red Roof PLUS+ Boston - Framingham, 650 Cochituate Rd, Framingham, MA 01701, United States';
    const WORDY_CALENDAR_PLACE =
      'Mintz, Levin, Cohn, Ferris, Glovsky and Popeo, P.C., 3580 Carmel Mountain Road, Suite 300, San Diego, CA, us, 92130';

    function q<T>(text: string, params?: unknown[]): Promise<T> {
      return runner.query(text, params) as Promise<T>;
    }

    /** Seeds one ci.position row at a unique `time` (the table's PK is `(time, user_id)`). */
    async function seedPosition(args: {
      id: string;
      minuteOffset: number;
      name: string | null;
      locationEntityId?: string | null;
    }): Promise<void> {
      const time = new Date(`2026-08-12T09:${String(args.minuteOffset).padStart(2, '0')}:00.000Z`);

      await q(
        `INSERT INTO ci.position (time, user_id, id, location, name, source, location_entity_id)
         VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, $6, 'gps', $7)`,
        [time, ownerUserId, args.id, -117.7217, 33.5147, args.name, args.locationEntityId ?? null],
      );
    }

    async function seedPlace(entityId: string, name: string): Promise<void> {
      await q(
        `INSERT INTO ci.entities (entity_id, entity_type, name, owner_user_id) VALUES ($1, 'Location', $2, $3)`,
        [entityId, name, ownerUserId],
      );
    }

    beforeAll(async () => {
      const connection = resolveConnection();

      if (connection == null) {
        throw new Error(
          'repairPositionTitlePlaceNames.integration ran with no database configured; the gate broke.',
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

      // SHARED: pure DML (UPDATE/DELETE, no ALTER/CREATE), so it only needs to
      // coexist with other writers, not exclude them.
      schemaLock = await acquireSchemaWriteLock(dataSource, 'repairPositionTitlePlaceNames');

      runner = dataSource.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();

      ownerUserId = await createSyntheticTestUser(
        (sql, params) => q(sql, params),
        'RepairPositionTitlePlaceNames',
      );

      await seedPlace(narrationPlaceId, NARRATION);
      await seedPlace(wordyCalendarPlaceId, WORDY_CALENDAR_PLACE);

      await seedPosition({
        id: clippedTweetId,
        minuteOffset: 0,
        name: "Check out a replay of BitScoop Labs' first live stream! #BitScoop #APIs #Micros…",
      });
      // Short enough for the word bound and unpunctuated: the ellipsis alone has
      // to carry this one.
      await seedPosition({ id: bangSentenceId, minuteOffset: 1, name: 'Data Science Wizardry…' });
      await seedPosition({
        id: rideNarrationId,
        minuteOffset: 2,
        name: NARRATION,
        locationEntityId: narrationPlaceId,
      });
      await seedPosition({ id: longestRealPlaceId, minuteOffset: 3, name: LONGEST_REAL_PLACE });
      await seedPosition({ id: dottedPlaceNameId, minuteOffset: 4, name: 'A.G. Bartlett Building' });
      await seedPosition({
        id: atSignPlaceNameId,
        minuteOffset: 5,
        name: 'On Jane Stanford Way @ Gilbert Biological Sciences',
      });
      await seedPosition({
        id: addressPlaceNameId,
        minuteOffset: 6,
        name: '75 Amherst St, Cambridge, MA 02139, USA',
      });
      await seedPosition({ id: alreadyNullId, minuteOffset: 7, name: null });

      // The migration itself, applied HERE inside the transaction that always
      // rolls back — the real file, not a copy that could drift.
      await runner.query(migrationUp());
    });

    afterAll(async () => {
      if (runner != null) {
        // ALWAYS. The fixtures and everything the migration wrote disappear with
        // this line — nothing here is left for the real appliance to trip over.
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

    async function linkOf(id: string): Promise<string | null> {
      const [row] = await q<Array<{ location_entity_id: string | null }>>(
        `SELECT location_entity_id FROM ci.position WHERE id = $1`,
        [id],
      );

      return row.location_entity_id;
    }

    async function placeExists(entityId: string): Promise<boolean> {
      const rows = await q<Array<{ entity_id: string }>>(
        `SELECT entity_id FROM ci.entities WHERE entity_id = $1`,
        [entityId],
      );

      return rows.length === 1;
    }

    it('clears a clipped social-post body', async () => {
      expect(await nameOf(clippedTweetId)).toBeNull();
    });

    it('clears a short value carrying only the clip ellipsis', async () => {
      // No bang, 3 words — proof the ellipsis arm stands on its own rather than
      // riding along with the length arm.
      expect(await nameOf(bangSentenceId)).toBeNull();
    });

    it('clears a ride narration', async () => {
      expect(await nameOf(rideNarrationId)).toBeNull();
    });

    it('keeps the LONGEST genuine place name on the corpus — 14 words, 90 characters', async () => {
      // Longer in characters than the 89-character narration the word bound
      // catches, which is the whole reason the bound counts words.
      expect(await nameOf(longestRealPlaceId)).toBe(LONGEST_REAL_PLACE);
    });

    it('keeps a place name containing dots — a period is not sentence punctuation here', async () => {
      expect(await nameOf(dottedPlaceNameId)).toBe('A.G. Bartlett Building');
    });

    it('keeps a place name containing @', async () => {
      expect(await nameOf(atSignPlaceNameId)).toBe('On Jane Stanford Way @ Gilbert Biological Sciences');
    });

    it('keeps a street address', async () => {
      expect(await nameOf(addressPlaceNameId)).toBe('75 Amherst St, Cambridge, MA 02139, USA');
    });

    it('leaves an already-NULL name untouched', async () => {
      expect(await nameOf(alreadyNullId)).toBeNull();
    });

    it('deletes the Location entity minted out of the narration', async () => {
      expect(await placeExists(narrationPlaceId)).toBe(false);
    });

    it('detaches the fix from it — the FK is ON DELETE SET NULL', async () => {
      // Not merely cosmetic: `promote.edge_position` projects owner Person
      // −VISITED→ Place off `location_entity_id IS NOT NULL`, so a surviving link
      // keeps asserting a visit to a sentence.
      expect(await linkOf(rideNarrationId)).toBeNull();
    });

    it('keeps a legitimately WORDY calendar place that no bad position named', async () => {
      // 19 words. A predicate over ci.entities.name alone would delete this, and
      // 26 others like it on a real corpus. The join on the position's own name
      // is what makes the deletion provably about this bug.
      expect(await placeExists(wordyCalendarPlaceId)).toBe(true);
    });

    it('is idempotent — running it again changes nothing and errors on nothing', async () => {
      const before = await q<Array<{ name: string | null; location_entity_id: string | null }>>(
        `SELECT name, location_entity_id FROM ci.position WHERE id = ANY($1::uuid[]) ORDER BY id`,
        [allIds],
      );

      await runner.query(migrationUp());

      const after = await q<Array<{ name: string | null; location_entity_id: string | null }>>(
        `SELECT name, location_entity_id FROM ci.position WHERE id = ANY($1::uuid[]) ORDER BY id`,
        [allIds],
      );

      expect(after).toEqual(before);
      expect(await placeExists(wordyCalendarPlaceId)).toBe(true);
    });
  },
);
