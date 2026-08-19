import type { LoggerService } from '@ci/common/logging';
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
 * The evidence ceiling for a listener built with no dossier and no related
 * answers — {@link estimateInferredAnswerConfidence}(0, false). Every default
 * build in this file hits it, so it is the confidence the writes carry.
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
  } = {},
): Answer {
  return {
    id: 'ans-existing',
    answer: 'previous answer',
    answeredAt: new Date('2026-01-01T00:00:00Z'),
    question: { id: 'other-question' },
    ...overrides,
  } as unknown as Answer;
}

function buildListener(overrides: {
  answerService?: Partial<AnswerService>;
  questionService?: Partial<QuestionService>;
  searchService?: Partial<SearchService>;
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
    const existing = makeAnswer({ id: 'ans-42' });
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

  it('overwrites a real user-authored answer with the inferred one when the decision is "auto" — the worst-case failure mode', async () => {
    // This is the scenario the audit flags: a pre-existing, user-typed answer
    // gets silently replaced because the update-vs-create branch only checks
    // "does an answer already exist", not who/what wrote it.
    const userWritten = makeAnswer({ id: 'ans-user', answer: 'I picked green myself.' });
    const { listener, answerService } = buildListener({
      answerService: { findByQuestionId: jest.fn().mockResolvedValue(userWritten) },
    });

    await listener.inferQuestionAnswer({ ownerId: 'user-1', questionId: 'q-1' } as Payload);

    // Documents current behavior: update() IS called with the LLM text, on the
    // caller's real answer id — i.e. this is the exact overwrite path, verified
    // so a future fix that gates on answerMethod can flip this assertion.
    expect(answerService.update).toHaveBeenCalledWith(
      { userId: 'user-1' },
      'ans-user',
      expect.objectContaining({ text: 'Blue, definitely blue.', answerMethod: 'inferred' }),
    );
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
