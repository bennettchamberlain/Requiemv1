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

function makeService(opts: { links?: unknown[]; decision?: string } = {}) {
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
  const askService = {
    create: jest.fn().mockResolvedValue(baseAsk),
    // The lifecycle must actually be persisted — a denied peer ask that stays
    // `delivered` would remain actionable in the owner's inbox.
    systemTransition: jest
      .fn()
      .mockImplementation((_id: string, to: string) => Promise.resolve({ ...baseAsk, status: to })),
    setConsentBasis: jest
      .fn()
      .mockImplementation((_id: string, basis: string | null) =>
        Promise.resolve({ ...baseAsk, consentBasis: basis }),
      ),
  };
  const grantService = {
    evaluate: jest.fn().mockResolvedValue({ decision: opts.decision ?? 'auto', grantId: 'g1' }),
  };
  const executorService = { execute: jest.fn().mockResolvedValue([{ id: 'e1', type: 'file' }]) };
  const answerService = { create: jest.fn().mockResolvedValue({}) };
  const auditService = { record: jest.fn().mockResolvedValue(undefined) };
  const eventRepository = { find: jest.fn().mockResolvedValue([]) };
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

  it('records which grant auto-authorized an ask as its consent basis', async () => {
    const { service, askService } = makeService({ decision: 'auto' });

    await service.handle(PEER, body({ archetype: 'content', subject: 'x' }));

    expect(askService.setConsentBasis).toHaveBeenCalledWith('ask-1', 'g1');
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
