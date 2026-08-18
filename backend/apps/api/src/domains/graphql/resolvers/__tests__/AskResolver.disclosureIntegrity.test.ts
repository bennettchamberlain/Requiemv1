import { type RequestContext } from '@ci/common/context';
import { type Ask, type AskAnswer } from '@ci/domains/asks';

import { AskAnswerType } from '../../types/AskAnswerType';
import { AskType } from '../../types/AskType';
import { GlobalUID } from '../../types/GlobalUID';
import { AskResolver } from '../AskResolver';

/**
 * The integrity properties of a disclosure, asserted where they broke.
 *
 * Every one of these was reproduced against a live database before it was
 * fixed, so each test names the concrete failure rather than the abstract rule.
 * The common shape of all four: the ask domain decided WHETHER to disclose in
 * one place and WROTE the disclosure in another, with nothing keeping the two
 * in the same order or the same audience.
 */

const RESPONDER = 'responder-1';
const ASKER = 'user-1';

const asResponder = { userId: RESPONDER } as unknown as RequestContext;
const asAsker = { userId: ASKER } as unknown as RequestContext;

function fakeAsk(overrides: Partial<Ask> = {}): Ask {
  return {
    id: 'ask-1',
    askerUserId: ASKER,
    responderUserId: RESPONDER,
    query: { queryType: 'photos', prompt: 'do you have photos of us?' },
    status: 'answering',
    consentBasis: null,
    createdAt: new Date('2026-07-15T00:00:00Z'),
    updatedAt: new Date('2026-07-15T00:00:00Z'),
    expiresAt: null,
    ...overrides,
  } as Ask;
}

function fakeAnswer(overrides: Partial<AskAnswer> = {}): AskAnswer {
  return {
    id: 'answer-1',
    askId: 'ask-1',
    form: 'retrieval',
    answerSource: 'peer',
    summary: 'They shared 4 items.',
    disclosedEntities: [{ id: 'e1', type: 'file' }],
    disclosedCount: 4,
    withheldCount: 2,
    consentBasis: 'grant-abc',
    createdAt: new Date('2026-07-15T00:00:00Z'),
    ...overrides,
  } as AskAnswer;
}

function makeResolver(ask: Ask) {
  const askService = {
    submit: jest.fn(),
    approve: jest.fn(),
    decline: jest.fn(),
    findById: jest.fn().mockResolvedValue(ask),
    complete: jest.fn().mockResolvedValue(fakeAsk({ status: 'answered' })),
    listInbox: jest.fn().mockResolvedValue([]),
    listOutbox: jest.fn().mockResolvedValue([]),
  };
  const answerService = {
    create: jest.fn().mockResolvedValue(fakeAnswer()),
    findByAskId: jest.fn().mockResolvedValue(fakeAnswer()),
  };
  const executorService = { execute: jest.fn().mockResolvedValue([{ id: 'e1', type: 'file' }]) };

  const resolver = new AskResolver(
    askService as never,
    { create: jest.fn(), revoke: jest.fn(), listForOwner: jest.fn() } as never,
    { listForResponder: jest.fn() } as never,
    { consume: jest.fn() } as never,
    executorService as never,
    answerService as never,
    { isFeatureEnabled: jest.fn().mockResolvedValue(true) } as never,
  );

  return { resolver, askService, answerService, executorService };
}

const gid = GlobalUID.encode('ask', 'ask-1');

describe('runAsk — the gate runs before any side effect', () => {
  it.each(['declined', 'answered', 'expired'] as const)(
    'refuses a %s ask WITHOUT writing an answer or running the search',
    async (status) => {
      const { resolver, answerService, executorService } = makeResolver(fakeAsk({ status }));

      await expect(resolver.runAsk(asResponder, gid)).rejects.toThrow(/not ready to answer/);

      // The point of the fix. `complete()` always threw for these — but only
      // AFTER `answerService.create` had persisted a disclosure the asker could
      // read, with no audit row to show for it.
      expect(answerService.create).not.toHaveBeenCalled();
      // And the search never runs for an ask that cannot be answered.
      expect(executorService.execute).not.toHaveBeenCalled();
    },
  );

  it('still answers a delivered ask carrying a standing grant (the auto path)', async () => {
    const { resolver, answerService } = makeResolver(
      fakeAsk({ status: 'delivered', consentBasis: 'grant-abc' }),
    );

    await expect(resolver.runAsk(asResponder, gid)).resolves.toMatchObject({ success: true });
    expect(answerService.create).toHaveBeenCalled();
  });

  it('refuses a delivered ask with NO grant — delivered alone is not authorization', async () => {
    const { resolver, answerService } = makeResolver(fakeAsk({ status: 'delivered' }));

    await expect(resolver.runAsk(asResponder, gid)).rejects.toThrow(/not ready to answer/);
    expect(answerService.create).not.toHaveBeenCalled();
  });
});

describe('askAnswer — an answer is readable only once its ask is terminal', () => {
  it('withholds an answer whose ask never reached answered', async () => {
    // Exactly the row the ordering bug used to leave behind.
    const { resolver } = makeResolver(fakeAsk({ status: 'declined' }));

    await expect(resolver.askAnswer(asAsker, gid)).resolves.toBeNull();
  });

  it('returns it once the ask is answered', async () => {
    const { resolver } = makeResolver(fakeAsk({ status: 'answered' }));

    await expect(resolver.askAnswer(asAsker, gid)).resolves.not.toBeNull();
  });
});

describe('projections — the responder’s reasoning is not the asker’s to read', () => {
  it('hides consentBasis from the asker and from a caller that forgets to say who is looking', () => {
    const ask = fakeAsk({ consentBasis: 'grant-abc' });

    expect(AskType.toType(ask, RESPONDER).consentBasis).toBe('grant-abc');
    expect(AskType.toType(ask, ASKER).consentBasis).toBeNull();
    // Defaulting to the DISCLOSING case is how this leak would come back.
    expect(AskType.toType(ask).consentBasis).toBeNull();
  });

  it('does not hand the asker an exact count on a form that answers yes/no', () => {
    const boolean = fakeAnswer({ form: 'boolean', disclosedCount: 9, withheldCount: 3 });

    // The oracle: "just yes or no" that also reports a precise magnitude, and by
    // varying the prompt, a count oracle over the responder's corpus.
    expect(AskAnswerType.toType(boolean, false).disclosedCount).toBe(0);
    expect(AskAnswerType.toType(boolean, false).withheldCount).toBe(0);
    // The owner keeps their own receipt.
    expect(AskAnswerType.toType(boolean, true).disclosedCount).toBe(9);
  });

  it('still gives the asker the counts on a retrieval answer, where they are the answer', () => {
    const retrieval = fakeAnswer({ form: 'retrieval', disclosedCount: 4, withheldCount: 2 });

    expect(AskAnswerType.toType(retrieval, false).disclosedCount).toBe(4);
    // "2 items withheld" is deliberate: the count is disclosed, never which.
    expect(AskAnswerType.toType(retrieval, false).withheldCount).toBe(2);
  });
});
