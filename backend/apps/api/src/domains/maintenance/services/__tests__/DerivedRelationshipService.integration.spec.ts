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
  const alice = randomUUID();
  const bob = randomUUID();
  const home = randomUUID();
  const cafe = randomUUID();

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

    // Two people, a home and a café. Names are irrelevant to the SQL; the
    // entity ROWS have to exist because the aggregates read entity ids that the
    // household leg then joins back to `ci.entities`.
    for (const [entityId, entityType, name] of [
      [alice, 'Person', 'Alice'],
      [bob, 'Person', 'Bob'],
      [home, 'Location', 'Home'],
      [cafe, 'Location', 'Café'],
    ] as const) {
      await dataSource.query(
        `INSERT INTO ci.entities (entity_id, entity_type, name, owner_user_id, is_active)
              VALUES ($1::uuid, $2, $3, $4::uuid, TRUE)
         ON CONFLICT (entity_id) DO NOTHING`,
        [entityId, entityType, name, userId],
      );
    }

    // ── The episodic history the aggregates summarise ────────────────────
    //
    // Three communication episodes between the same pair — three DIFFERENT
    // types, because `relationships_unique_directed_idx` is UNIQUE on
    // (from, to, type) WHERE is_active, so a pair cannot hold two active rows
    // of one type. Plus three attempted VISITED rows (see the FREQUENTS note in
    // the spec below), and the LIVES_WITH + shared LIVES_IN pair the household
    // cluster reads.
    const episodes: Array<[string, string, string, string, string]> = [
      [alice, bob, 'EMAILED', 'Person', 'Person'],
      [alice, bob, 'MESSAGED', 'Person', 'Person'],
      [bob, alice, 'CALLED', 'Person', 'Person'],
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
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query('DELETE FROM ci.graph_deltas WHERE owner_user_id = $1', [userId]);
      await dataSource.query('DELETE FROM ci.relationships WHERE owner_user_id = $1', [userId]);
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

    // LEAST(1, LN(n+1)/LN(10)/2) for the three episodes of this pair.
    expect(edge.strength).toBeCloseTo(Math.log10(4) / 2, 6);
    expect(edge.properties.layer).toBe('L2');
    expect(await deltaCount('COMMUNICATES_WITH')).toBe(1);
  });

  /**
   * FREQUENTS cannot fire, and the reason is structural rather than a fixture
   * shortcoming — worth pinning here so the next reader does not spend an hour
   * building a corpus that would satisfy it.
   *
   * `upsertFrequents` groups ACTIVE `VISITED` rows by (from, to, from_type,
   * to_type) and takes `HAVING COUNT(*) >= 3`. `relationships_unique_directed_idx`
   * is UNIQUE on (from_entity_id, to_entity_id, relationship_type) WHERE
   * is_active — so at most ONE active VISITED row can exist per person→place
   * pair, and the count is 1 for every group the aggregate can see. Three
   * inserts above; one row survives; zero FREQUENTS edges.
   *
   * That makes the leg safe to schedule (it is a no-op) but also inert. Fixing
   * it means changing what a repeat visit IS in the schema, which is a
   * derivation-semantics decision and not a scheduling one.
   */
  it('records no FREQUENTS: the unique index caps a person→place VISITED pair at one active row', async () => {
    const [visits] = (await dataSource.query(
      `SELECT COUNT(*)::int AS count FROM ci.relationships
        WHERE owner_user_id = $1 AND relationship_type = 'VISITED' AND is_active = TRUE`,
      [userId],
    )) as Array<{ count: number }>;

    expect(visits.count).toBe(1);

    const [frequents] = (await dataSource.query(
      `SELECT COUNT(*)::int AS count FROM ci.relationships
        WHERE owner_user_id = $1 AND relationship_type = 'FREQUENTS'`,
      [userId],
    )) as Array<{ count: number }>;

    expect(frequents.count).toBe(0);
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
