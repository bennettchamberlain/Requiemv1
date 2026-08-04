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
  const askService = {
    create: jest.fn().mockResolvedValue({
      id: 'ask-1',
      askerUserId: null,
      responderUserId: 'owner-1',
      peerLinkId: 'link-1',
      direction: 'inbound',
      query: { queryType: 'content', prompt: 'q?' },
    }),
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

  it('queues for owner review when no standing grant matches', async () => {
    const { service, executorService } = makeService({ decision: 'review' });

    const result = await service.handle(PEER, body({ archetype: 'content', subject: 'x' }));

    expect(result.status).toBe('pending_review');
    // Nothing executed against the owner's memory without consent.
    expect(executorService.execute).not.toHaveBeenCalled();
  });

  it('answers a relationship ask as a boolean with NO item references', async () => {
    const { service } = makeService();

    const result = await service.handle(PEER, body({ archetype: 'relationship', subject: 'Carol' }));

    expect(result.status).toBe('answered');
    expect(result.answer?.form).toBe('boolean');
    expect(result.answer?.items).toEqual([]);
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
