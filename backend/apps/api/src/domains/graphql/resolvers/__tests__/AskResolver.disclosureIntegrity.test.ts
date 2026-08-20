import { type RequestContext } from '@ci/common/context';
import { type Ask, type AskAnswer } from '@ci/domains/asks';

import { AnswerFormEnum, AskAnswerType } from '../../types/AskAnswerType';
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

function makeResolver(
  ask: Ask,
  options: {
    /** What the responder's standing grants say when re-evaluated at run time. */
    evaluation?: unknown;
    /** The asker's peer link, which sets the tier ceiling. Null = household. */
    peerLink?: unknown;
    matches?: { id: string; type: string }[];
  } = {},
) {
  const askService = {
    submit: jest.fn().mockResolvedValue({ ask, decision: 'auto' }),
    approve: jest.fn(),
    decline: jest.fn(),
    findById: jest.fn().mockResolvedValue(ask),
    complete: jest.fn().mockResolvedValue(fakeAsk({ status: 'answered' })),
    completeWithAnswer: jest.fn(),
    listInbox: jest.fn().mockResolvedValue([]),
    listOutbox: jest.fn().mockResolvedValue([]),
  };
  const answerService = {
    create: jest.fn().mockResolvedValue(fakeAnswer()),
    findByAskId: jest.fn().mockResolvedValue(fakeAnswer()),
  };
  const executorService = {
    execute: jest.fn().mockResolvedValue(options.matches ?? [{ id: 'e1', type: 'file' }]),
  };
  const grantService = {
    create: jest.fn(),
    revoke: jest.fn(),
    listForOwner: jest.fn(),
    evaluate: jest.fn().mockResolvedValue(options.evaluation ?? { decision: 'review' }),
  };

  // Stands in for the real transactional service: hands back the answer it was
  // asked to persist, so a test can read the disclosure the resolver built.
  askService.completeWithAnswer = jest.fn(
    async (_ctx: unknown, id: string, disclosure: { answer: Record<string, unknown> }) => ({
      ask: fakeAsk({ status: 'answered' }),
      answer: {
        ...fakeAnswer(),
        ...disclosure.answer,
        askId: id,
        disclosedEntities: disclosure.answer.items,
      },
    }),
  );

  const resolver = new AskResolver(
    askService as never,
    grantService as never,
    { listForResponder: jest.fn() } as never,
    { consume: jest.fn() } as never,
    executorService as never,
    answerService as never,
    { findById: jest.fn().mockResolvedValue(options.peerLink ?? null) } as never,
    { send: jest.fn() } as never,
    { isFeatureEnabled: jest.fn().mockResolvedValue(true) } as never,
  );

  return { resolver, askService, answerService, executorService, grantService };
}

/** The disclosure the resolver actually persisted for the last runAsk. */
function persistedAnswer(askService: { completeWithAnswer: jest.Mock }) {
  return askService.completeWithAnswer.mock.calls[0][2].answer;
}

/** The (disclosed, backing) id pair the resolver sent to the audit. */
function auditedIds(askService: { completeWithAnswer: jest.Mock }) {
  const { disclosedEntityIds, backingEntityIds } = askService.completeWithAnswer.mock.calls[0][2];

  return { disclosedEntityIds, backingEntityIds };
}

const gid = GlobalUID.encode('ask', 'ask-1');

describe('runAsk — the gate runs before any side effect', () => {
  it.each(['declined', 'answered', 'expired'] as const)(
    'refuses a %s ask WITHOUT writing an answer or running the search',
    async (status) => {
      const { resolver, answerService, askService, executorService } = makeResolver(fakeAsk({ status }));

      await expect(resolver.runAsk(asResponder, gid)).rejects.toThrow(/not ready to answer/);

      // The point of the fix. `complete()` always threw for these — but only
      // AFTER `answerService.create` had persisted a disclosure the asker could
      // read, with no audit row to show for it.
      expect(answerService.create).not.toHaveBeenCalled();
      expect(askService.completeWithAnswer).not.toHaveBeenCalled();
      // And the search never runs for an ask that cannot be answered.
      expect(executorService.execute).not.toHaveBeenCalled();
    },
  );

  it('still answers a delivered ask carrying a standing grant (the auto path)', async () => {
    const { resolver, askService } = makeResolver(
      fakeAsk({ status: 'delivered', consentBasis: 'grant-abc' }),
      { evaluation: { decision: 'auto', grantId: 'grant-abc' } },
    );

    await expect(resolver.runAsk(asResponder, gid)).resolves.toMatchObject({ success: true });
    expect(askService.completeWithAnswer).toHaveBeenCalled();
  });

  it('refuses a delivered ask with NO grant — delivered alone is not authorization', async () => {
    const { resolver, askService } = makeResolver(fakeAsk({ status: 'delivered' }));

    await expect(resolver.runAsk(asResponder, gid)).rejects.toThrow(/not ready to answer/);
    expect(askService.completeWithAnswer).not.toHaveBeenCalled();
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

/**
 * The owner's ceiling and the owner's FORM.
 *
 * Both were computed and then dropped: `evaluateGrant` returns the deciding
 * grant's `maxDisclosure` and nothing on the local path read it, while the shape
 * of every answer came from `inferAnswerForm(ask.query)` — which reads the
 * ASKER's `queryType`. Between them the responder had no say in how much of an
 * answer left their box, only in whether one did.
 */
describe('runAsk — the owner decides how much leaves, not the asker', () => {
  const RETRIEVAL_MATCHES = [
    { id: 'e1', type: 'file' },
    { id: 'e2', type: 'file' },
    { id: 'e3', type: 'file' },
  ];

  it('applies the deciding grant’s maxDisclosure, which the local path used to discard', async () => {
    const { resolver, askService } = makeResolver(
      fakeAsk({ status: 'delivered', consentBasis: 'grant-abc' }),
      {
        // "digest only": the grant authorizes the ask and caps it at a yes/no.
        evaluation: { decision: 'auto', grantId: 'grant-abc', maxDisclosure: 'boolean' },
        matches: RETRIEVAL_MATCHES,
      },
    );

    const result = await resolver.runAsk(asResponder, gid);

    // Unclamped this is a 3-item retrieval answer. The grant says otherwise.
    const answer = persistedAnswer(askService);
    expect(answer.items).toEqual([]);
    expect(answer.disclosedCount).toBe(1); // boolean rung: presence, not magnitude
    expect(answer.summary).toBe('Yes.');
    expect(result.disclosedCount).toBe(1);
  });

  it('combines the grant ceiling with the tier ceiling by taking the LESSER', async () => {
    // `family` tier would allow `full`; the grant caps at `count`.
    const { resolver, askService } = makeResolver(
      fakeAsk({ status: 'delivered', consentBasis: 'grant-abc', peerLinkId: 'link-1' }),
      {
        evaluation: { decision: 'auto', grantId: 'grant-abc', maxDisclosure: 'count' },
        peerLink: { trustTier: 'family' },
        matches: RETRIEVAL_MATCHES,
      },
    );

    await resolver.runAsk(asResponder, gid);

    const answer = persistedAnswer(askService);
    expect(answer.items).toEqual([]);
    expect(answer.summary).toBe('3 matching items.');
  });

  it('lets a generous grant do nothing when the TIER is the tighter of the two', async () => {
    // The converse direction, so the min is proved rather than the grant simply
    // replacing the tier: `stranger` caps at `boolean` however open the grant is.
    const { resolver, askService } = makeResolver(
      fakeAsk({ status: 'delivered', consentBasis: 'grant-abc', peerLinkId: 'link-1' }),
      {
        evaluation: { decision: 'auto', grantId: 'grant-abc', maxDisclosure: 'full' },
        peerLink: { trustTier: 'stranger' },
        matches: RETRIEVAL_MATCHES,
      },
    );

    await resolver.runAsk(asResponder, gid);

    expect(persistedAnswer(askService).summary).toBe('Yes.');
  });

  it('discloses nothing when a block grant now covers the ask', async () => {
    const { resolver, askService } = makeResolver(
      fakeAsk({ status: 'delivered', consentBasis: 'grant-abc' }),
      { evaluation: { decision: 'deny', grantId: 'grant-block' }, matches: RETRIEVAL_MATCHES },
    );

    await resolver.runAsk(asResponder, gid);

    const answer = persistedAnswer(askService);
    expect(answer.disclosedCount).toBe(0);
    expect(answer.summary).toBe('Nothing was shared.');
  });

  it('honours the owner’s chosen form over the archetype the ASKER supplied', async () => {
    const { resolver, askService } = makeResolver(fakeAsk({ status: 'answering' }), {
      matches: RETRIEVAL_MATCHES,
    });

    // The ask says `photos` → retrieval. The owner answers it as a yes/no.
    await resolver.runAsk(asResponder, gid, undefined, AnswerFormEnum.boolean);

    const answer = persistedAnswer(askService);
    expect(answer.form).toBe('boolean'); // persisted, and within the ask_answers CHECK
    expect(answer.items).toEqual([]);
    expect(answer.disclosedCount).toBe(1);
  });

  it('refuses to let the owner’s choice WIDEN what the archetype implies', async () => {
    // A relationship ask is a yes/no. Asking for `retrieval` must not turn it
    // into one — otherwise the argument is a disclosure escalation, not a limit.
    const { resolver, askService } = makeResolver(
      fakeAsk({ status: 'answering', query: { queryType: 'relationship', prompt: 'do you know bo?' } }),
      { matches: RETRIEVAL_MATCHES },
    );

    await resolver.runAsk(asResponder, gid, undefined, AnswerFormEnum.retrieval);

    const answer = persistedAnswer(askService);
    expect(answer.form).toBe('boolean');
    expect(answer.items).toEqual([]);
  });
});

/**
 * The audit and the answer are two records of ONE disclosure. They disagreed:
 * the audit was written from the pre-ceiling match set while ci.ask_answers kept
 * the post-clamp result, so every clamped answer was audited as if the whole
 * candidate set had gone out.
 */
describe('runAsk — the audit records what was disclosed, not what was considered', () => {
  it('separates the disclosed references from the backing set when the ceiling bites', async () => {
    const { resolver, askService } = makeResolver(
      fakeAsk({ status: 'delivered', consentBasis: 'grant-abc' }),
      {
        evaluation: { decision: 'auto', grantId: 'grant-abc', maxDisclosure: 'count' },
        matches: [
          { id: 'e1', type: 'file' },
          { id: 'e2', type: 'file' },
          { id: 'e3', type: 'file' },
        ],
      },
    );

    await resolver.runAsk(asResponder, gid);

    const { disclosedEntityIds, backingEntityIds } = auditedIds(askService);
    // Nothing was itemized to the asker, so nothing is audited as disclosed…
    expect(disclosedEntityIds).toEqual([]);
    // …but what the box read on their behalf is still recorded, under its own name.
    expect(backingEntityIds).toEqual(['e1', 'e2', 'e3']);
    // And the answer agrees with the audit rather than contradicting it.
    expect(persistedAnswer(askService).items).toEqual([]);
  });

  it('never audits a redacted entity, in either field', async () => {
    const { resolver, askService } = makeResolver(fakeAsk({ status: 'answering' }), {
      matches: [
        { id: 'e1', type: 'file' },
        { id: 'secret', type: 'file' },
      ],
    });

    await resolver.runAsk(asResponder, gid, ['secret']);

    const { disclosedEntityIds, backingEntityIds } = auditedIds(askService);
    expect(disclosedEntityIds).toEqual(['e1']);
    expect(backingEntityIds).toEqual(['e1']);
  });
});

/**
 * #2042 gated the numeric count for forms that do not itemize. The count left by
 * the other two doors anyway.
 */
describe('projections — the count oracle has more than one exit', () => {
  it('strips the count from the SUMMARY, where zeroing the field did not reach', () => {
    // Exactly what `applyDisclosureCeiling` writes at the `count` rung.
    const existence = fakeAnswer({
      form: 'existence',
      summary: '3 matching items.',
      disclosedCount: 3,
      withheldCount: 0,
    });

    const toAsker = AskAnswerType.toType(existence, false);
    expect(toAsker.disclosedCount).toBe(0);
    // The number must not survive in prose either — same oracle, different column.
    expect(toAsker.summary).not.toMatch(/\d/);
    expect(toAsker.summary).toBe('They have at least one matching item.');

    // The owner keeps their own receipt, wording included.
    expect(AskAnswerType.toType(existence, true).summary).toBe('3 matching items.');
  });

  it('says nothing rather than something when the ceiling withheld everything', () => {
    const withheld = fakeAnswer({ form: 'existence', summary: 'Nothing was shared.', disclosedCount: 0 });

    expect(AskAnswerType.toType(withheld, false).summary).toBe('They have none.');
  });

  it('does not ship item references on a form that answers yes/no', () => {
    // A row that should never exist — but "should never" is not an invariant the
    // projection can verify, and it used to emit whatever it was handed.
    const boolean = fakeAnswer({
      form: 'boolean',
      summary: 'Yes.',
      disclosedEntities: [{ id: 'private-file-1', type: 'file' }],
      disclosedCount: 1,
    });

    expect(AskAnswerType.toType(boolean, false).items).toEqual([]);
    // Not an audience question: the form does not itemize for ANYONE.
    expect(AskAnswerType.toType(boolean, true).items).toEqual([]);
    // The retrieval form is unaffected — there the references ARE the answer.
    expect(AskAnswerType.toType(fakeAnswer(), false).items).toEqual([{ id: 'e1', type: 'file' }]);
  });
});

/**
 * `createAsk` returned the responder's standing-grant decision to the asker,
 * synchronously. Combined with the rate limit that is a probe against the grant
 * matrix — vary queryType/dataClass, read back `auto` | `review` | `deny`, and
 * map the responder's policy without ever receiving an answer.
 */
describe('createAsk — the responder’s policy posture is not part of the receipt', () => {
  it.each(['auto', 'review', 'deny'] as const)(
    'returns the same acknowledgement whatever the grant decision was (%s)',
    async (decision) => {
      const ask = fakeAsk();
      const { resolver, askService } = makeResolver(ask);
      askService.submit = jest.fn().mockResolvedValue({ ask, decision });

      const result = await resolver.createAsk(asAsker, {
        responderId: GlobalUID.encode('user', RESPONDER),
        query: { queryType: 'photos', prompt: 'photos of us?' },
      });

      expect(result.success).toBe(true);
      expect(result.decision).toBe('accepted');
      // Belt and braces: the raw vocabulary must not appear at all.
      expect(['auto', 'review', 'deny']).not.toContain(result.decision);
    },
  );
});
