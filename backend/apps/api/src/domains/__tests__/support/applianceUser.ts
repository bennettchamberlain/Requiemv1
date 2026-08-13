import { randomUUID } from 'node:crypto';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE `ci.users` ROW A DB-BACKED SPEC SEEDS FOR ITSELF.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Several suites need a user id because the table they are seeding carries a
 * foreign key to `ci.users` — `ci.events.user_id`, `ci.entities.owner_user_id`
 * and so on. They all used to reach for the same statement:
 *
 *     SELECT id FROM ci.users LIMIT 1
 *
 * and that is wrong twice over. It is nondeterministic — `LIMIT 1` with no
 * `ORDER BY` is whatever the heap hands back, so a suite could latch onto a
 * synthetic user another worker was midway through deleting, and the suite that
 * then failed was never the one that caused it. And it is a dependency on data
 * the suite did not create: on a fresh appliance, or in CI, `ci.users` is empty
 * and every one of those suites failed on a row it had no business expecting.
 *
 * Ordering the read fixed the first problem and not the second. A test that
 * needs a row creates the row.
 *
 * ## What a suite does instead
 *
 * {@link createSyntheticTestUser} inserts one and hands back its id. Every one
 * of these suites already seeds its own events, communications and entities
 * inside a transaction it always rolls back; the user simply joins them, and
 * the rollback takes it away with everything else. Nothing is committed, so no
 * other worker can see it, there is nothing to clean up, and the suite no
 * longer cares what the database happened to contain.
 *
 * A suite that CANNOT hide inside a transaction — the import staging harness
 * and the bulkUpsert spec, which drive real services on real connections —
 * commits its user and deletes it in teardown. Those name it through
 * {@link syntheticTestUserEmail}, so a leaked row is recognisable as a test
 * fixture rather than mistaken for the appliance's own account.
 */
/**
 * The email domain a NEW suite should mint its users under.
 *
 * `.invalid` is reserved by RFC 2606 precisely so it can never resolve, which
 * is what makes an address in it unmistakably a fixture. Existing suites do not
 * all agree on the host — `@corpus.invalid` and `@example.test` are also in use
 * — and that is fine now that nothing has to RECOGNISE them: each suite owns
 * the user it creates.
 */
export const SYNTHETIC_TEST_USER_DOMAIN = 'example.invalid';

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

/**
 * Insert a `ci.users` row for this suite and return its id.
 *
 * Only `id` is required by the schema; `created_at`, `updated_at` and `role`
 * all default. The email carries the marker so that a row which escapes — a
 * suite that commits rather than rolls back, and then dies before its teardown
 * — is identifiable as test litter instead of being taken for a real account.
 *
 * `ON CONFLICT (id) DO NOTHING` because a caller may seed idempotently.
 *
 * @param query the caller's own query function — normally a `QueryRunner`'s, so
 *   the row is created on the same connection, and inside the same transaction,
 *   as the fixtures that reference it. Rolled back with them.
 * @param label the calling suite, which becomes part of the address.
 */
export async function createSyntheticTestUser(
  query: (sql: string, params?: unknown[]) => Promise<unknown>,
  label: string,
  userId: string = randomUUID(),
): Promise<string> {
  await query(
    `INSERT INTO ci.users (id, name, email)
          VALUES ($1::uuid, $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    [userId, `${label} spec fixture`, syntheticTestUserEmail(label.toLowerCase(), userId)],
  );

  return userId;
}
