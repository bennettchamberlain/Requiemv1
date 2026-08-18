import { randomUUID } from 'node:crypto';

import { DataSource } from 'typeorm';

import { UserEntity } from '@ci/domains/user';

import { syntheticTestUserEmail } from '../../../domains/__tests__/support/applianceUser';
import {
  databaseAvailability,
  resolveConnection,
} from '../../../domains/__tests__/support/databaseConnection';
import { acquireSchemaWriteLock, type SchemaLock } from '../../../domains/__tests__/support/schemaLock';
import { CommunicationEntity } from '../../../domains/memory/entities/CommunicationEntity';
import { keysetPaginate, type KeysetPageArgs } from '../keysetPaginate';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * `keysetPaginate` AGAINST REAL POSTGRES — THE PART `keysetPaginate.spec.ts`
 * NEVER TOUCHES.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `keysetPaginate.spec.ts` covers `resolvePageShape` — a pure function. The
 * async `keysetPaginate` itself (the cursor-not-found short-circuit, the
 * backward-pagination reverse plus hasNextPage/hasPreviousPage sentinel-row
 * math, and the `(time, id)` seek-predicate tie-break) had ZERO coverage
 * anywhere in the repo before this file — every consuming service
 * (ContentService, CommunicationService, BrowserActivityService) exercises it
 * only incidentally, if at all, in their own specs.
 *
 * That gap matters because none of this is expressible against a fake query
 * builder without re-deriving Postgres's own seek-predicate semantics in
 * TypeScript (which would just test the fake, not the SQL) — it needs a real
 * ORDER BY (time, id) DESC / LIMIT / seek-predicate round trip. A bug here
 * (an off-by-one in the sentinel slice, a `<` that should be `<=`, a tie-break
 * that silently drops the second row at an identical `time`) would silently
 * duplicate or drop rows across pages, or throw on a stale cursor, in every
 * paginated memory/communications/browser-activity list in production.
 *
 * `CommunicationEntity` is the vehicle: unlike `ContentEntity`/`EventEntity`,
 * its `time` column is a plain, directly-settable `@Column` (not a
 * `@CreateDateColumn`), so fixture rows can carry exact, controlled,
 * millisecond-apart (or deliberately IDENTICAL, for the tie-break case)
 * timestamps.
 */

const ENV = {
  urlEnvVar: 'PERSISTENCE_TEST_DATABASE_URL',
  probeTimeoutEnvVar: 'PERSISTENCE_TEST_PROBE_TIMEOUT_MS',
};

const availability = databaseAvailability(ENV);
const describeWithDatabase = availability.available ? describe : describe.skip;

if (!availability.available) {
  console.warn(`[persistence/keysetPaginate.integration] SKIPPED — ${availability.reason}`);
}

jest.setTimeout(60_000);

describeWithDatabase(`keysetPaginate against real Postgres (${availability.target})`, () => {
  let dataSource: DataSource;
  let schemaLock: SchemaLock | null = null;

  // One synthetic user PER SECTION below, not one shared across the whole
  // file: every `describe` block's fixtures live for the lifetime of the
  // suite (cleanup is a single `afterAll`, not per-block), so a shared user
  // id would let one section's rows bleed into another section's
  // `totalCount` and page contents depending on `describe` execution order.
  const forwardUserId = randomUUID();
  const backwardUserId = randomUUID();
  const cursorUserId = randomUUID();
  const tieUserId = randomUUID();
  const tenancyUserA = randomUUID();
  const tenancyUserB = randomUUID();
  const allUserIds = [forwardUserId, backwardUserId, cursorUserId, tieUserId, tenancyUserA, tenancyUserB];

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
      entities: [CommunicationEntity, UserEntity],
      synchronize: false,
      extra: { options: '-c search_path=ci,public' },
    });

    await dataSource.initialize();

    // SHARED: this suite commits real `ci.users` / `ci.entities` /
    // `ci.communications` rows — see `domains/__tests__/support/schemaLock.ts`.
    schemaLock = await acquireSchemaWriteLock(dataSource, 'keysetPaginate.integration');

    for (const id of allUserIds) {
      await dataSource.query(
        `INSERT INTO ci.users (id, name, email) VALUES ($1::uuid, 'keysetPaginate spec', $2)
         ON CONFLICT (id) DO NOTHING`,
        [id, syntheticTestUserEmail('keyset-paginate', id)],
      );
    }
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      // Independent steps, first error rethrown at the end — see
      // bulkUpsert.integration.spec.ts for why (a leaked `ci.users` row is
      // durable and invisible, and must not be skipped by an earlier failure).
      const failures: unknown[] = [];

      for (const [sql, params] of [
        [`DELETE FROM ci.communications WHERE user_id = ANY($1::uuid[])`, [allUserIds]],
        [`DELETE FROM ci.entities WHERE owner_user_id = ANY($1::uuid[])`, [allUserIds]],
        [`DELETE FROM ci.users WHERE id = ANY($1::uuid[])`, [allUserIds]],
      ] as Array<[string, unknown[]]>) {
        try {
          await dataSource.query(sql, params);
        } catch (err: unknown) {
          failures.push(err);
        }
      }

      await schemaLock?.release();
      await dataSource.destroy();

      if (failures.length > 0) {
        throw failures[0];
      }
    }
  });

  /** The CTI base row every ci.communications detail row requires (composite FK). */
  async function seedBase(id: string, owner: string): Promise<void> {
    await dataSource.query(
      `INSERT INTO ci.entities (entity_id, entity_type, owner_user_id, name)
            VALUES ($1::uuid, 'Communication', $2::uuid, 'keysetPaginate spec')
       ON CONFLICT (entity_id) DO NOTHING`,
      [id, owner],
    );
  }

  async function insertCommunication(owner: string, time: Date, id: string = randomUUID()): Promise<string> {
    await seedBase(id, owner);

    const repository = dataSource.getRepository(CommunicationEntity);
    await repository.save(
      repository.create({
        id,
        userId: owner,
        time,
        communicationType: 'chat',
        direction: 'inbound',
        content: 'keysetPaginate spec row',
        preview: 'keysetPaginate spec row',
        participantsMetadata: {},
        attachments: [],
      }),
    );

    return id;
  }

  function findPage(owner: string, args: KeysetPageArgs) {
    return keysetPaginate(dataSource.getRepository(CommunicationEntity), args, {
      alias: 'c',
      timeProp: 'time',
      userId: owner,
    });
  }

  const BASE_TIME = new Date('2024-01-01T00:00:00.000Z').getTime();
  /** Strictly increasing timestamps, one minute apart. */
  const timeAt = (i: number): Date => new Date(BASE_TIME + i * 60_000);

  describe('forward pagination (first / afterId)', () => {
    const ids: string[] = [];

    beforeAll(async () => {
      // ids[0..4] correspond to timeAt(0..4), i.e. OLDEST to NEWEST.
      for (let i = 0; i < 5; i++) {
        ids.push(await insertCommunication(forwardUserId, timeAt(i)));
      }
    });

    it('returns the newest page first (DESC by time), reporting a next page and no previous page', async () => {
      const result = await findPage(forwardUserId, { first: 2 });

      expect(result.entities.map((e) => e.id)).toEqual([ids[4], ids[3]]);
      expect(result.hasNextPage).toBe(true);
      expect(result.hasPreviousPage).toBe(false);
      expect(result.totalCount).toBe(5);
    });

    it('walks forward via afterId to the next page without skipping or repeating a row', async () => {
      const result = await findPage(forwardUserId, { first: 2, afterId: ids[3] });

      expect(result.entities.map((e) => e.id)).toEqual([ids[2], ids[1]]);
      expect(result.hasNextPage).toBe(true);
      expect(result.hasPreviousPage).toBe(true);
    });

    it('reports hasNextPage=false on the final, short page', async () => {
      const result = await findPage(forwardUserId, { first: 2, afterId: ids[1] });

      expect(result.entities.map((e) => e.id)).toEqual([ids[0]]);
      expect(result.hasNextPage).toBe(false);
      expect(result.hasPreviousPage).toBe(true);
    });

    it('visits every row exactly once across a full forward walk', async () => {
      const seen: string[] = [];
      let afterId: string | null = null;

      for (let i = 0; i < 10; i++) {
        const result = await findPage(forwardUserId, { first: 2, afterId });
        seen.push(...result.entities.map((e) => e.id));

        if (!result.hasNextPage) {
          break;
        }

        afterId = result.entities.at(-1)!.id;
      }

      // Newest-to-oldest — the reverse of insertion order.
      expect(seen).toEqual([...ids].reverse());
    });
  });

  describe('backward pagination (last / beforeId)', () => {
    const ids: string[] = [];

    beforeAll(async () => {
      for (let i = 0; i < 5; i++) {
        ids.push(await insertCommunication(backwardUserId, timeAt(i)));
      }
    });

    it('reports hasPreviousPage=false when fewer rows precede the cursor than requested (no sentinel row)', async () => {
      // Paging backward from ids[2] (t2): only t3, t4 are newer than the
      // cursor — 2 candidates for a `last: 5` page, so the +1 sentinel SELECT
      // never finds an extra row.
      const result = await findPage(backwardUserId, { last: 5, beforeId: ids[2] });

      expect(result.entities.map((e) => e.id)).toEqual([ids[4], ids[3]]);
      expect(result.hasPreviousPage).toBe(false);
      // A `beforeId` was supplied, so by construction there is a "next" page
      // (the cursor row and everything after it) regardless of hasExtra.
      expect(result.hasNextPage).toBe(true);
    });

    it('reports hasPreviousPage=true and returns a correctly-reversed page when a sentinel row IS found', async () => {
      // Paging backward from ids[1] (t1) with last:2: t2, t3, t4 are all
      // newer — 3 candidates for a 2-row page, so the 3rd row IS the
      // sentinel. The page must still come back in DESC order (newest
      // first), i.e. reversed from the ASC seek order it was fetched in.
      const result = await findPage(backwardUserId, { last: 2, beforeId: ids[1] });

      expect(result.entities.map((e) => e.id)).toEqual([ids[3], ids[2]]);
      expect(result.hasPreviousPage).toBe(true);
      expect(result.hasNextPage).toBe(true);
    });
  });

  describe('cursor not found', () => {
    const ids: string[] = [];

    beforeAll(async () => {
      for (let i = 0; i < 3; i++) {
        ids.push(await insertCommunication(cursorUserId, timeAt(i)));
      }
    });

    it('returns an EMPTY page (never silently falls back to the first page) for an unmatched afterId', async () => {
      const result = await findPage(cursorUserId, { first: 2, afterId: randomUUID() });

      expect(result.entities).toEqual([]);
      expect(result.hasNextPage).toBe(false);
      expect(result.hasPreviousPage).toBe(false);
      // totalCount is computed before cursor resolution, so it stays real
      // even though the page itself is empty.
      expect(result.totalCount).toBe(3);
    });

    it('returns an empty page for an unmatched beforeId too', async () => {
      const result = await findPage(cursorUserId, { last: 2, beforeId: randomUUID() });

      expect(result.entities).toEqual([]);
      expect(result.hasNextPage).toBe(false);
      expect(result.hasPreviousPage).toBe(true); // isBackward, per the short-circuit branch
      expect(result.totalCount).toBe(3);
    });
  });

  describe('(time, id) seek-predicate tie-break', () => {
    // Two rows sharing the EXACT same `time` — ORDER BY (time, id) can only
    // separate them by id, and the seek predicate's OR-clause
    // `(time = :cursorTime AND id < :cursorRowId)` arm is the only thing that
    // can ever fire for this pair. If that arm were wrong, one of these two
    // rows would either repeat across pages or vanish between them.
    let higherId: string;
    let lowerId: string;

    beforeAll(async () => {
      const tiedTime = timeAt(0);
      const a = await insertCommunication(tieUserId, tiedTime);
      const b = await insertCommunication(tieUserId, tiedTime);
      // Canonical lowercase-hex uuids compare byte-wise in Postgres and
      // lexically in JS in the same order, so plain string comparison here
      // matches the DB's DESC ordering.
      [lowerId, higherId] = [a, b].sort();
    });

    it('orders the tied pair by id DESC and pages through both with no loss or duplication', async () => {
      const first = await findPage(tieUserId, { first: 1 });

      expect(first.entities.map((e) => e.id)).toEqual([higherId]);
      expect(first.hasNextPage).toBe(true);

      const second = await findPage(tieUserId, { first: 1, afterId: higherId });

      expect(second.entities.map((e) => e.id)).toEqual([lowerId]);
      expect(second.hasNextPage).toBe(false);
    });
  });

  describe('tenancy scoping', () => {
    let ownRowId: string;
    let otherUserRowId: string;

    beforeAll(async () => {
      ownRowId = await insertCommunication(tenancyUserA, timeAt(0));
      otherUserRowId = await insertCommunication(tenancyUserB, timeAt(1));
    });

    it("never returns another user's rows, and totalCount excludes them", async () => {
      const result = await findPage(tenancyUserA, { first: 10 });

      expect(result.entities.map((e) => e.id)).toEqual([ownRowId]);
      expect(result.entities.map((e) => e.id)).not.toContain(otherUserRowId);
      expect(result.totalCount).toBe(1);
    });
  });
});
