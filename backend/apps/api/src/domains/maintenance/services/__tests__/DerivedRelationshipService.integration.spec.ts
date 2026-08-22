import { randomUUID } from 'node:crypto';

import { DataSource } from 'typeorm';

import type { LoggerService } from '@ci/common/logging';
import { GraphDeltaWriter } from '@ci/domains/memory';

import { createSyntheticTestUser } from '../../../__tests__/support/applianceUser';
import { databaseAvailability, resolveConnection } from '../../../__tests__/support/databaseConnection';
import { DerivedRelationshipService } from '../DerivedRelationshipService';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE TWO CLAIMS THAT LET THIS LEG RUN ON A TIMER.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `DerivationCron` schedules `derive_relationships` nightly, unattended, for
 * every onboarded user. That is only defensible if two things are true of the
 * SQL, and neither can be checked against a mocked DataSource:
 *
 *  1. **The aggregate legs are idempotent.** A nightly job that adds a row
 *     every night is a leak with a schedule. `ON CONFLICT DO NOTHING` against
 *     `relationships_unique_directed_idx` is what makes the second run a no-op,
 *     and that index is a property of the live schema, not of the service.
 *  2. **The household leg is genuinely withheld.** The trust dial decides
 *     whether a `Group` entity may be MINTED (`DerivationRunListener` asks
 *     `decideAction({ kind: 'graph_entity' })`), and the option it passes has
 *     to actually stop the INSERT — not merely stop counting it.
 *
 * The third case here is the guard against over-correcting: with the option at
 * its default the household leg must still work, because the operator-invoked
 * HTTP path and the orchestrator leg both rely on it and neither has changed.
 *
 * Fixtures are COMMITTED rather than wrapped in an outer transaction: the
 * service calls `dataSource.transaction()`, which takes its own connection from
 * the pool and could not see an uncommitted outer transaction's rows. Teardown
 * deletes them by owner.
 */

const availability = databaseAvailability();
const describeWithDatabase = availability.available ? describe : describe.skip;

if (!availability.available) {
  console.warn(`[maintenance/DerivedRelationshipService.integration] SKIPPED — ${availability.reason}`);
}

jest.setTimeout(60_000);

const noopLogger = {
  setContext: () => undefined,
  log: () => undefined,
  warn: () => undefined,
  debug: () => undefined,
  error: () => undefined,
} as unknown as LoggerService;

describeWithDatabase(`DerivedRelationshipService against the live schema (${availability.target})`, () => {
  let dataSource: DataSource;
  let service: DerivedRelationshipService;

  const userId = randomUUID();
  /** The appliance owner's own Person entity — `ci.users.entity_id`. */
  const owner = randomUUID();
  const alice = randomUUID();
  const bob = randomUUID();
  const home = randomUUID();
  const cafe = randomUUID();
  const gym = randomUUID();

  /** Every `ci.relationships` row this user owns, as a stable comparable set. */
  const relationshipRows = async (): Promise<Array<Record<string, unknown>>> =>
    (await dataSource.query(
      `SELECT from_entity_id, to_entity_id, relationship_type, strength, is_active
         FROM ci.relationships
        WHERE owner_user_id = $1
        ORDER BY relationship_type, from_entity_id, to_entity_id`,
      [userId],
    )) as Array<Record<string, unknown>>;

  const groupCount = async (): Promise<number> => {
    const [row] = (await dataSource.query(
      `SELECT COUNT(*)::int AS count FROM ci.entities WHERE owner_user_id = $1 AND entity_type = 'Group'`,
      [userId],
    )) as Array<{ count: number }>;

    return row.count;
  };

  const deltaCount = async (relationshipType: string): Promise<number> => {
    const [row] = (await dataSource.query(
      `SELECT COUNT(*)::int AS count
         FROM ci.graph_deltas
        WHERE owner_user_id = $1 AND relationship_type = $2 AND change_source = 'DerivedRelationshipService'`,
      [userId, relationshipType],
    )) as Array<{ count: number }>;

    return row.count;
  };

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

    await createSyntheticTestUser(
      (sql, params) => dataSource.query(sql, params as unknown[]),
      'DerivedRelationship',
      userId,
    );

    // The owner plus two people, a home, a café and a gym. Names are irrelevant
    // to the SQL; the entity ROWS have to exist because the aggregates read
    // entity ids that the household leg then joins back to `ci.entities`.
    for (const [entityId, entityType, name] of [
      [owner, 'Person', 'Owner'],
      [alice, 'Person', 'Alice'],
      [bob, 'Person', 'Bob'],
      [home, 'Location', 'Home'],
      [cafe, 'Location', 'Café'],
      [gym, 'Location', 'Gym'],
    ] as const) {
      await dataSource.query(
        `INSERT INTO ci.entities (entity_id, entity_type, name, owner_user_id, is_active)
              VALUES ($1::uuid, $2, $3, $4::uuid, TRUE)
         ON CONFLICT (entity_id) DO NOTHING`,
        [entityId, entityType, name, userId],
      );
    }

    // The account anchor every VISITED edge starts from. Without it the
    // FREQUENTS leg has nothing to attribute the owner's position fixes to.
    await dataSource.query(`UPDATE ci.users SET entity_id = $2::uuid WHERE id = $1::uuid`, [userId, owner]);

    // ── The episodic history the aggregates summarise ────────────────────
    //
    // Three DISTINCT (direction, type) links between the same pair, plus two
    // more EMAILED rows for that same pair which `relationships_unique_directed_idx`
    // (UNIQUE on (from, to, type) WHERE is_active) silently collapses. That
    // collapse is the point: it is why the COMMUNICATES_WITH aggregate counts
    // link KINDS and can never count emails. Then the owner's two VISITED edges
    // (café and gym, told apart only by the position evidence below), a
    // repeated VISITED from a person who is NOT the owner, and the LIVES_WITH +
    // shared LIVES_IN pair the household cluster reads.
    const episodes: Array<[string, string, string, string, string]> = [
      [alice, bob, 'EMAILED', 'Person', 'Person'],
      [alice, bob, 'EMAILED', 'Person', 'Person'],
      [alice, bob, 'EMAILED', 'Person', 'Person'],
      [alice, bob, 'MESSAGED', 'Person', 'Person'],
      [bob, alice, 'CALLED', 'Person', 'Person'],
      [owner, cafe, 'VISITED', 'Person', 'Location'],
      [owner, gym, 'VISITED', 'Person', 'Location'],
      [alice, cafe, 'VISITED', 'Person', 'Location'],
      [alice, cafe, 'VISITED', 'Person', 'Location'],
      [alice, cafe, 'VISITED', 'Person', 'Location'],
      [alice, bob, 'LIVES_WITH', 'Person', 'Person'],
      [alice, home, 'LIVES_IN', 'Person', 'Location'],
      [bob, home, 'LIVES_IN', 'Person', 'Location'],
    ];

    for (const [from, to, type, fromType, toType] of episodes) {
      await dataSource.query(
        `INSERT INTO ci.relationships
           (from_entity_id, to_entity_id, relationship_type, strength, properties,
            owner_user_id, from_entity_type, to_entity_type, is_bidirectional, is_active)
         VALUES ($1::uuid, $2::uuid, $3, 1.0, '{}'::jsonb, $4::uuid, $5, $6, FALSE, TRUE)
         ON CONFLICT DO NOTHING`,
        [from, to, type, userId, fromType, toType],
      );
    }

    // ── The telemetry the visit counts are read from ─────────────────────
    //
    // Café: three fixes on three separate days. Gym: FIVE fixes, all inside one
    // afternoon — more rows than the café and still a single day, which is the
    // difference between "goes there" and "was there once for a while".
    const fixes: Array<[string, string]> = [
      ['2026-03-01T09:00:00Z', cafe],
      ['2026-03-02T09:05:00Z', cafe],
      ['2026-03-03T09:10:00Z', cafe],
      ['2026-03-04T17:00:00Z', gym],
      ['2026-03-04T17:15:00Z', gym],
      ['2026-03-04T17:30:00Z', gym],
      ['2026-03-04T17:45:00Z', gym],
      ['2026-03-04T18:00:00Z', gym],
    ];

    for (const [time, placeId] of fixes) {
      await dataSource.query(
        `INSERT INTO ci.position (time, user_id, source, location, location_entity_id)
              VALUES ($1::timestamptz, $2::uuid, 'gps', ST_SetSRID(ST_MakePoint(0, 0), 4326), $3::uuid)`,
        [time, userId, placeId],
      );
    }
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query('DELETE FROM ci.graph_deltas WHERE owner_user_id = $1', [userId]);
      await dataSource.query('DELETE FROM ci.relationships WHERE owner_user_id = $1', [userId]);
      await dataSource.query('DELETE FROM ci.position WHERE user_id = $1', [userId]);
      // ci.users.entity_id has no ON DELETE action, so the anchor has to be
      // released before the entity it points at can go.
      await dataSource.query('UPDATE ci.users SET entity_id = NULL WHERE id = $1', [userId]);
      await dataSource.query('DELETE FROM ci.entities WHERE owner_user_id = $1', [userId]);
      await dataSource.query('DELETE FROM ci.users WHERE id = $1', [userId]);
      await dataSource.destroy();
    }
  });

  beforeAll(() => {
    service = new DerivedRelationshipService(
      dataSource,
      new GraphDeltaWriter(dataSource, noopLogger),
      noopLogger,
    );
  });

  it('projects the aggregates and WITHHOLDS the household Group when the option is false', async () => {
    const result = await service.derive(userId, { reifyHouseholdGroups: false });

    expect(result.communicatesWith).toBe(1);
    expect(result.frequents).toBe(1);
    expect(result.householdReification).toBe('withheld');
    expect(result.groupsReified).toBe(0);

    // The claim that matters: nothing was MINTED. A `groupsReified: 0` that
    // still inserted a Group would pass a counter assertion and fail the user.
    expect(await groupCount()).toBe(0);

    const [edge] = (await dataSource.query(
      `SELECT strength, properties FROM ci.relationships
        WHERE owner_user_id = $1 AND relationship_type = 'COMMUNICATES_WITH'`,
      [userId],
    )) as Array<{ strength: number; properties: Record<string, unknown> }>;

    // Three DISTINCT link kinds, not five rows: the two extra EMAILED inserts
    // above collapsed on the unique index and bought this pair nothing. That is
    // the whole content of the weight — `LEAST(1, LN(n+1)/LN(10)/2)` over a
    // count the index bounds at 10 — and it is asserted under the name that
    // says so, because `episode_count` read as a communication frequency it has
    // never been able to measure.
    expect(edge.properties.episodic_link_kinds).toBe(3);
    expect(edge.strength).toBeCloseTo(Math.log10(4) / 2, 6);
    expect(edge.properties.layer).toBe('L2');
    expect(await deltaCount('COMMUNICATES_WITH')).toBe(1);
  });

  /**
   * The repeat-visit count CANNOT come from `ci.relationships`, and that is a
   * property of the live schema this spec exists to hold onto:
   * `relationships_unique_directed_idx` is UNIQUE on (from, to, type) WHERE
   * is_active, so the three `alice -VISITED→ café` inserts above collapse to
   * ONE row. An aggregate over those rows counts 1 for every pair there is —
   * which is exactly why this leg used to be a scheduled no-op.
   *
   * It counts `ci.position` days instead: the fixes whose `location_entity_id`
   * snapped to the place, which is the same evidence the VISITED edge itself
   * was projected from.
   */
  it('derives FREQUENTS from repeat visit DAYS in ci.position, not from duplicate VISITED rows', async () => {
    const [visited] = (await dataSource.query(
      `SELECT COUNT(*)::int AS count FROM ci.relationships
        WHERE owner_user_id = $1 AND to_entity_id = $2 AND relationship_type = 'VISITED' AND is_active = TRUE`,
      [userId, cafe],
    )) as Array<{ count: number }>;

    // Two: the owner's and alice's. Her three inserts are one surviving row.
    expect(visited.count).toBe(2);

    const edges = (await dataSource.query(
      `SELECT from_entity_id, to_entity_id, strength, properties
         FROM ci.relationships
        WHERE owner_user_id = $1 AND relationship_type = 'FREQUENTS'`,
      [userId],
    )) as Array<{
      from_entity_id: string;
      to_entity_id: string;
      strength: number;
      properties: Record<string, unknown>;
    }>;

    // The café only, from the OWNER. Alice's repeated VISITED row buys nothing:
    // ci.position is the owner's telemetry, so it cannot evidence her visits.
    expect(edges).toHaveLength(1);
    expect(edges[0].from_entity_id).toBe(owner);
    expect(edges[0].to_entity_id).toBe(cafe);
    expect(edges[0].properties.visit_days).toBe(3);
    expect(edges[0].strength).toBeCloseTo(Math.log10(4) / 2, 6);
    expect(await deltaCount('FREQUENTS')).toBe(1);

    // And the gym is NOT one: five fixes, all on one afternoon.
    expect(edges.some((edge) => edge.to_entity_id === gym)).toBe(false);
  });

  it('is idempotent: a second pass writes nothing and leaves every row identical', async () => {
    const before = await relationshipRows();

    const result = await service.derive(userId, { reifyHouseholdGroups: false });

    expect(result).toEqual({
      communicatesWith: 0,
      frequents: 0,
      groupsReified: 0,
      householdReification: 'withheld',
    });
    expect(await relationshipRows()).toEqual(before);
    // No second delta either — a re-run that re-announced the same edge would
    // put a phantom "created" into the stream insight generation reads.
    expect(await deltaCount('COMMUNICATES_WITH')).toBe(1);
  });

  it('still reifies the household when the caller is an operator (option defaulted)', async () => {
    const result = await service.derive(userId);

    expect(result.householdReification).toBe('applied');
    expect(result.groupsReified).toBe(1);
    expect(await groupCount()).toBe(1);

    const members = (await dataSource.query(
      `SELECT COUNT(*)::int AS count FROM ci.relationships
        WHERE owner_user_id = $1 AND relationship_type = 'MEMBER_OF'`,
      [userId],
    )) as Array<{ count: number }>;

    expect(members[0].count).toBe(2);

    // And that path is idempotent too — the household leg keys on
    // (linked_table, linked_id), not on a fresh uuid per run.
    const second = await service.derive(userId);

    expect(second.groupsReified).toBe(0);
    expect(await groupCount()).toBe(1);
  });
});
