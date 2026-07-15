import { type RequestContext } from '@ci/common/context';
import { type Ask } from '@ci/domains/asks';

import { GlobalUID } from '../../types/GlobalUID';
import { AskResolver } from '../AskResolver';

const CTX = { userId: 'user-1' } as unknown as RequestContext;

function fakeAsk(): Ask {
  return {
    id: 'ask-1',
    askerUserId: 'user-1',
    responderUserId: 'responder-1',
    query: { queryType: 'photos', prompt: 'do you have photos of us?' },
    status: 'under_review',
    consentBasis: null,
    createdAt: new Date('2026-07-15T00:00:00Z'),
    updatedAt: new Date('2026-07-15T00:00:00Z'),
    expiresAt: null,
  } as Ask;
}

function makeResolver(enabled: boolean) {
  const askService = {
    submit: jest.fn().mockResolvedValue({ ask: fakeAsk(), decision: 'review' }),
    approve: jest.fn(),
    decline: jest.fn(),
    findById: jest.fn(),
    complete: jest.fn(),
    listInbox: jest.fn().mockResolvedValue([fakeAsk()]),
    listOutbox: jest.fn().mockResolvedValue([]),
  };
  const grantService = {
    create: jest.fn(),
    revoke: jest.fn(),
    listForOwner: jest.fn().mockResolvedValue([]),
  };
  const auditService = { listForResponder: jest.fn().mockResolvedValue([]) };
  const rateLimitService = { consume: jest.fn() };
  const executorService = { execute: jest.fn().mockResolvedValue([{ id: 'e1', type: 'file' }]) };
  const featureService = { isFeatureEnabled: jest.fn().mockResolvedValue(enabled) };

  const resolver = new AskResolver(
    askService as never,
    grantService as never,
    auditService as never,
    rateLimitService as never,
    executorService as never,
    featureService as never,
  );

  return { resolver, askService, grantService, rateLimitService, executorService, featureService };
}

describe('AskResolver — feature-flag gating', () => {
  it('is dark when `ask` is disabled: mutations report failure, queries are empty, services untouched', async () => {
    const { resolver, askService, grantService, rateLimitService } = makeResolver(false);

    const created = await resolver.createAsk(CTX, {
      responderId: GlobalUID.encode('user', 'responder-1'),
      query: { queryType: 'photos', prompt: 'hi' },
    });
    expect(created).toEqual({ success: false });
    expect(askService.submit).not.toHaveBeenCalled();
    expect(rateLimitService.consume).not.toHaveBeenCalled(); // no rate budget spent while dark

    expect(await resolver.askInbox(CTX)).toEqual([]);
    expect(askService.listInbox).not.toHaveBeenCalled();
    expect(await resolver.myAskGrants(CTX)).toEqual([]);
    expect(grantService.listForOwner).not.toHaveBeenCalled();
  });
});

describe('AskResolver — enabled', () => {
  it('createAsk rate-limits, decodes the responder id, submits, and surfaces the decision', async () => {
    const { resolver, askService, rateLimitService } = makeResolver(true);

    const result = await resolver.createAsk(CTX, {
      responderId: GlobalUID.encode('user', 'responder-1'),
      query: { queryType: 'photos', dataClass: 'beach', prompt: 'beach photos?' },
    });

    expect(rateLimitService.consume).toHaveBeenCalledWith('user-1');
    expect(askService.submit).toHaveBeenCalledWith(
      { userId: 'user-1' },
      {
        responderUserId: 'responder-1',
        query: { queryType: 'photos', dataClass: 'beach', prompt: 'beach photos?' },
      },
    );
    expect(result.success).toBe(true);
    expect(result.decision).toBe('review');
    expect(result.ask?.status).toBe('under_review');
  });

  it('askInbox maps the responder inbox to GraphQL types', async () => {
    const { resolver } = makeResolver(true);
    const inbox = await resolver.askInbox(CTX);

    expect(inbox).toHaveLength(1);
    // ids are re-encoded as opaque global ids
    expect(GlobalUID.parse('ask', inbox[0].id)).toBe('ask-1');
  });

  it('runAsk executes as the responder, completes the ask, and returns the match count', async () => {
    const { resolver, askService, executorService } = makeResolver(true);
    // caller (user-1) IS the responder of this ask
    const ownAsk = { ...fakeAsk(), responderUserId: 'user-1', status: 'answering' } as Ask;
    askService.findById = jest.fn().mockResolvedValue(ownAsk);
    askService.complete = jest
      .fn()
      .mockResolvedValue({ ...ownAsk, status: 'answered' });

    const result = await resolver.runAsk(CTX, GlobalUID.encode('ask', 'ask-1'));

    expect(executorService.execute).toHaveBeenCalledWith(ownAsk);
    expect(askService.complete).toHaveBeenCalledWith({ userId: 'user-1' }, 'ask-1', ['e1']);
    expect(result.success).toBe(true);
    expect(result.disclosedCount).toBe(1);
    expect(result.ask?.status).toBe('answered');
  });

  it('runAsk refuses when the caller is not the responder', async () => {
    const { resolver, askService, executorService } = makeResolver(true);
    // ask is directed at someone else — caller user-1 is the ASKER, not responder
    askService.findById = jest
      .fn()
      .mockResolvedValue({ ...fakeAsk(), askerUserId: 'user-1', responderUserId: 'someone-else' });

    await expect(resolver.runAsk(CTX, GlobalUID.encode('ask', 'ask-1'))).rejects.toThrow();
    expect(executorService.execute).not.toHaveBeenCalled();
  });
});
