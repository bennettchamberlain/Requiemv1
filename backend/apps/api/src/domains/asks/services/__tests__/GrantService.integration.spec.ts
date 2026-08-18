import { DataSource } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import type { LoggerService } from '@ci/common/logging';

import { databaseAvailability, resolveConnection } from '../../../__tests__/support/databaseConnection';
import { acquireSchemaWriteLock, type SchemaLock } from '../../../__tests__/support/schemaLock';
import type { Ask } from '../../entities/AskEntity';
import { AskGrantEntity } from '../../entities/AskGrantEntity';
import { GrantService } from '../GrantService';

/**
 * `GrantService.evaluate` — the WHERE clause IS the authorization boundary,
 * proved against real Postgres.
 *
 * `evaluateGrant` (grantMatch.spec.ts) is exhaustively tested as a pure
 * function, but it trusts its caller completely — its own docstring says so:
 * "grants MUST already be scoped to (owner = responder, grantee = asker); this
 * function does not re-check ownership." `GrantService.evaluate` is that
 * caller, and the scoping lives entirely in one `repository.find({ where: {
 * ownerUserId, granteeUserId, revokedAt: IsNull() } })`. A mocked repository
 * cannot show that a swapped field or a dropped clause leaks a grant across
 * users — it can only show the service calls `.find()` with SOME object. Only
 * real rows, real other users, and a real query can show the WHERE clause
 * actually excludes them.
 *
 * Opt-in: set `ASKS_TEST_DATABASE_URL` (or `DATABASE_URL` / `DATABASE_PASSWORD`,
 * as `yarn test` already does from the repo-root `.env`) to a database with
 * migrations applied.
 */
const availability = databaseAvailability({ urlEnvVar: 'ASKS_TEST_DATABASE_URL' });
const describeWithDatabase = availability.available ? describe : describe.skip;

if (!availability.available) {
  console.warn(`[asks/GrantService.integration] SKIPPED — ${availability.reason}`);
}

jest.setTimeout(60_000);

describeWithDatabase(`GrantService.evaluate — against real Postgres (${availability.target})`, () => {
  let dataSource: DataSource;
  let schemaLock: SchemaLock | null = null;
  let grantService: GrantService;

  // Four distinct people. `owner` is the ask's RESPONDER (the one whose memory
  // is being asked about and who owns the grant); `grantee` is the ask's ASKER
  // the owner actually granted to; `strangerAsker` and `strangerOwner` are two
  // unrelated users who must see none of owner/grantee's grant.
  const owner = { userId: uuidv7() };
  const grantee = { userId: uuidv7() };
  const strangerAsker = { userId: uuidv7() };
  const strangerOwner = { userId: uuidv7() };

  const noopLogger = { setContext: () => undefined } as unknown as LoggerService;

  function askBetween(askerUserId: string, responderUserId: string, overrides: Partial<Ask> = {}): Ask {
    return {
      id: uuidv7(),
      askerUserId,
      responderUserId,
      query: { queryType: 'photos', prompt: 'do you have photos of us?' },
      status: 'delivered',
      consentBasis: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: null,
      ...overrides,
    } as Ask;
  }

  beforeAll(async () => {
    const connection = resolveConnection({ urlEnvVar: 'ASKS_TEST_DATABASE_URL' });

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
      entities: [AskGrantEntity],
      synchronize: false,
      extra: { options: '-c search_path=ci,public' },
    });

    await dataSource.initialize();

    // SHARED: this suite commits real ci.users / ci.ask_grants rows. See
    // domains/__tests__/support/schemaLock.ts.
    schemaLock = await acquireSchemaWriteLock(dataSource, 'GrantService.evaluate');

    for (const [{ userId }, name] of [
      [owner, 'Owner'],
      [grantee, 'Grantee'],
      [strangerAsker, 'StrangerAsker'],
      [strangerOwner, 'StrangerOwner'],
    ] as const) {
      await dataSource.query(
        `INSERT INTO ci.users (id, name, email, password, onboarded)
         VALUES ($1, $2, $3, 'x', true)
         ON CONFLICT (id) DO NOTHING`,
        [userId, name, `grantservice.${name.toLowerCase()}.${userId}@example.test`],
      );
    }

    grantService = new GrantService(dataSource.getRepository(AskGrantEntity), noopLogger);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      // ON DELETE CASCADE takes the grants with the users.
      await dataSource.query('DELETE FROM ci.users WHERE id = ANY($1)', [
        [owner.userId, grantee.userId, strangerAsker.userId, strangerOwner.userId],
      ]);
      // Before `destroy()`: the lock is held on a runner from this pool.
      await schemaLock?.release();
      await dataSource.destroy();
    }
  });

  it('auto-answers the grantee the owner actually granted to, and no one else', async () => {
    const grant = await grantService.create(owner, {
      granteeUserId: grantee.userId,
      queryType: 'photos',
      mode: 'auto',
    });

    // The intended pair: owner granted, grantee asks → auto.
    await expect(grantService.evaluate(askBetween(grantee.userId, owner.userId))).resolves.toEqual({
      decision: 'auto',
      grantId: grant.id,
    });

    // Same queryType, but a DIFFERENT asker the owner never granted to → the
    // WHERE clause's granteeUserId filter must exclude them. If it only scoped
    // on ownerUserId this would wrongly auto-answer a stranger.
    await expect(grantService.evaluate(askBetween(strangerAsker.userId, owner.userId))).resolves.toEqual({
      decision: 'review',
    });

    // Same grantee, but asking a DIFFERENT owner who never granted anything →
    // the WHERE clause's ownerUserId filter must exclude them. If it only
    // scoped on granteeUserId this would wrongly auto-answer through a grant
    // that belongs to someone else's memory entirely.
    await expect(grantService.evaluate(askBetween(grantee.userId, strangerOwner.userId))).resolves.toEqual({
      decision: 'review',
    });

    // The relationship is directional: owner granted TO grantee, not the
    // reverse. If the ask were (asker=owner, responder=grantee) this must NOT
    // pick up the same grant row.
    await expect(grantService.evaluate(askBetween(owner.userId, grantee.userId))).resolves.toEqual({
      decision: 'review',
    });

    await grantService.revoke(owner, grant.id);
  });

  it('excludes a revoked grant — a revoked grant must not keep auto-answering', async () => {
    const grant = await grantService.create(owner, {
      granteeUserId: grantee.userId,
      queryType: 'calendar',
      mode: 'auto',
    });

    await expect(
      grantService.evaluate(
        askBetween(grantee.userId, owner.userId, { query: { queryType: 'calendar', prompt: 'q' } }),
      ),
    ).resolves.toEqual({ decision: 'auto', grantId: grant.id });

    await grantService.revoke(owner, grant.id);

    await expect(
      grantService.evaluate(
        askBetween(grantee.userId, owner.userId, { query: { queryType: 'calendar', prompt: 'q' } }),
      ),
    ).resolves.toEqual({ decision: 'review' });
  });

  it('a block grant denies only the (owner, grantee) pair it was written for', async () => {
    const block = await grantService.create(owner, {
      granteeUserId: grantee.userId,
      queryType: 'health',
      mode: 'block',
    });

    await expect(
      grantService.evaluate(
        askBetween(grantee.userId, owner.userId, { query: { queryType: 'health', prompt: 'q' } }),
      ),
    ).resolves.toEqual({ decision: 'deny', grantId: block.id });

    // The stranger asker is unaffected by a block that names only `grantee`.
    await expect(
      grantService.evaluate(
        askBetween(strangerAsker.userId, owner.userId, { query: { queryType: 'health', prompt: 'q' } }),
      ),
    ).resolves.toEqual({ decision: 'review' });

    await grantService.revoke(owner, block.id);
  });
});
