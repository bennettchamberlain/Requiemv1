import type { LoggerService } from '@ci/common/logging';
import config from '@ci/configuration';
import type { RecallService } from '@ci/domains/agent';
import type { EventPayloads, Events } from '@ci/domains/events';
import type { Answer, AnswerService, QuestionService } from '@ci/domains/intelligence';
import type { OllamaService } from '@ci/domains/llm';
import type { UserContextService } from '@ci/domains/memory';
import type { PersonalizationService } from '@ci/domains/personalization';
import type { SearchService } from '@ci/domains/search-next';

import { AnswerInferenceListener } from '../AnswerInferenceListener';

type Payload = EventPayloads[Events.INFER_QUESTION_ANSWER];

/**
 * What the model is contracted to return: answer + confidence + rationale, as
 * strict JSON. The default is deliberately well above the floor and above the
 * evidence ceiling for a bare prompt, so the confidence a test asserts on is the
 * calibrated one rather than whatever the model claimed.
 */
function structuredResponse(
  overrides: { answer?: string; confidence?: number; rationale?: string } = {},
): string {
  return JSON.stringify({
    answer: 'Blue, definitely blue.',
    confidence: 0.9,
    rationale: 'You named blue in two prior answers.',
    ...overrides,
  });
}

/**
 * The evidence ceiling for a listener built with no dossier, no related answers
 * and no retrieved memory — {@link estimateInferredAnswerConfidence}(0, false, 0).
 * Every default build in this file hits it, so it is the confidence the writes
 * carry.
 */
const BARE_CONTEXT_CONFIDENCE = 0.45;

function makeQuestion(id: string, text: string) {
  return { id, text } as Awaited<ReturnType<QuestionService['findById']>>;
}

function makeAnswer(
  overrides: {
    id?: string;
    answer?: string;
    answeredAt?: Date;
    question?: { id: string };
    answerSource?: string;
  } = {},
): Answer {
  return {
    id: 'ans-existing',
    answer: 'previous answer',
    answeredAt: new Date('2026-01-01T00:00:00Z'),
    question: { id: 'other-question' },
    // Defaults to a prior write from THIS listener, since most callers just need
    // "some existing answer" for unrelated assertions (related-answers context,
    // etc). Tests of the overwrite gate itself override this explicitly.
    answerSource: 'inferred',
    ...overrides,
  } as unknown as Answer;
}

function buildListener(overrides: {
  answerService?: Partial<AnswerService>;
  questionService?: Partial<QuestionService>;
  searchService?: Partial<SearchService>;
  recallService?: Partial<RecallService>;
  userContextService?: Partial<UserContextService>;
  personalizationService?: Partial<PersonalizationService>;
  ollamaService?: Partial<OllamaService>;
}) {
  const answerService = {
    findByQuestionId: jest.fn().mockResolvedValue(null),
    findByIds: jest.fn().mockResolvedValue([]),
    findAll: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue(makeAnswer()),
    update: jest.fn().mockResolvedValue(makeAnswer()),
    ...overrides.answerService,
  } as unknown as AnswerService;

  const questionService = {
    findById: jest.fn().mockResolvedValue(makeQuestion('q-1', 'What is your favorite color?')),
    ...overrides.questionService,
  } as unknown as QuestionService;

  const searchService = {
    search: jest.fn().mockResolvedValue([]),
    ...overrides.searchService,
  } as unknown as SearchService;

  // Defaults to "the corpus had nothing for this question", which is the bare
  // case every pre-existing test in this file was written against.
  const recallService = {
    recall: jest.fn().mockResolvedValue({ block: '', resultCount: 0 }),
    ...overrides.recallService,
  } as unknown as RecallService;

  const userContextService = {
    getUserContextForLLM: jest.fn().mockResolvedValue(null),
    formatContextForSystemPrompt: jest.fn().mockReturnValue(''),
    ...overrides.userContextService,
  } as unknown as UserContextService;

  const personalizationService = {
    decideAction: jest.fn().mockResolvedValue('auto'),
    ...overrides.personalizationService,
  } as unknown as PersonalizationService;

  const ollamaService = {
    chat: jest.fn().mockResolvedValue({ message: { content: structuredResponse() } }),
    ...overrides.ollamaService,
  } as unknown as OllamaService;

  const logger = { setContext() {}, log() {}, warn() {}, error() {} } as unknown as LoggerService;

  const listener = new AnswerInferenceListener(
    answerService,
    questionService,
    searchService,
    recallService,
    userContextService,
    personalizationService,
    ollamaService,
    logger,
  );

  return {
    listener,
    answerService,
    questionService,
    searchService,
    recallService,
    userContextService,
    personalizationService,
    ollamaService,
  };
}

describe('AnswerInferenceListener.inferQuestionAnswer — early exits', () => {
  it('skips (no LLM call) when the payload has no owner', async () => {
    const { listener, questionService, ollamaService } = buildListener({});

    await listener.inferQuestionAnswer({ ownerId: null, questionId: 'q-1' } as Payload);

    expect(questionService.findById).not.toHaveBeenCalled();
    expect(ollamaService.chat).not.toHaveBeenCalled();
  });

  it('skips when the question no longer exists', async () => {
    const { listener, ollamaService, questionService } = buildListener({
      questionService: { findById: jest.fn().mockResolvedValue(null) },
    });

    await listener.inferQuestionAnswer({ ownerId: 'user-1', questionId: 'q-1' } as Payload);

    expect(questionService.findById).toHaveBeenCalled();
    expect(ollamaService.chat).not.toHaveBeenCalled();
  });

  it('does not write an answer when the LLM returns empty/whitespace-only content', async () => {
    const { listener, answerService } = buildListener({
      ollamaService: { chat: jest.fn().mockResolvedValue({ message: { content: '   ' } }) },
    });

    await listener.inferQuestionAnswer({ ownerId: 'user-1', questionId: 'q-1' } as Payload);

    expect(answerService.create).not.toHaveBeenCalled();
    expect(answerService.update).not.toHaveBeenCalled();
  });

  it('continues (with an empty dossier) when the dossier fetch throws', async () => {
    const { listener, ollamaService } = buildListener({
      userContextService: {
        getUserContextForLLM: jest.fn().mockRejectedValue(new Error('dossier fetch failed')),
      },
    });

    await expect(
      listener.inferQuestionAnswer({ ownerId: 'user-1', questionId: 'q-1' } as Payload),
    ).resolves.not.toThrow();
    expect(ollamaService.chat).toHaveBeenCalled();
  });
});

describe('AnswerInferenceListener.inferQuestionAnswer — confidence floor', () => {
  it('writes NOTHING when the model reports a confidence below the floor', async () => {
    // The whole point of the feature: a question the appliance cannot answer
    // well is left unanswered rather than filled with a fabrication that will
    // sit in the user's memory looking exactly like something they said.
    const { listener, answerService, personalizationService } = buildListener({
      ollamaService: {
        chat: jest.fn().mockResolvedValue({
          message: { content: structuredResponse({ confidence: 0.2, rationale: 'Nothing to go on.' }) },
        }),
      },
    });

    await listener.inferQuestionAnswer({ ownerId: 'user-1', questionId: 'q-1' } as Payload);

    expect(answerService.create).not.toHaveBeenCalled();
    expect(answerService.update).not.toHaveBeenCalled();
    // Refused before the trust gate — a low-confidence answer is not something
    // to queue for review either, it is something not to have written.
    expect(personalizationService.decideAction).not.toHaveBeenCalled();
  });

  it('writes an answer whose confidence sits exactly on the floor', async () => {
    const { listener, answerService } = buildListener({
      ollamaService: {
        chat: jest.fn().mockResolvedValue({ message: { content: structuredResponse({ confidence: 0.4 }) } }),
      },
    });

    await listener.inferQuestionAnswer({ ownerId: 'user-1', questionId: 'q-1' } as Payload);

    expect(answerService.create).toHaveBeenCalledWith(
      { userId: 'user-1' },
      expect.objectContaining({ answerConfidence: 0.4 }),
    );
  });

  it('persists the model score capped by the evidence actually in the prompt', async () => {
    // A model handed a dossier and six prior answers may legitimately be sure;
    // one handed nothing may not, however sure it sounds. Both defaults here are
    // the bare case, so the confident 0.9 is capped to the bare-context ceiling.
    const { listener, answerService } = buildListener({
      ollamaService: {
        chat: jest.fn().mockResolvedValue({ message: { content: structuredResponse({ confidence: 0.95 }) } }),
      },
    });

    await listener.inferQuestionAnswer({ ownerId: 'user-1', questionId: 'q-1' } as Payload);

    expect(answerService.create).toHaveBeenCalledWith(
      { userId: 'user-1' },
      expect.objectContaining({ answerConfidence: BARE_CONTEXT_CONFIDENCE }),
    );
  });

  it('writes nothing when the model answers in prose instead of the schema', async () => {
    // No score means no way to hold the floor against it, and a substituted
    // default would be a number no model ever produced.
    const { listener, answerService } = buildListener({
      ollamaService: {
        chat: jest.fn().mockResolvedValue({ message: { content: 'Blue, I reckon. Pretty sure.' } }),
      },
    });

    await listener.inferQuestionAnswer({ ownerId: 'user-1', questionId: 'q-1' } as Payload);

    expect(answerService.create).not.toHaveBeenCalled();
    expect(answerService.update).not.toHaveBeenCalled();
  });

  it('asks the model for the structured shape rather than prose', async () => {
    const { listener, ollamaService } = buildListener({});

    await listener.inferQuestionAnswer({ ownerId: 'user-1', questionId: 'q-1' } as Payload);

    const [, , options] = (ollamaService.chat as jest.Mock).mock.calls[0] as [
      unknown,
      unknown,
      { format?: Record<string, unknown> },
    ];
    expect(options.format).toMatchObject({ required: ['answer', 'confidence', 'rationale'] });
  });

  it('states the confidence scale to the model in the system prompt', async () => {
    const { listener, ollamaService } = buildListener({});

    await listener.inferQuestionAnswer({ ownerId: 'user-1', questionId: 'q-1' } as Payload);

    const [, ragThread] = (ollamaService.chat as jest.Mock).mock.calls[0] as [
      unknown,
      Array<{ content: string }>,
    ];
    expect(ragThread[0].content).toContain('confidence');
    expect(ragThread[0].content).toContain('rationale');
  });
});

describe('AnswerInferenceListener.inferQuestionAnswer — refusals are never written', () => {
  it('writes nothing when the model refuses, however confident it says it is', async () => {
    // The measured failure, end to end: three restaurant visits retrieved, the
    // model answers "I do not have this information recorded." and scores that
    // refusal 0.7 — above the 0.4 floor meant to filter it out. Persisted, it
    // would sit in ci.answers looking exactly like something the user typed.
    const { listener, answerService, personalizationService } = buildListener({
      recallService: {
        recall: jest.fn().mockResolvedValue({
          block: '## Relevant context\n[Browser] Directions to Choya Japanese Cuisine, Dana Point, CA',
          resultCount: 6,
        }),
      },
      ollamaService: {
        chat: jest.fn().mockResolvedValue({
          message: {
            content: structuredResponse({
              answer: 'I do not have this information recorded.',
              confidence: 0.7,
              rationale: 'No line states a favorite cuisine.',
            }),
          },
        }),
      },
    });

    await listener.inferQuestionAnswer({ ownerId: 'user-1', questionId: 'q-1' } as Payload);

    expect(answerService.create).not.toHaveBeenCalled();
    expect(answerService.update).not.toHaveBeenCalled();
    // Dropped outright, not queued for a human to look at — there is nothing
    // here for a reviewer to approve.
    expect(personalizationService.decideAction).not.toHaveBeenCalled();
  });

  it.each([
    "I don't know.",
    'Unknown',
    'No information available.',
    'The evidence does not mention any cuisine.',
  ])('writes nothing for the refusal %p', async (answer) => {
    const { listener, answerService } = buildListener({
      ollamaService: {
        chat: jest.fn().mockResolvedValue({
          message: { content: structuredResponse({ answer, confidence: 0.95 }) },
        }),
      },
    });

    await listener.inferQuestionAnswer({ ownerId: 'user-1', questionId: 'q-1' } as Payload);

    expect(answerService.create).not.toHaveBeenCalled();
    expect(answerService.update).not.toHaveBeenCalled();
  });

  it('still refuses a refusal when the owner has lowered the confidence floor beneath the clamp', async () => {
    // Isolates the listener's own gate from the parser's clamp. The clamp puts a
    // refusal at CONFIDENCE_NON_ANSWER (0.1), which the default 0.4 floor throws
    // out — but `reflection.minAnswerConfidence` is owner-configurable, and an
    // owner who set it to 0 would otherwise get "I don't know." written into
    // ci.answers as though they had said it.
    const reflection = config.reflection as { minAnswerConfidence: number };
    const originalFloor = reflection.minAnswerConfidence;
    reflection.minAnswerConfidence = 0;

    try {
      const { listener, answerService } = buildListener({
        ollamaService: {
          chat: jest.fn().mockResolvedValue({
            message: {
              content: structuredResponse({
                answer: 'I do not have this information recorded.',
                confidence: 0.7,
              }),
            },
          }),
        },
      });

      await listener.inferQuestionAnswer({ ownerId: 'user-1', questionId: 'q-1' } as Payload);

      expect(answerService.create).not.toHaveBeenCalled();
      expect(answerService.update).not.toHaveBeenCalled();
    } finally {
      reflection.minAnswerConfidence = originalFloor;
    }
  });

  it('DOES write the synthesized answer the same evidence should have produced', async () => {
    // The other half of the fix, and the half a refusal-blocker alone would not
    // give you: naming what three restaurant visits actually show is a real
    // answer and must survive every gate.
    const { listener, answerService } = buildListener({
      recallService: {
        recall: jest.fn().mockResolvedValue({
          block: '## Relevant context\n[Browser] Directions to Choya Japanese Cuisine, Dana Point, CA',
          resultCount: 6,
        }),
      },
      ollamaService: {
        chat: jest.fn().mockResolvedValue({
          message: {
            content: structuredResponse({
              answer: 'Japanese, Mexican and Thai — I eat across all three.',
              confidence: 0.55,
              rationale: 'Three restaurants looked up in browser history.',
            }),
          },
        }),
      },
    });

    await listener.inferQuestionAnswer({ ownerId: 'user-1', questionId: 'q-1' } as Payload);

    expect(answerService.create).toHaveBeenCalledWith(
      { userId: 'user-1' },
      expect.objectContaining({
        text: 'Japanese, Mexican and Thai — I eat across all three.',
        answerConfidence: 0.55,
      }),
    );
  });
});

describe('AnswerInferenceListener.inferQuestionAnswer — personalization decision gate', () => {
  it('writes nothing when the decision is "review" (left for the context prompt instead)', async () => {
    const { listener, answerService } = buildListener({
      personalizationService: { decideAction: jest.fn().mockResolvedValue('review') },
    });

    await listener.inferQuestionAnswer({ ownerId: 'user-1', questionId: 'q-1' } as Payload);

    expect(answerService.create).not.toHaveBeenCalled();
    expect(answerService.update).not.toHaveBeenCalled();
  });

  it('writes nothing when the decision is "skip"', async () => {
    const { listener, answerService } = buildListener({
      personalizationService: { decideAction: jest.fn().mockResolvedValue('skip') },
    });

    await listener.inferQuestionAnswer({ ownerId: 'user-1', questionId: 'q-1' } as Payload);

    expect(answerService.create).not.toHaveBeenCalled();
    expect(answerService.update).not.toHaveBeenCalled();
  });
});

describe('AnswerInferenceListener.inferQuestionAnswer — update vs create', () => {
  it('creates a new inferred answer when the user has not answered the question yet', async () => {
    const { listener, answerService } = buildListener({
      answerService: { findByQuestionId: jest.fn().mockResolvedValue(null) },
    });

    await listener.inferQuestionAnswer({ ownerId: 'user-1', questionId: 'q-1' } as Payload);

    expect(answerService.create).toHaveBeenCalledWith(
      { userId: 'user-1' },
      {
        text: 'Blue, definitely blue.',
        question: { id: 'q-1' },
        answerMethod: 'inferred',
        answerSource: 'inferred',
        answerConfidence: BARE_CONTEXT_CONFIDENCE,
        answerRationale: 'You named blue in two prior answers.',
      },
    );
    expect(answerService.update).not.toHaveBeenCalled();
  });

  it('updates the EXISTING answer in place instead of creating a duplicate when one already exists', async () => {
    // A row this same path wrote before (answerSource: 'inferred') is fair game
    // to refresh — that is the intended re-inference path, not the overwrite bug.
    const existing = makeAnswer({ id: 'ans-42', answerSource: 'inferred' });
    const { listener, answerService } = buildListener({
      answerService: { findByQuestionId: jest.fn().mockResolvedValue(existing) },
    });

    await listener.inferQuestionAnswer({ ownerId: 'user-1', questionId: 'q-1' } as Payload);

    expect(answerService.update).toHaveBeenCalledWith({ userId: 'user-1' }, 'ans-42', {
      text: 'Blue, definitely blue.',
      answerMethod: 'inferred',
      answerSource: 'inferred',
      answerConfidence: BARE_CONTEXT_CONFIDENCE,
      answerRationale: 'You named blue in two prior answers.',
    });
    expect(answerService.create).not.toHaveBeenCalled();
  });

  it('does NOT overwrite a real user-authored answer — the worst-case failure mode', async () => {
    // The scenario the audit flagged: a pre-existing, user-typed answer must
    // never be silently replaced just because an answer already exists for the
    // question. The gate is answerSource, not "does a row exist" — see
    // AnswerProvenance on the frontend, which keys the same "Inferred" vs
    // "Manual" distinction off this exact field.
    const userWritten = makeAnswer({
      id: 'ans-user',
      answer: 'I picked green myself.',
      answerSource: 'user_input',
    });
    const { listener, answerService } = buildListener({
      answerService: { findByQuestionId: jest.fn().mockResolvedValue(userWritten) },
    });

    await listener.inferQuestionAnswer({ ownerId: 'user-1', questionId: 'q-1' } as Payload);

    expect(answerService.update).not.toHaveBeenCalled();
    expect(answerService.create).not.toHaveBeenCalled();
  });
});

describe('AnswerInferenceListener.findRelatedAnswers (via inferQuestionAnswer)', () => {
  it('resolves semantic search hits into related answers, passed to the LLM prompt', async () => {
    const hit1 = makeAnswer({ id: 'hit-1', answer: 'Loves hiking', question: { id: 'q-other-1' } });
    const { listener, searchService, answerService, ollamaService } = buildListener({
      searchService: { search: jest.fn().mockResolvedValue([{ id: 'hit-1' }]) },
      answerService: {
        findByQuestionId: jest.fn().mockResolvedValue(null),
        findByIds: jest.fn().mockResolvedValue([hit1]),
      },
    });

    await listener.inferQuestionAnswer({ ownerId: 'user-1', questionId: 'q-1' } as Payload);

    expect(searchService.search).toHaveBeenCalledWith(
      { userId: 'user-1' },
      expect.objectContaining({ mode: 'boosted', includeTypes: ['answer'] }),
    );
    expect(answerService.findByIds).toHaveBeenCalledWith({ userId: 'user-1' }, ['hit-1']);

    const [, ragThread] = (ollamaService.chat as jest.Mock).mock.calls[0] as [
      unknown,
      Array<{ content: string }>,
    ];
    expect(ragThread[0].content).toContain('Loves hiking');
  });

  it('excludes the question being answered from its own related-answers context', async () => {
    const selfAnswer = makeAnswer({ id: 'self', answer: 'excluded-self-text', question: { id: 'q-1' } });
    const other = makeAnswer({ id: 'other', answer: 'included-other-text', question: { id: 'q-2' } });
    const { listener, ollamaService } = buildListener({
      searchService: { search: jest.fn().mockResolvedValue([{ id: 'self' }, { id: 'other' }]) },
      answerService: {
        findByQuestionId: jest.fn().mockResolvedValue(null),
        findByIds: jest.fn().mockResolvedValue([selfAnswer, other]),
      },
    });

    await listener.inferQuestionAnswer({ ownerId: 'user-1', questionId: 'q-1' } as Payload);

    const [, ragThread] = (ollamaService.chat as jest.Mock).mock.calls[0] as [
      unknown,
      Array<{ content: string }>,
    ];
    expect(ragThread[0].content).not.toContain('excluded-self-text');
    expect(ragThread[0].content).toContain('included-other-text');
  });

  it('falls back to recent answers when semantic search throws', async () => {
    const recent = makeAnswer({ id: 'recent-1', answer: 'fallback answer', question: { id: 'q-9' } });
    const { listener, answerService, ollamaService } = buildListener({
      searchService: { search: jest.fn().mockRejectedValue(new Error('search index down')) },
      answerService: {
        findByQuestionId: jest.fn().mockResolvedValue(null),
        findAll: jest.fn().mockResolvedValue([recent]),
      },
    });

    await expect(
      listener.inferQuestionAnswer({ ownerId: 'user-1', questionId: 'q-1' } as Payload),
    ).resolves.not.toThrow();

    expect(answerService.findAll).toHaveBeenCalled();
    const [, ragThread] = (ollamaService.chat as jest.Mock).mock.calls[0] as [
      unknown,
      Array<{ content: string }>,
    ];
    expect(ragThread[0].content).toContain('fallback answer');
  });

  it('supplements thin semantic results (< 3 hits) with recent answers, newest first', async () => {
    const semanticHit = makeAnswer({ id: 'semantic-1', answer: 'from search', question: { id: 'q-a' } });
    const older = makeAnswer({
      id: 'recent-old',
      answer: 'older recent',
      question: { id: 'q-b' },
      answeredAt: new Date('2026-01-01T00:00:00Z'),
    });
    const newer = makeAnswer({
      id: 'recent-new',
      answer: 'newer recent',
      question: { id: 'q-c' },
      answeredAt: new Date('2026-06-01T00:00:00Z'),
    });

    const { listener, ollamaService } = buildListener({
      searchService: { search: jest.fn().mockResolvedValue([{ id: 'semantic-1' }]) },
      answerService: {
        findByQuestionId: jest.fn().mockResolvedValue(null),
        findByIds: jest.fn().mockResolvedValue([semanticHit]),
        findAll: jest.fn().mockResolvedValue([older, newer]),
      },
    });

    await listener.inferQuestionAnswer({ ownerId: 'user-1', questionId: 'q-1' } as Payload);

    const [, ragThread] = (ollamaService.chat as jest.Mock).mock.calls[0] as [
      unknown,
      Array<{ content: string }>,
    ];
    const content = ragThread[0].content;
    expect(content).toContain('from search');
    expect(content).toContain('newer recent');
    expect(content).toContain('older recent');
    // Newest-first ordering among the recent-answers fallback.
    expect(content.indexOf('newer recent')).toBeLessThan(content.indexOf('older recent'));
  });

  it('does not fall back to recent answers when semantic search already returned >= 3 hits', async () => {
    const hits = ['h1', 'h2', 'h3'].map((id) => makeAnswer({ id, answer: id, question: { id: `q-${id}` } }));
    const { listener, answerService } = buildListener({
      searchService: { search: jest.fn().mockResolvedValue(hits.map((h) => ({ id: h.id }))) },
      answerService: {
        findByQuestionId: jest.fn().mockResolvedValue(null),
        findByIds: jest.fn().mockResolvedValue(hits),
      },
    });

    await listener.inferQuestionAnswer({ ownerId: 'user-1', questionId: 'q-1' } as Payload);

    expect(answerService.findAll).not.toHaveBeenCalled();
  });
});

describe('AnswerInferenceListener — grounding in the user’s own memory', () => {
  /** A recall block shaped like the real one: labelled, dated, one line each. */
  function recallBlock(lines: string[]) {
    return { block: `## Relevant context\n${lines.join('\n')}`, resultCount: lines.length };
  }

  it('retrieves against the whole indexed corpus, not just prior answers', async () => {
    // The bug this feature exists to fix: the only retrieval the listener did
    // was scoped `includeTypes: ['answer']`, i.e. a few dozen rows out of the
    // ~900k the user has indexed. The corpus leg must be its own call.
    const { listener, recallService } = buildListener({});

    await listener.inferQuestionAnswer({ ownerId: 'user-1', questionId: 'q-1' } as Payload);

    expect(recallService.recall).toHaveBeenCalledWith(
      { userId: 'user-1' },
      expect.objectContaining({ query: 'What is your favorite color?' }),
      expect.anything(),
    );
  });

  it('retrieves with the precision-first strategy, not the agent-lookup default', async () => {
    // The default strategy seeds with an OR-joined keyword search, which on a
    // question answers "What city do you live in?" with song titles carrying the
    // word City. Evidence for an inferred answer has to clear a higher bar than
    // an agent looking something up, so this call site asks for 'grounded'.
    const { listener, recallService } = buildListener({});

    await listener.inferQuestionAnswer({ ownerId: 'user-1', questionId: 'q-1' } as Payload);

    expect(recallService.recall).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ strategy: 'grounded' }),
    );
  });

  it('keeps ci.answers out of the evidence, so its own past output is not evidence', async () => {
    // Every row in ci.answers was written by THIS listener. Retrieving them as
    // "evidence from the user's own imported memory" feeds the model its own
    // prior output — and most of those rows say "I do not have this information
    // recorded", which is the refusal this path exists to avoid re-learning.
    const { listener, recallService } = buildListener({});

    await listener.inferQuestionAnswer({ ownerId: 'user-1', questionId: 'q-1' } as Payload);

    const options = (recallService.recall as jest.Mock).mock.calls[0][2];

    expect(options.excludeTypes).toContain('answer');
  });

  it('injects the retrieved lines into the system prompt as labelled EVIDENCE', async () => {
    const { listener, ollamaService } = buildListener({
      recallService: {
        recall: jest
          .fn()
          .mockResolvedValue(
            recallBlock(['[outbound, Mar 3, 2024] "repainted the study a deep blue"', 'Blue paint order']),
          ),
      },
    });

    await listener.inferQuestionAnswer({ ownerId: 'user-1', questionId: 'q-1' } as Payload);

    const [, ragThread] = (ollamaService.chat as jest.Mock).mock.calls[0] as [
      unknown,
      Array<{ content: string }>,
    ];
    const systemPrompt = ragThread[0].content;
    expect(systemPrompt).toContain('EVIDENCE');
    // Provenance survives into the prompt, so the model can name it in the
    // rationale rather than gesturing at "your history".
    expect(systemPrompt).toContain('[outbound, Mar 3, 2024] "repainted the study a deep blue"');
  });

  it('raises the evidence ceiling, so a grounded answer is not capped like an ungrounded one', async () => {
    // Without this, widening retrieval changes nothing that reaches the
    // database: every answer, grounded or not, would still be pinned to the
    // bare-context ceiling and land one notch above the discard floor.
    const lines = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6'];
    const { listener, answerService } = buildListener({
      recallService: { recall: jest.fn().mockResolvedValue(recallBlock(lines)) },
      ollamaService: {
        chat: jest.fn().mockResolvedValue({ message: { content: structuredResponse({ confidence: 0.9 }) } }),
      },
    });

    await listener.inferQuestionAnswer({ ownerId: 'user-1', questionId: 'q-1' } as Payload);

    // estimateInferredAnswerConfidence(0, false, 6) === 0.45 + 6 * 0.05.
    expect(answerService.create).toHaveBeenCalledWith(
      { userId: 'user-1' },
      expect.objectContaining({ answerConfidence: 0.75 }),
    );
  });

  it('tells the model when the corpus returned nothing, instead of staying silent about it', async () => {
    const { listener, ollamaService } = buildListener({
      recallService: { recall: jest.fn().mockResolvedValue({ block: '', resultCount: 0 }) },
    });

    await listener.inferQuestionAnswer({ ownerId: 'user-1', questionId: 'q-1' } as Payload);

    const [, ragThread] = (ollamaService.chat as jest.Mock).mock.calls[0] as [
      unknown,
      Array<{ content: string }>,
    ];
    expect(ragThread[0].content).toContain('No memory evidence was retrieved');
  });

  it('frames the evidence as a record of what the user DID, to be inferred from', async () => {
    // The measured failure was not retrieval: the corpus returned three
    // restaurant visits across three cuisines and the model still answered "I do
    // not have this information recorded." The prompt has to say that no line
    // will state the answer outright and that reading the pattern is the job.
    const { listener, ollamaService } = buildListener({
      recallService: {
        recall: jest
          .fn()
          .mockResolvedValue(recallBlock(['[Browser] Directions to Choya Japanese Cuisine, Dana Point, CA'])),
      },
    });

    await listener.inferQuestionAnswer({ ownerId: 'user-1', questionId: 'q-1' } as Payload);

    const [, ragThread] = (ollamaService.chat as jest.Mock).mock.calls[0] as [
      unknown,
      Array<{ content: string }>,
    ];
    const systemPrompt = ragThread[0].content;
    expect(systemPrompt).toContain('SYNTHESIS, NOT LOOKUP');
    expect(systemPrompt).toContain('do not require one of them to state it');
    expect(systemPrompt).toMatch(/indirect evidence is still evidence/i);
  });

  it('still infers (ungrounded, at the bare ceiling) when recall throws', async () => {
    const { listener, answerService, ollamaService } = buildListener({
      recallService: { recall: jest.fn().mockRejectedValue(new Error('search index down')) },
    });

    await expect(
      listener.inferQuestionAnswer({ ownerId: 'user-1', questionId: 'q-1' } as Payload),
    ).resolves.not.toThrow();

    expect(ollamaService.chat).toHaveBeenCalled();
    expect(answerService.create).toHaveBeenCalledWith(
      { userId: 'user-1' },
      expect.objectContaining({ answerConfidence: BARE_CONTEXT_CONFIDENCE }),
    );
  });
});

describe('AnswerInferenceListener — the related-answers block', () => {
  /** Both search paths into ci.answers return the same rows. */
  function withRelatedAnswers(answers: Answer[]) {
    return buildListener({
      searchService: {
        search: jest.fn().mockResolvedValue(answers.map((answer) => ({ type: 'answer', id: answer.id }))),
      },
      answerService: {
        findByIds: jest.fn().mockResolvedValue(answers),
        findAll: jest.fn().mockResolvedValue(answers),
        findByQuestionId: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(makeAnswer()),
        update: jest.fn().mockResolvedValue(makeAnswer()),
      },
    });
  }

  /**
   * Just the related-answers section. The prompt RULES quote refusal wording as
   * the thing to score low, so a whole-prompt substring check cannot tell "the
   * block leaked a refusal" from "the rules named one".
   */
  function relatedSectionOf(ollamaService: OllamaService) {
    const [, ragThread] = (ollamaService.chat as jest.Mock).mock.calls[0] as [
      unknown,
      Array<{ content: string }>,
    ];
    const system = ragThread[0].content;
    const start = system.indexOf('Related questions the user already answered');

    return start === -1
      ? system.slice(system.indexOf('No related prior answers were found'))
      : system.slice(start);
  }

  it('drops this listener’s own refusals, which are the absence of an answer', async () => {
    // 20 of the 23 rows in ci.answers on the reference corpus say exactly this,
    // and every one of them was written by this listener. Presented to the model
    // as "questions the user already answered", they read as evidence that
    // refusing is what this user does — the loop this filter breaks.
    const { listener, ollamaService } = withRelatedAnswers([
      makeAnswer({ id: 'a-1', answer: 'I do not have this information recorded.' }),
      makeAnswer({ id: 'a-2', answer: 'Toki Pona' }),
    ]);

    await listener.inferQuestionAnswer({ ownerId: 'user-1', questionId: 'q-1' } as Payload);

    const related = relatedSectionOf(ollamaService);

    expect(related).toContain('Toki Pona');
    expect(related).not.toContain('I do not have this information recorded.');
  });

  it('says no related answers were found when refusals were all there was', async () => {
    // The refusals must not merely be hidden from the block — with nothing real
    // left, the prompt has to say so, or the model is told a section exists and
    // then handed an empty one.
    const { listener, ollamaService } = withRelatedAnswers([
      makeAnswer({ id: 'a-1', answer: 'I do not have this information recorded.' }),
      makeAnswer({ id: 'a-2', answer: "I don't have that information recorded." }),
    ]);

    await listener.inferQuestionAnswer({ ownerId: 'user-1', questionId: 'q-1' } as Payload);

    expect(relatedSectionOf(ollamaService)).toContain('No related prior answers were found');
  });
});
