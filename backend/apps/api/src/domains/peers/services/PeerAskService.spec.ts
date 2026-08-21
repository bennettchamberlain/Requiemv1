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

function makeService(
  opts: { links?: unknown[]; decision?: string; maxDisclosure?: string; events?: unknown[] } = {},
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
    consentBasis: null,
    query: { queryType: 'content', prompt: 'q?' },
  };
  // The ask ECHOES the query it was created with, rather than pinning a content
  // one for every archetype. The tier ceiling is resolved from
  // `ask.query.dataClass`, so a mock that flattened the three archetypes into
  // one would hide exactly the per-archetype ceiling bug these tests cover.
  let created = baseAsk;
  const askService = {
    create: jest.fn().mockImplementation((_ctx: unknown, data: { query: unknown }) => {
      created = { ...baseAsk, query: data.query as typeof baseAsk.query };

      return Promise.resolve(created);
    }),
    // The lifecycle must actually be persisted — a denied peer ask that stays
    // `delivered` would remain actionable in the owner's inbox.
    systemTransition: jest
      .fn()
      .mockImplementation((_id: string, to: string) => Promise.resolve({ ...created, status: to })),
    setConsentBasis: jest
      .fn()
      .mockImplementation((_id: string, basis: string | null) =>
        Promise.resolve({ ...created, consentBasis: basis }),
      ),
  };
  const grantService = {
    evaluate: jest.fn().mockResolvedValue({
      decision: opts.decision ?? 'auto',
      grantId: 'g1',
      ...(opts.maxDisclosure ? { maxDisclosure: opts.maxDisclosure } : {}),
    }),
  };
  const executorService = { execute: jest.fn().mockResolvedValue([{ id: 'e1', type: 'file' }]) };
  const answerService = { create: jest.fn().mockResolvedValue({}) };
  const auditService = { record: jest.fn().mockResolvedValue(undefined) };
  const eventRepository = { find: jest.fn().mockResolvedValue(opts.events ?? []) };
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
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'declined', peerLinkId: 'link-1' }),
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
    );
  });
});
