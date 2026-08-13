/**
 * ═══════════════════════════════════════════════════════════════════════════
 * WHICH `ci.users` ROW A DB-BACKED SPEC SHOULD ATTACH ITS FIXTURES TO.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Several suites need a real user id because the table they are seeding carries
 * a foreign key to `ci.users` — `ci.events.user_id`, `ci.entities.owner_user_id`
 * and so on. They all reached for the same statement:
 *
 *     SELECT id FROM ci.users LIMIT 1
 *
 * which was fine for exactly as long as the dev database held one user.
 *
 * ## Why an unordered LIMIT 1 became a cross-suite failure
 *
 * Two suites now CREATE a `ci.users` row, commit it, work against it, and delete
 * it in `afterAll`: the import staging harness and the bulkUpsert integration
 * spec. Both need a committed user because what they are testing writes through
 * a real service on a real connection, so neither can hide inside a transaction
 * the way the stage specs do.
 *
 * `LIMIT 1` with no `ORDER BY` is not a choice, it is whatever the heap hands
 * back first — so while one of those suites is mid-flight, a spec in another
 * jest worker can latch onto ITS user instead of the appliance owner's. Both
 * outcomes are bad and neither names its cause:
 *
 *  - the reader gets there first, opens a transaction and inserts a fixture row
 *    referencing that user; the harness's `DELETE FROM ci.users` then blocks on
 *    the foreign key until the reader's transaction rolls back, which on a slow
 *    suite is a jest timeout in a file that did nothing wrong;
 *  - the harness gets there first and commits the delete; the reader's very next
 *    INSERT fails a foreign key against a user that existed when it was read.
 *
 * Either way the suite that fails is not the suite that caused it, and which
 * one loses depends on worker scheduling — which is exactly the shape of the
 * intermittent failures across `PersonLinkStage`, `ObjectPromoteStage`,
 * `GeocodeStage` and friends.
 *
 * ## The fix, in one place rather than six
 *
 * A synthetic user is marked by its email domain, and this module owns BOTH
 * halves of that marker: the suites that mint one call
 * {@link syntheticTestUserEmail}, and the suites that read one call
 * {@link resolveApplianceUserId}, which excludes them and orders the rest. One
 * constant, both sides, so the exclusion cannot drift away from the convention
 * it excludes.
 */

/**
 * The email domain a NEW suite should mint its users under.
 *
 * Existing suites do not agree on one — `@example.invalid`, `@corpus.invalid`
 * and `@example.test` are all in use — which is exactly why the exclusion below
 * is written against the reserved TOP-LEVEL domains rather than against a list
 * of hosts somebody has to remember to extend.
 */
export const SYNTHETIC_TEST_USER_DOMAIN = 'example.invalid';

/**
 * The reserved TLDs, from RFC 2606 / RFC 6761. None of them can ever resolve, so
 * an address in one is a test fixture by construction — which makes "not one of
 * these" a sound reading of "belongs to the appliance", and makes the rule hold
 * for suites written after this file without anyone updating it.
 */
const RESERVED_TEST_TLD_PATTERN = '\\.(invalid|test|example|localhost)$';

/**
 * The email for a `ci.users` row a suite creates for itself.
 *
 * @param prefix names the suite, so a leaked row says who leaked it.
 * @param userId keeps two concurrent runs of the same suite from colliding on
 *   `ci.users`' unique email.
 */
export function syntheticTestUserEmail(prefix: string, userId: string): string {
  return `${prefix}-${userId}@${SYNTHETIC_TEST_USER_DOMAIN}`;
}

/** The one statement, so a caller cannot half-apply the rule. */
const APPLIANCE_USER_SQL = `
  SELECT id
    FROM ci.users
   WHERE email IS NULL
      OR email !~* $1
   ORDER BY created_at, id
   LIMIT 1`;

/**
 * The appliance owner's user id: the oldest non-synthetic user.
 *
 * Deterministic in both directions. `ORDER BY created_at, id` means two runs of
 * the same suite pick the same row (the `id` tiebreak matters because a seeded
 * database can insert several users in one statement, sharing a timestamp), and
 * the `NOT LIKE` means a test user another worker is mid-way through creating
 * or deleting is never the answer.
 *
 * @param query the caller's own query function — usually a `QueryRunner`'s, so
 *   the read happens on the same connection (and inside the same transaction)
 *   as the fixtures that will reference the row it returns.
 * @param label the calling suite, quoted in the error so a fresh appliance says
 *   which spec needs a user rather than just that something did.
 */
export async function resolveApplianceUserId(
  query: (sql: string, params?: unknown[]) => Promise<unknown>,
  label: string,
): Promise<string> {
  const rows = (await query(APPLIANCE_USER_SQL, [RESERVED_TEST_TLD_PATTERN])) as Array<{ id: string }>;

  if (rows.length === 0) {
    // A hard failure, never a skip: the database IS reachable (the caller got
    // this far), so an empty `ci.users` is a setup that has not been finished
    // rather than an absent one, and skipping would turn it into a green run.
    throw new Error(
      `${label}: no appliance user in ci.users to attach fixtures to. Every row is either absent or a ` +
        'synthetic test user (an address in a reserved TLD — .invalid / .test / .example / .localhost). ' +
        'Onboard a user on this database, or check whether a previous interrupted test run leaked users ' +
        'that were never cleaned up.',
    );
  }

  return rows[0].id;
}
