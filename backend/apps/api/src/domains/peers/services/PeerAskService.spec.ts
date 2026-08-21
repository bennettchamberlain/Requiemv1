import { ConflictException } from '@nestjs/common';

import { AskEntity, GrantService, TERMINAL_ASK_STATUSES } from '@ci/domains/asks';

import type { PeerAskBody } from '../protocol';

import { PeerAskService, toAskQuery } from './PeerAskService';

const PEER = { issuer: 'https://hub.test', subject: 'peer-sub' };

function link(overrides: Record<string, unknown> = {}) {
  return {
    id: 'link-1',
    ownerUserId: 'owner-1',
    peerHandle: 'devon',
    displayName: 'Devon',
    memoryEndpoint: 'https://devon.box/agent/v1',
    peerIssuer: PEER.issuer,
    peerSubject: PEER.subject,
    personEntityId: null,
    trustTier: 'trusted',
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    revokedAt: null,
    ...overrides,
  } as never;
}

function body(request: PeerAskBody['request']): PeerAskBody {
  return { askId: 'ask-corr-1', askerHandle: 'devon', prompt: 'q?', request };
}

/** One persisted write, with the transaction context it was made in. */
interface RecordedWrite {
  target: 'answer' | 'ask' | 'audit';
  /** Was the caller inside `manager.transaction` when this ran? */
  transacted: boolean;
  /** The EntityManager the write was enrolled in, if any. */
  manager: unknown;
}

function makeService(
  opts: {
    links?: unknown[];
    decision?: string;
    maxDisclosure?: string;
    events?: unknown[];
    consentStanding?: boolean;
  } = {},
) {
  const peerLinkService = {
    findActiveByPeerIdentity: jest.fn().mockResolvedValue(opts.links ?? [link()]),
  };
  const baseAsk = {
    id: 'ask-1',
    askerUserId: null,
    responderUserId: 'owner-1',
    peerLinkId: 'link-1',
    direction: 'inbound',
    consentBasis: null as string | null,
    disclosureCeiling: null as string | null,
    status: 'delivered',
    query: { queryType: 'content', prompt: 'q?' },
  };
  // THE PERSISTED ROW, kept distinct from the egress copies the service passes
  // around. `terminalize` reads the ask back inside the transaction rather than
  // trusting the handle it was given, so a mock that only returned fresh
  // objects could not show whether the terminal status was ever WRITTEN — which
  // is the whole defect.
  const askRow = { ...baseAsk };
  // The ask ECHOES the query it was created with, rather than pinning a content
  // one for every archetype. The tier ceiling is resolved from
  // `ask.query.dataClass`, so a mock that flattened the three archetypes into
  // one would hide exactly the per-archetype ceiling bug these tests cover.
  let created = baseAsk;
  const askService = {
    create: jest.fn().mockImplementation((_ctx: unknown, data: { query: unknown }) => {
      created = { ...baseAsk, query: data.query as typeof baseAsk.query };
      askRow.query = created.query;

      return Promise.resolve(created);
    }),
    // The lifecycle must actually be persisted — a denied peer ask that stays
    // `delivered` would remain actionable in the owner's inbox.
    systemTransition: jest
      .fn()
      .mockImplementation((_id: string, to: string, options: { consentBasis?: string | null } = {}) => {
        askRow.status = to;

        if (options.consentBasis !== undefined) {
          askRow.consentBasis = options.consentBasis;
        }

        created = { ...created, status: to, consentBasis: askRow.consentBasis };

        return Promise.resolve(created);
      }),
    setConsentBasis: jest
      .fn()
      .mockImplementation((_id: string, basis: string | null, ceiling: string | null) => {
        askRow.consentBasis = basis;
        askRow.disclosureCeiling = ceiling;
        created = { ...created, consentBasis: basis };

        return Promise.resolve(created);
      }),
  };
  const grantService = {
    evaluate: jest.fn().mockResolvedValue({
      decision: opts.decision ?? 'auto',
      grantId: 'g1',
      ...(opts.maxDisclosure ? { maxDisclosure: opts.maxDisclosure } : {}),
    }),
    isConsentStanding: jest.fn().mockResolvedValue(opts.consentStanding ?? true),
  };
  const executorService = { execute: jest.fn().mockResolvedValue([{ id: 'e1', type: 'file' }]) };

  const writes: RecordedWrite[] = [];
  let transacting = false;
  const askRepository = {
    findOne: jest
      .fn()
      .mockImplementation(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(
          where.id === askRow.id && where.responderUserId === askRow.responderUserId ? askRow : null,
        ),
      ),
    save: jest.fn().mockImplementation((entity: unknown) => {
      writes.push({ target: 'ask', transacted: transacting, manager });

      return Promise.resolve(entity);
    }),
  };
  const manager = { getRepository: jest.fn().mockReturnValue(askRepository) };
  const eventRepository = {
    find: jest.fn().mockResolvedValue(opts.events ?? []),
    manager: {
      transaction: jest.fn().mockImplementation(async (work: (m: unknown) => Promise<unknown>) => {
        transacting = true;
        try {
          return await work(manager);
        } finally {
          transacting = false;
        }
      }),
    },
  };
  const answerService = {
    create: jest.fn().mockImplementation((_dto: unknown, enrolled: unknown) => {
      writes.push({ target: 'answer', transacted: transacting, manager: enrolled });

      return Promise.resolve({});
    }),
  };
  const auditService = {
    record: jest.fn().mockImplementation((_dto: unknown, enrolled: unknown) => {
      writes.push({ target: 'audit', transacted: transacting, manager: enrolled });

      return Promise.resolve(undefined);
    }),
  };
  const logger = { setContext: jest.fn(), warn: jest.fn(), log: jest.fn() };

  const service = new PeerAskService(
    peerLinkService as never,
    askService as never,
    grantService as never,
    executorService as never,
    answerService as never,
    auditService as never,
    eventRepository as never,
    logger as never,
  );

  return {
    service,
    peerLinkService,
    askService,
    grantService,
    executorService,
    answerService,
    auditService,
    eventRepository,
    askRepository,
    askRow,
    manager,
    writes,
  };
}

describe('PeerAskService.handle', () => {
  it('refuses an unlinked peer', async () => {
    const { service, askService } = makeService({ links: [] });

    await expect(
      service.handle(PEER, body({ archetype: 'relationship', subject: 'Carol' })),
    ).rejects.toThrow();
    // Nothing is recorded for a stranger — no ask row, no probing signal.
    expect(askService.create).not.toHaveBeenCalled();
  });

  it('refuses when the peer matches more than one household member', async () => {
    const { service } = makeService({ links: [link(), link({ id: 'link-2' })] });

    await expect(
      service.handle(PEER, body({ archetype: 'relationship', subject: 'Carol' })),
    ).rejects.toThrow();
  });

  it('creates the ask as INBOUND with no local asker, attributed to the peer link', async () => {
    const { service, askService } = makeService();

    await service.handle(PEER, body({ archetype: 'content', subject: 'beach photos' }));

    expect(askService.create).toHaveBeenCalledWith(
      { userId: 'owner-1' },
      expect.objectContaining({
        responderUserId: 'owner-1',
        peerLinkId: 'link-1',
        direction: 'inbound',
      }),
    );
  });

  it('declines when a grant blocks, and the decline carries no detail', async () => {
    const { service, auditService } = makeService({ decision: 'deny' });

    const result = await service.handle(PEER, body({ archetype: 'content', subject: 'x' }));

    expect(result.status).toBe('declined');
    expect(result.answer).toBeUndefined();
    // No EntityManager: a decline writes ONE row and has nothing to be atomic
    // with. Only the answer path carries a transaction.
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'declined', peerLinkId: 'link-1', consentBasis: 'g1' }),
      undefined,
    );
  });

  it('SECURITY: a denied ask is transitioned to declined, not left actionable in the inbox', async () => {
    const { service, askService } = makeService({ decision: 'deny' });

    await service.handle(PEER, body({ archetype: 'content', subject: 'x' }));

    // Left at `delivered`, listInbox would surface it as approvable — letting
    // the owner override their own block grant without realising it.
    expect(askService.systemTransition).toHaveBeenCalledWith('ask-1', 'declined', {
      consentBasis: 'g1',
    });
  });

  it('queues for owner review when no standing grant matches', async () => {
    const { service, executorService, askService } = makeService({ decision: 'review' });

    const result = await service.handle(PEER, body({ archetype: 'content', subject: 'x' }));

    expect(result.status).toBe('pending_review');
    // Nothing executed against the owner's memory without consent.
    expect(executorService.execute).not.toHaveBeenCalled();
    // And it is moved into the review queue rather than left in limbo.
    expect(askService.systemTransition).toHaveBeenCalledWith('ask-1', 'under_review');
  });

  it('records which grant auto-authorized an ask, AND the ceiling it imposed', async () => {
    const { service, askService } = makeService({ decision: 'auto', maxDisclosure: 'count' });

    await service.handle(PEER, body({ archetype: 'content', subject: 'x' }));

    // The ceiling is stamped WITH the basis. Re-deriving it later is what let a
    // revoked grant widen an answer on the local path; the same stamp keeps a
    // re-run of this ask capped at what the owner consented to.
    expect(askService.setConsentBasis).toHaveBeenCalledWith('ask-1', 'g1', 'count');
  });

  it('answers a relationship ask as a boolean with NO item references', async () => {
    const { service } = makeService();

    const result = await service.handle(PEER, body({ archetype: 'relationship', subject: 'Carol' }));

    expect(result.status).toBe('answered');
    expect(result.answer?.form).toBe('boolean');
    expect(result.answer?.items).toEqual([]);
  });

  it('SECURITY: a boolean answer carries no cardinality (no keyword-count oracle)', async () => {
    const { service, executorService } = makeService();
    // Several matches behind a yes/no question.
    executorService.execute.mockResolvedValue([
      { id: 'e1', type: 'file' },
      { id: 'e2', type: 'file' },
      { id: 'e3', type: 'event' },
    ]);

    const result = await service.handle(PEER, body({ archetype: 'relationship', subject: 'Carol' }));

    // Emitting 3 here would let a peer re-ask with varied terms and read match
    // counts back out of the responder's whole corpus.
    expect(result.answer?.disclosedCount).toBeUndefined();
    expect(result.answer?.withheldCount).toBeUndefined();
    expect(JSON.stringify(result.answer)).not.toContain('e1');
  });

  it('an existence answer DOES carry a count — that is what the form means', async () => {
    const { service, executorService } = makeService();
    executorService.execute.mockResolvedValue([
      { id: 'e1', type: 'file' },
      { id: 'e2', type: 'file' },
    ]);

    const result = await service.handle(PEER, body({ archetype: 'content', subject: 'beach' }));

    expect(result.answer?.form).toBe('existence');
    expect(result.answer?.disclosedCount).toBe(2);
  });

  it('answers an availability ask from the calendar without touching the search index', async () => {
    const { service, executorService, eventRepository } = makeService();
    eventRepository.find.mockResolvedValue([
      { startTime: new Date('2026-08-07T10:00:00Z'), endTime: new Date('2026-08-07T11:00:00Z') },
    ]);

    const result = await service.handle(
      PEER,
      body({
        archetype: 'availability',
        from: '2026-08-07T09:00:00.000Z',
        to: '2026-08-07T17:00:00.000Z',
        minMinutes: 60,
        purpose: 'lunch',
      }),
    );

    expect(result.answer?.form).toBe('availability');
    expect(result.answer?.busy).toEqual([
      { start: '2026-08-07T10:00:00.000Z', end: '2026-08-07T11:00:00.000Z' },
    ]);
    expect(result.answer?.items).toBeUndefined();
    // Availability never runs the memory search executor.
    expect(executorService.execute).not.toHaveBeenCalled();
  });
});

describe('availability window', () => {
  const WINDOW = { from: '2026-08-07T12:00:00.000Z', to: '2026-08-07T13:00:00.000Z' };

  it('SECURITY: selects OVERLAPPING events, not just ones starting inside the window', async () => {
    const { service, eventRepository } = makeService();

    await service.handle(PEER, body({ archetype: 'availability', ...WINDOW }));

    // A 09:00–17:00 meeting starts before this window. Filtering on
    // `startTime BETWEEN from AND to` would miss it entirely and report the
    // owner free straight through a four-hour meeting.
    const where = eventRepository.find.mock.calls[0][0].where;
    expect(Array.isArray(where)).toBe(true);
    expect(where[0]).toEqual(
      expect.objectContaining({ startTime: expect.anything(), endTime: expect.anything() }),
    );
    // and the query is capped
    expect(eventRepository.find.mock.calls[0][0].take).toBeGreaterThan(0);
  });

  it('rejects an inverted window', async () => {
    const { service } = makeService();

    await expect(
      service.handle(PEER, body({ archetype: 'availability', from: WINDOW.to, to: WINDOW.from })),
    ).rejects.toThrow();
  });

  it('rejects an unbounded window (a peer cannot make us merge a whole calendar)', async () => {
    const { service } = makeService();

    await expect(
      service.handle(
        PEER,
        body({
          archetype: 'availability',
          from: '1970-01-01T00:00:00.000Z',
          to: '2100-01-01T00:00:00.000Z',
        }),
      ),
    ).rejects.toThrow();
  });
});

describe('toAskQuery', () => {
  it('maps each archetype into the local ask vocabulary', () => {
    expect(toAskQuery(body({ archetype: 'relationship', subject: 'Carol' })).queryType).toBe('relationship');
    expect(toAskQuery(body({ archetype: 'content', subject: 'photos', dataClass: 'photos' }))).toMatchObject({
      queryType: 'content',
      dataClass: 'photos',
    });
    expect(
      toAskQuery(
        body({ archetype: 'availability', from: '2026-08-07T09:00:00.000Z', to: '2026-08-07T17:00:00.000Z' }),
      ),
    ).toMatchObject({ queryType: 'availability', dataClass: 'calendar' });
  });
});

/**
 * ═══ THE AVAILABILITY ARCHETYPE BYPASSED BOTH CEILINGS ═══
 *
 * `answerFor` computed the tier ceiling and the grant ceiling on its
 * relationship/content path — AFTER the availability branch had already
 * returned. So the one archetype that answers straight out of the owner's
 * calendar was the one archetype no ceiling applied to.
 *
 * Reproduced against Postgres: `trustTier: 'stranger'` (tier ceiling `boolean`)
 * together with a grant carrying `maxDisclosure: 'none'` still handed the peer
 * the owner's real busy interval 12:00–13:00 and both free windows, and wrote
 * no `ci.ask_answers` row at all. The CONTENT archetype under the identical
 * `none` ceiling correctly returned "Nothing was shared."
 */
describe('PeerAskService — availability is subject to the same ceilings as everything else', () => {
  const WINDOW = {
    archetype: 'availability',
    from: '2026-09-01T09:00:00Z',
    to: '2026-09-01T17:00:00Z',
  } as const;
  const BUSY_NOON = [
    { startTime: new Date('2026-09-01T12:00:00Z'), endTime: new Date('2026-09-01T13:00:00Z') },
  ];

  async function availability(opts: { trustTier?: string; maxDisclosure?: string }) {
    const harness = makeService({
      links: [link({ trustTier: opts.trustTier ?? 'trusted' })],
      decision: 'auto',
      maxDisclosure: opts.maxDisclosure,
      events: BUSY_NOON,
    });
    const result = await harness.service.handle(PEER, body({ ...WINDOW }));

    return { ...harness, answer: result.answer! };
  }

  it('discloses NOTHING under a grant capped at none, whatever the calendar says', async () => {
    const { answer } = await availability({ trustTier: 'stranger', maxDisclosure: 'none' });

    // The exact bypass: the owner's real meeting used to come back here.
    expect(answer.busy).toEqual([]);
    expect(answer.free).toEqual([]);
    expect(answer.summary).toBe('Nothing was shared.');
  });

  it('gives a stranger a yes/no, not the owner’s meeting times', async () => {
    // The tier ceiling ALONE, with no grant cap at all — proving the tier half
    // of the bypass is closed independently of the grant half.
    const { answer } = await availability({ trustTier: 'stranger' });

    expect(answer.busy).toEqual([]);
    expect(answer.free).toEqual([]);
    expect(answer.summary).toMatch(/have some free time/);
  });

  it('still gives a trusted peer the actual intervals — the ceiling is not a blanket', async () => {
    const { answer } = await availability({ trustTier: 'family' });

    expect(answer.busy).toEqual([{ start: '2026-09-01T12:00:00.000Z', end: '2026-09-01T13:00:00.000Z' }]);
    expect(answer.free).toHaveLength(2);
  });

  it('records what it disclosed — the availability branch wrote no answer row at all', async () => {
    const { answerService } = await availability({ trustTier: 'stranger', maxDisclosure: 'none' });

    // Stored under `attribute`: the ask_answers CHECK admits the five local
    // forms, and `availability` is a WIRE form, not a storage one.
    expect(answerService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        askId: 'ask-1',
        answer: expect.objectContaining({ form: 'attribute', items: [], summary: 'Nothing was shared.' }),
      }),
      expect.anything(),
    );
  });

  /**
   * The remaining half of the same defect. `disclosed_entities` is correctly
   * empty — free/busy crosses as interval boundaries, never as entity
   * references — but the audit recorded no BACKING entities either, so the
   * owner's history could not say which of their meetings a peer's "are you
   * free?" had actually consulted. Every other archetype records its candidate
   * set there.
   */
  it('records WHICH calendar events the availability answer was computed over', async () => {
    const harness = makeService({
      links: [link({ trustTier: 'family' })],
      decision: 'auto',
      events: [
        {
          id: 'ev-1',
          startTime: new Date('2026-09-01T12:00:00Z'),
          endTime: new Date('2026-09-01T13:00:00Z'),
        },
        {
          id: 'ev-2',
          startTime: new Date('2026-09-01T15:00:00Z'),
          endTime: new Date('2026-09-01T16:00:00Z'),
        },
      ],
    });

    const result = await harness.service.handle(PEER, body({ ...WINDOW }));

    expect(harness.auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'auto_answered',
        // Nothing itemized crossed…
        disclosedEntities: [],
        // …but the box read two of the owner's events to answer, and that is
        // the owner's own record, not the peer's.
        backingEntities: ['ev-1', 'ev-2'],
      }),
      expect.anything(),
    );
    // Backing entities are owner-only. An event id reaching the wire would turn
    // an availability answer into a calendar-enumeration oracle.
    expect(JSON.stringify(result.answer)).not.toContain('ev-1');
  });

  it('loads the event id so the audit can name it — the select used to omit it', async () => {
    const { service, eventRepository } = makeService({ events: BUSY_NOON });

    await service.handle(PEER, body({ ...WINDOW }));

    expect(eventRepository.find.mock.calls[0][0].select).toEqual(expect.objectContaining({ id: true }));
  });
});

/**
 * ═══ THE FEDERATED PATH ANSWERED, THEN LEFT THE ASK WHERE IT STARTED ═══
 *
 * `answerFor` wrote an answer row and an audit row and stopped. The ask stayed
 * `delivered` with its consent basis intact — indistinguishable, in the table,
 * from an ask that is pre-authorized and has NOT been answered yet. Everything
 * downstream reads that shape and reads it wrong.
 */
describe('PeerAskService — a federated answer reaches a terminal state', () => {
  it('SECURITY: drives the ask to `answered`, and PERSISTS it', async () => {
    const { service, askRow } = makeService();

    await service.handle(PEER, body({ archetype: 'content', subject: 'x' }));

    expect(askRow.status).toBe('answered');
    expect(TERMINAL_ASK_STATUSES).toContain(askRow.status);
  });

  it('terminalizes the availability archetype too — it has its own answer branch', async () => {
    const { service, askRow } = makeService({
      events: [{ id: 'ev-1', startTime: new Date('2026-09-01T12:00:00Z'), endTime: null }],
    });

    await service.handle(
      PEER,
      body({ archetype: 'availability', from: '2026-09-01T09:00:00Z', to: '2026-09-01T17:00:00Z' }),
    );

    expect(askRow.status).toBe('answered');
  });

  it('takes the legal `delivered → answering → answered` route, not a direct assignment', async () => {
    const { service, askRow } = makeService();

    // `delivered → answered` is not an edge of the state machine. If this ever
    // starts throwing IllegalAskTransitionError the shared lifecycle changed
    // under the federated path — which is the failure mode this whole file is
    // about.
    await expect(service.handle(PEER, body({ archetype: 'content', subject: 'x' }))).resolves.toMatchObject({
      status: 'answered',
    });
    expect(askRow.status).toBe('answered');
  });

  /**
   * The consequence with teeth. `GrantService.withdrawPreAuthorization` selects
   * `{ responderUserId, consentBasis: <grant>, status: 'delivered' }` — and an
   * answered-but-still-`delivered` federated ask matched it exactly, so
   * revoking the grant RETROACTIVELY EDITED a disclosure that had already
   * crossed to the peer: status back to `under_review`, basis nulled. The
   * audit log said the disclosure happened; the ask said it was still awaiting
   * review.
   *
   * Run against the REAL GrantService, so it is the actual revocation code
   * deciding whether this ask is in its set — not a restatement of the filter.
   */
  it('SECURITY: revoking the authorizing grant cannot rewrite a completed federated disclosure', async () => {
    const { service, askRow } = makeService();
    await service.handle(PEER, body({ archetype: 'content', subject: 'x' }));

    const grant = {
      id: 'g1',
      ownerUserId: 'owner-1',
      revokedAt: null as Date | null,
      revocationReason: null as string | null,
      expiresAt: null as Date | null,
    };
    const grantRepository = {
      findOne: jest.fn().mockResolvedValue(grant),
      save: jest.fn().mockResolvedValue(grant),
    };
    // A faithful stand-in for the equality WHERE in `withdrawPreAuthorization`.
    const askRepository = {
      find: jest
        .fn()
        .mockImplementation(({ where }: { where: Record<string, unknown> }) =>
          Promise.resolve(
            [askRow].filter(
              (row) =>
                row.responderUserId === where.responderUserId &&
                row.consentBasis === where.consentBasis &&
                row.status === where.status,
            ),
          ),
        ),
      save: jest.fn().mockImplementation((rows: unknown) => Promise.resolve(rows)),
    };
    const grantService = new GrantService(
      grantRepository as never,
      askRepository as never,
      { setContext: jest.fn(), log: jest.fn() } as never,
    );

    await grantService.revoke({ userId: 'owner-1' }, 'g1');

    // Untouched: the disclosure is history, and history is not rewritten.
    expect(askRow.status).toBe('answered');
    expect(askRow.consentBasis).toBe('g1');
    expect(askRepository.save).not.toHaveBeenCalled();
  });
});

/**
 * ═══ THE ANSWER AND ITS AUDIT WERE WRITTEN ON SEPARATE CONNECTIONS ═══
 *
 * The local path wraps them (`AskService.completeWithAnswer`); this one did
 * not. A failure between the two leaves a `ci.ask_answers` row with no audit
 * row — and permanently, because `AskAnswerService.create` is insert-only, so
 * the retry raises a conflict instead of writing the missing audit.
 */
describe('PeerAskService — the disclosure and its audit are atomic', () => {
  it('writes the answer, the terminal status, and the audit in ONE transaction', async () => {
    const { service, writes, manager, eventRepository } = makeService();

    await service.handle(PEER, body({ archetype: 'content', subject: 'x' }));

    expect(eventRepository.manager.transaction).toHaveBeenCalledTimes(1);
    expect(writes.map((write) => write.target)).toEqual(['answer', 'ask', 'audit']);
    // Every one of them inside the transaction…
    expect(writes.every((write) => write.transacted)).toBe(true);
    // …and enrolled in it. A write that merely HAPPENS during a transaction it
    // was not handed the manager for still commits on its own connection.
    expect(writes.every((write) => write.manager === manager)).toBe(true);
  });

  it('does the same on the availability branch', async () => {
    const { service, writes, manager } = makeService({
      events: [{ id: 'ev-1', startTime: new Date('2026-09-01T12:00:00Z'), endTime: null }],
    });

    await service.handle(
      PEER,
      body({ archetype: 'availability', from: '2026-09-01T09:00:00Z', to: '2026-09-01T17:00:00Z' }),
    );

    expect(writes.map((write) => write.target)).toEqual(['answer', 'ask', 'audit']);
    expect(writes.every((write) => write.transacted && write.manager === manager)).toBe(true);
  });

  it('reads the ask back INSIDE the transaction, scoped to the link owner', async () => {
    const { service, askRepository, manager } = makeService();

    await service.handle(PEER, body({ archetype: 'content', subject: 'x' }));

    expect(manager.getRepository).toHaveBeenCalledWith(AskEntity);
    expect(askRepository.findOne).toHaveBeenCalledWith({
      where: { id: 'ask-1', responderUserId: 'owner-1' },
    });
  });

  it('nothing is persisted when the answer insert fails', async () => {
    const { service, answerService, auditService, askRow } = makeService();
    answerService.create.mockRejectedValueOnce(new ConflictException('already has an answer'));

    await expect(service.handle(PEER, body({ archetype: 'content', subject: 'x' }))).rejects.toThrow();

    // The audit never runs, and the ask is left where the transaction found it
    // rather than terminalized against an answer that does not exist.
    expect(auditService.record).not.toHaveBeenCalled();
    expect(askRow.status).toBe('delivered');
  });
});

/**
 * ═══ RETROACTIVE REVOCATION DID NOT REACH THE FEDERATED PATH ═══
 *
 * The local answer path re-checks the standing grant before it discloses
 * (`AskService.complete` → `isConsentStanding`). The federated path went
 * straight from `evaluate` to disclosure, so the grant read at routing time was
 * the only thing between a withdrawn consent and a peer.
 */
describe('PeerAskService — consent is re-checked before anything is read', () => {
  it('SECURITY: refuses to answer when the authorizing grant is no longer in force', async () => {
    const { service, executorService, answerService, auditService } = makeService({
      consentStanding: false,
    });

    const result = await service.handle(PEER, body({ archetype: 'content', subject: 'x' }));

    expect(result.status).toBe('pending_review');
    expect(result.answer).toBeUndefined();
    // Nothing read, nothing written, nothing disclosed.
    expect(executorService.execute).not.toHaveBeenCalled();
    expect(answerService.create).not.toHaveBeenCalled();
    expect(auditService.record).not.toHaveBeenCalled();
  });

  it('sends the withdrawn ask back to the owner with its basis cleared', async () => {
    const { service, askService, askRow } = makeService({ consentStanding: false });

    await service.handle(PEER, body({ archetype: 'content', subject: 'x' }));

    // Exactly where `withdrawPreAuthorization` puts a revoked pre-authorization
    // on the local path.
    expect(askService.systemTransition).toHaveBeenCalledWith('ask-1', 'under_review', {
      consentBasis: null,
    });
    expect(askRow.status).toBe('under_review');
    expect(askRow.consentBasis).toBeNull();
  });

  it('SECURITY: does not read the calendar either — availability is gated by the same check', async () => {
    const { service, eventRepository } = makeService({ consentStanding: false });

    await service.handle(
      PEER,
      body({ archetype: 'availability', from: '2026-09-01T09:00:00Z', to: '2026-09-01T17:00:00Z' }),
    );

    expect(eventRepository.find).not.toHaveBeenCalled();
  });

  it('ORDERING: the check runs AFTER the basis is stamped, or it passes vacuously', async () => {
    const { service, grantService } = makeService();

    await service.handle(PEER, body({ archetype: 'content', subject: 'x' }));

    // `isConsentStanding` returns true for an ask with no basis — there is no
    // standing grant to check. Called before `setConsentBasis`, the check that
    // exists to catch a revoked grant would wave every ask through.
    expect(grantService.isConsentStanding).toHaveBeenCalledWith(
      expect.objectContaining({ consentBasis: 'g1' }),
    );
  });
});
