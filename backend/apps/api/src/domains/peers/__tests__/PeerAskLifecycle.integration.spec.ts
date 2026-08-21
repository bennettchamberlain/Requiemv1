import { DataSource } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import type { LoggerService } from '@ci/common/logging';
import {
  AskAnswerEntity,
  AskAnswerService,
  AskAuditEntity,
  AskAuditService,
  AskEntity,
  AskGrantEntity,
  AskService,
  GrantService,
} from '@ci/domains/asks';
import { EventEntity } from '@ci/domains/memory';
import { UserEntity } from '@ci/domains/user';

import { databaseAvailability, resolveConnection } from '../../__tests__/support/databaseConnection';
import { acquireSchemaWriteLock, type SchemaLock } from '../../__tests__/support/schemaLock';
import { PeerLinkEntity } from '../entities/PeerLinkEntity';
import { PeerAskService } from '../services/PeerAskService';

/**
 * The federated ask lifecycle, against real Postgres — because the two defects
 * proved here are properties of ROWS, not of intent.
 *
 *  - "the ask never reaches a terminal state" is a claim about what
 *    `ci.asks.status` holds after an answer, and the retroactive-revocation
 *    sweep that reads it (`GrantService.withdrawPreAuthorization`) is a WHERE
 *    clause. A mocked repository can show the service meant to terminalize; it
 *    cannot show that the revoke sweep no longer selects the row.
 *  - "the answer and its audit were un-transacted" is a claim about what
 *    survives a failure mid-write. Only a real transaction rolls back, so only
 *    a real database can show the answer row is gone rather than orphaned.
 *
 * Opt-in: set `PEERS_TEST_DATABASE_URL` (or `DATABASE_URL` / `DATABASE_PASSWORD`,
 * as `yarn test` already does from the repo-root `.env`) to a database with
 * migrations applied.
 */
const availability = databaseAvailability({ urlEnvVar: 'PEERS_TEST_DATABASE_URL' });
const describeWithDatabase = availability.available ? describe : describe.skip;

if (!availability.available) {
  console.warn(`[peers/PeerAskLifecycle.integration] SKIPPED — ${availability.reason}`);
}

jest.setTimeout(60_000);

describeWithDatabase(`federated ask lifecycle — against real Postgres (${availability.target})`, () => {
  const owner = uuidv7();
  const PEER = { issuer: 'https://peer-lifecycle.test', subject: `sub-${owner}` };

  const noopLogger = {
    setContext: () => undefined,
    log: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  } as unknown as LoggerService;

  let dataSource: DataSource;
  let schemaLock: SchemaLock | null = null;
  let grantService: GrantService;
  let askService: AskService;
  let answerService: AskAnswerService;
  let auditService: AskAuditService;

  /** A fresh peer link per test, so one test's revoke cannot reach another's ask. */
  async function freshLink(): Promise<PeerLinkEntity> {
    const id = uuidv7();
    await dataSource.query(
      `INSERT INTO ci.peer_links (id, owner_user_id, peer_handle, display_name, memory_endpoint,
                                  peer_issuer, peer_subject, trust_tier, status)
       VALUES ($1, $2, $3, 'Devon', 'https://devon.test', $4, $5, 'family', 'active')`,
      // The whole uuid, not a prefix: uuidv7 is timestamp-ordered, so two links
      // minted in the same millisecond share their leading characters and
      // collide on `peer_links_owner_handle_uniq`.
      [id, owner, `devon-${id}`, PEER.issuer, `${PEER.subject}-${id}`],
    );

    return dataSource.getRepository(PeerLinkEntity).findOneByOrFail({ id });
  }

  /** The real service, with only the search index faked out. */
  function serviceFor(link: PeerLinkEntity, matches: { id: string; type: string }[] = []) {
    return new PeerAskService(
      { findActiveByPeerIdentity: jest.fn().mockResolvedValue([link]) } as never,
      askService,
      grantService,
      { execute: jest.fn().mockResolvedValue(matches) } as never,
      answerService,
      auditService,
      dataSource.getRepository(EventEntity),
      noopLogger,
    );
  }

  function askBody(link: PeerLinkEntity) {
    return {
      askId: `corr-${link.id}`.slice(0, 64),
      askerHandle: link.peerHandle,
      prompt: 'do you have photos of us?',
      request: { archetype: 'content' as const, subject: 'lake trip', dataClass: 'photos' },
    };
  }

  async function askRow(peerLinkId: string) {
    const [row] = await dataSource.query(
      'SELECT id, status, consent_basis FROM ci.asks WHERE peer_link_id = $1',
      [peerLinkId],
    );

    return row as { id: string; status: string; consent_basis: string | null };
  }

  async function countRows(table: string, askId: string): Promise<number> {
    const [{ n }] = await dataSource.query(`SELECT count(*)::int AS n FROM ci.${table} WHERE ask_id = $1`, [
      askId,
    ]);

    return n as number;
  }

  async function autoGrantFor(link: PeerLinkEntity) {
    return grantService.create(
      { userId: owner },
      {
        granteePeerLinkId: link.id,
        queryType: 'content',
        dataClass: 'photos',
        mode: 'auto',
      },
    );
  }

  beforeAll(async () => {
    const connection = resolveConnection({ urlEnvVar: 'PEERS_TEST_DATABASE_URL' });

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
      entities: [
        AskEntity,
        AskGrantEntity,
        AskAuditEntity,
        AskAnswerEntity,
        UserEntity,
        PeerLinkEntity,
        EventEntity,
      ],
      synchronize: false,
      extra: { options: '-c search_path=ci,public' },
    });

    await dataSource.initialize();

    // SHARED: this suite commits real ci.users / ci.asks rows. See
    // domains/__tests__/support/schemaLock.ts.
    schemaLock = await acquireSchemaWriteLock(dataSource, 'federated ask lifecycle');

    await dataSource.query(
      `INSERT INTO ci.users (id, name, email, password, onboarded)
       VALUES ($1, 'PeerLifecycleOwner', $2, 'x', true)
       ON CONFLICT (id) DO NOTHING`,
      [owner, `peer.lifecycle.${owner}@example.test`],
    );

    grantService = new GrantService(
      dataSource.getRepository(AskGrantEntity),
      dataSource.getRepository(AskEntity),
      noopLogger,
    );
    answerService = new AskAnswerService(dataSource.getRepository(AskAnswerEntity), noopLogger);
    auditService = new AskAuditService(dataSource.getRepository(AskAuditEntity), noopLogger);
    askService = new AskService(
      dataSource.getRepository(AskEntity),
      dataSource.getRepository(UserEntity),
      grantService,
      auditService,
      answerService,
      dataSource,
      noopLogger,
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      // ON DELETE CASCADE takes the asks, answers, audits, grants and links.
      await dataSource.query('DELETE FROM ci.users WHERE id = $1', [owner]);
      // Before `destroy()`: the lock is held on a runner from this pool.
      await schemaLock?.release();
      await dataSource.destroy();
    }
  });

  /**
   * SECURITY: revoking the authorizing grant used to REWRITE a disclosure that
   * had already crossed to the peer.
   *
   * `withdrawPreAuthorization` selects `status = 'delivered'` with this grant
   * as the consent basis — and a fully answered federated ask was still
   * `delivered`, because the federated answer path never terminalized it. So
   * the owner tapping Revoke rewrote history: the answered ask went back to
   * `under_review` with its basis nulled, while the audit row kept saying the
   * disclosure happened.
   */
  it('SECURITY: a completed federated disclosure survives revocation of its grant unchanged', async () => {
    const link = await freshLink();
    const grant = await autoGrantFor(link);
    const service = serviceFor(link, [{ id: uuidv7(), type: 'file' }]);

    const response = await service.handle(PEER, askBody(link));
    expect(response.status).toBe('answered');

    const answered = await askRow(link.id);
    expect(answered.status).toBe('answered');
    expect(answered.consent_basis).toBe(grant.id);
    expect(await countRows('ask_answers', answered.id)).toBe(1);
    expect(await countRows('ask_audit', answered.id)).toBe(1);

    await grantService.revoke({ userId: owner }, grant.id);

    // Untouched. This is the assertion that used to fail: status flipped to
    // `under_review` and consent_basis to NULL.
    const afterRevoke = await askRow(link.id);
    expect(afterRevoke.status).toBe('answered');
    expect(afterRevoke.consent_basis).toBe(grant.id);
    // And no second, contradicting audit row was produced for one disclosure.
    expect(await countRows('ask_audit', answered.id)).toBe(1);
  });

  /**
   * The control for the test above: revocation IS retroactive, and still
   * reaches a genuinely un-answered pre-authorized ask. Without this, "the
   * answered ask was untouched" could just as easily mean the sweep is broken.
   */
  it('…while a still-`delivered` pre-authorization is exactly what revocation reclaims', async () => {
    const link = await freshLink();
    const grant = await autoGrantFor(link);
    const pending = await askService.create(
      { userId: owner },
      {
        responderUserId: owner,
        peerLinkId: link.id,
        direction: 'inbound',
        query: { queryType: 'content', dataClass: 'photos', prompt: 'p' },
      },
    );
    await askService.setConsentBasis(pending.id, grant.id, null);

    await grantService.revoke({ userId: owner }, grant.id);

    const reclaimed = await askRow(link.id);
    expect(reclaimed.status).toBe('under_review');
    expect(reclaimed.consent_basis).toBeNull();
  });

  /**
   * SECURITY: the answer row and its audit row are one disclosure recorded
   * twice, and they were written on separate connections.
   *
   * A failure between them left a readable `ci.ask_answers` row with no audit
   * row saying the disclosure happened — permanently, because
   * `AskAnswerService.create` is insert-only and the retry raises a conflict
   * instead of writing the missing audit. Forced here by failing the audit
   * write; what matters is what is left behind afterwards.
   */
  it('SECURITY: a failed audit write leaves NO orphaned answer row behind', async () => {
    const link = await freshLink();
    await autoGrantFor(link);
    const service = serviceFor(link, [{ id: uuidv7(), type: 'file' }]);

    const record = jest.spyOn(auditService, 'record').mockRejectedValueOnce(new Error('audit write failed'));

    await expect(service.handle(PEER, askBody(link))).rejects.toThrow('audit write failed');
    record.mockRestore();

    const stranded = await askRow(link.id);
    // The answer is rolled back with the audit, and the ask is NOT terminalized
    // against a disclosure that no longer exists.
    expect(await countRows('ask_answers', stranded.id)).toBe(0);
    expect(await countRows('ask_audit', stranded.id)).toBe(0);
    expect(stranded.status).toBe('delivered');
  });

  /**
   * The audit row for a federated disclosure has to name the PEER: an inbound
   * peer ask has no local asker at all, so `asker_user_id` is NULL and the peer
   * link plus its handle are the only attribution the owner's disclosure
   * history has.
   */
  it('attributes the disclosure to the peer, by link AND by handle', async () => {
    const link = await freshLink();
    await autoGrantFor(link);
    const service = serviceFor(link, [{ id: uuidv7(), type: 'file' }]);

    await service.handle(PEER, askBody(link));

    const answered = await askRow(link.id);
    const [audit] = await dataSource.query(
      `SELECT asker_user_id, peer_link_id, peer_handle, responder_user_id, outcome, backing_entities
       FROM ci.ask_audit WHERE ask_id = $1`,
      [answered.id],
    );

    expect(audit).toMatchObject({
      asker_user_id: null,
      peer_link_id: link.id,
      peer_handle: link.peerHandle,
      responder_user_id: owner,
      outcome: 'auto_answered',
    });
    // The owner's own record of what the answer was computed over.
    expect(audit.backing_entities).toHaveLength(1);
  });
});
