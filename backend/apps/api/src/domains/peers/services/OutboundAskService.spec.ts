import { type PeerLink } from '../entities/PeerLinkEntity';

import { OutboundAskService } from './OutboundAskService';

const CTX = { userId: 'user-1' };

function link(overrides: Partial<PeerLink> = {}): PeerLink {
  return {
    id: 'link-1',
    ownerUserId: 'user-1',
    peerHandle: 'devon',
    memoryEndpoint: 'https://devon.example.com/agent/v1',
    trustTier: 'trusted',
    status: 'active',
    ...overrides,
  } as PeerLink;
}

function makeService(overrides: { link?: PeerLink | null; response?: unknown } = {}) {
  const peerLinkService = {
    findByHandle: jest.fn().mockResolvedValue(overrides.link === undefined ? link() : overrides.link),
  };
  const askService = {
    create: jest.fn().mockResolvedValue({
      id: 'ask-1',
      askerUserId: 'user-1',
      responderUserId: null,
      peerLinkId: 'link-1',
      direction: 'outbound',
      query: { queryType: 'content', prompt: 'photos?' },
      status: 'sent',
      consentBasis: null,
    }),
  };
  const auditService = { record: jest.fn().mockResolvedValue(undefined) };
  const client = {
    send: jest.fn().mockResolvedValue(overrides.response ?? { askId: 'x', status: 'answered' }),
  };
  const logger = { setContext: jest.fn(), warn: jest.fn() };

  const service = new OutboundAskService(
    peerLinkService as never,
    askService as never,
    auditService as never,
    client as never,
    logger as never,
  );

  return { service, peerLinkService, askService, auditService, client };
}

const DTO = {
  handle: 'devon',
  prompt: 'Do you have photos of us?',
  request: { archetype: 'content' as const, subject: 'lake trip', dataClass: 'photos' },
};

describe('OutboundAskService.send', () => {
  it('records the ask locally BEFORE the request leaves, so a silent peer is still auditable', async () => {
    const { service, askService, client } = makeService();

    await service.send(CTX as never, DTO, 'token');

    expect(askService.create).toHaveBeenCalledWith(
      CTX,
      expect.objectContaining({ direction: 'outbound', peerLinkId: 'link-1', responderUserId: null }),
    );
    // create happened before send
    expect(askService.create.mock.invocationCallOrder[0]).toBeLessThan(
      client.send.mock.invocationCallOrder[0],
    );
  });

  it('sends a fresh correlation id, never the local row id', async () => {
    const { service, client } = makeService();

    await service.send(CTX as never, DTO, 'token');

    const [, body] = client.send.mock.calls[0];
    expect(body.askId).toBeTruthy();
    expect(body.askId).not.toBe('ask-1'); // the local id must not leak to the peer
  });

  it('refuses an unknown handle and a revoked link identically', async () => {
    for (const bad of [null, link({ status: 'revoked' })]) {
      const { service, client } = makeService({ link: bad });
      await expect(service.send(CTX as never, DTO, 'token')).rejects.toThrow(/No active peer link/);
      expect(client.send).not.toHaveBeenCalled();
    }
  });

  it('requires a peer access token', async () => {
    const { service, client } = makeService();
    await expect(service.send(CTX as never, DTO, '  ')).rejects.toThrow();
    expect(client.send).not.toHaveBeenCalled();
  });

  it('audits an answered reply without claiming WE disclosed anything', async () => {
    const { service, auditService } = makeService({ response: { askId: 'x', status: 'answered' } });

    await service.send(CTX as never, DTO, 'token');

    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'answered', disclosedEntities: [], responderUserId: null }),
    );
  });

  it('records a declined outcome when the peer declines or is unreachable', async () => {
    const { service, auditService } = makeService({
      response: { askId: 'x', status: 'declined', reason: 'Peer unreachable' },
    });

    const result = await service.send(CTX as never, DTO, 'token');

    expect(result.response.status).toBe('declined');
    expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'declined' }));
  });

  it('treats pending_review as not-answered locally', async () => {
    const { service, auditService } = makeService({
      response: { askId: 'x', status: 'pending_review' },
    });

    await service.send(CTX as never, DTO, 'token');

    expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'declined' }));
  });
});
