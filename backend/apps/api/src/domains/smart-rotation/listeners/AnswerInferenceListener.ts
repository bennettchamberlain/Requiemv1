import { Injectable } from '@nestjs/common';

import { type ServiceContext, type UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import config from '@ci/configuration';
import { RecallService } from '@ci/domains/agent';
import { Events, type EventPayloads, OnEvent } from '@ci/domains/events';
import { Answer, AnswerService, QuestionService } from '@ci/domains/intelligence';
import {
  calibrateInferredConfidence,
  confidenceLabel,
  estimateInferredAnswerConfidence,
  INFERRED_ANSWER_JSON_SCHEMA,
  INFERRED_ANSWER_PROMPT_RULES,
  type InferredAnswer,
  isNonAnswer,
  LLM_QUEUE,
  LLM_QUEUE_OPTIONS,
  OllamaService,
  parseInferredAnswer,
  PROMPT_MODEL,
} from '@ci/domains/llm';
import { UserContextService } from '@ci/domains/memory';
import { PersonalizationService } from '@ci/domains/personalization';
import { SearchService } from '@ci/domains/search-next';

const RELATED_ANSWER_LIMIT = 10;
const RECENT_ANSWER_FALLBACK = 5;

/**
 * Seed hits to pull from the user's OWN indexed memory for the question.
 *
 * Deliberately small. This is the whole corpus — communications, events,
 * content, browser activity, people, files — so recall is not the constraint;
 * prompt discipline is. RecallService unions one hop of query-relevant graph
 * expansion on top of these seeds, so the block that reaches the model is
 * usually a little longer than this number.
 */
const MEMORY_EVIDENCE_SEEDS = 8;

@Injectable()
export class AnswerInferenceListener {
  constructor(
    private readonly answerService: AnswerService,
    private readonly questionService: QuestionService,
    private readonly searchService: SearchService,
    private readonly recallService: RecallService,
    private readonly userContextService: UserContextService,
    private readonly personalizationService: PersonalizationService,
    private readonly ollamaService: OllamaService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(AnswerInferenceListener.name);
  }

  @OnEvent(Events.INFER_QUESTION_ANSWER, { queue: LLM_QUEUE, queueOptions: LLM_QUEUE_OPTIONS })
  async inferQuestionAnswer(payload: EventPayloads[Events.INFER_QUESTION_ANSWER]) {
    const ownerId = payload.ownerId;
    if (!ownerId) {
      this.logger.warn('Answer inference skipped — no user owner', {
        questionId: payload.questionId,
      });

      return;
    }

    this.logger.log('Inferring answer to question', {
      userId: ownerId,
      questionId: payload.questionId,
    });

    const serviceContext = { userId: ownerId } as UserServiceContext;

    const question = await this.questionService.findById(serviceContext, payload.questionId);

    if (!question) {
      return;
    }

    const resolvedAnswers = await this.findRelatedAnswers(serviceContext, question.text, payload.questionId);

    // The actual RAG leg. findRelatedAnswers above only ever sees ci.answers —
    // sixteen rows against the ~900k the user has indexed — which is why this
    // listener used to answer "I'm not sure, I haven't really thought about it"
    // to questions the corpus answers outright. RecallService is the retrieval
    // pipeline the rest of the appliance already uses (boosted seed → semantic
    // fallback → entity resolution → one hop of query-relevant graph expansion),
    // so the evidence here is the same evidence the agent surfaces elsewhere.
    const memoryEvidence = await this.findMemoryEvidence(serviceContext, question.text);

    let dossierBlock = '';
    try {
      const userCtx = await this.userContextService.getUserContextForLLM(ownerId);
      if (userCtx) {
        dossierBlock = this.userContextService.formatContextForSystemPrompt(userCtx);
      }
    } catch (err) {
      this.logger.warn('Answer inference dossier fetch failed', {
        userId: ownerId,
        err: err instanceof Error ? err.message : String(err),
      });
    }

    const systemParts = [
      `You impersonate the user and infer a first-person answer to a question they have not answered yet.

Ground the answer in the EVIDENCE, dossier and related Q&A below, and score how well grounded it actually is. INFER — the evidence is a record of what this person did, not a list of what they believe, so the answer will almost never be written out anywhere in it. Reading the pattern is the job.

${INFERRED_ANSWER_PROMPT_RULES}`,
      // Evidence first: it is the only section drawn from the user's own records
      // rather than from prose about them, so it should be what the model reads
      // while the instructions are still in view.
      memoryEvidence.block
        ? `EVIDENCE — retrieved from the user's own imported memory. Each line carries its source label and, where the record has one, its date. These are things the user actually did: places they went, messages they sent, pages they opened, things they bought. Draw the answer OUT of them — do not require one of them to state it. Cite the lines you used in your rationale.

${memoryEvidence.block}`
        : 'No memory evidence was retrieved for this question — say so in the rationale and score accordingly.',
      dossierBlock ? `User dossier and graph context:\n${dossierBlock}` : null,
      resolvedAnswers.length > 0
        ? `Related questions the user already answered:\n\n${resolvedAnswers
            .map(
              (answer) => `Question: ${answer.question?.text ?? '(unspecified)'}\nAnswer: ${answer.answer}`,
            )
            .join('\n\n')}`
        : 'No related prior answers were found — rely on the evidence and dossier only.',
    ].filter((part): part is string => part != null);

    const ragThread = [
      {
        role: 'system',
        content: systemParts.join('\n\n'),
      },
      {
        role: 'user',
        content: `Question to answer as the user:\n${question.text}`,
      },
    ];

    const llmResponse = await this.ollamaService.chat(serviceContext, ragThread, {
      model: PROMPT_MODEL,
      // The schema — not the bare 'json' string — is what makes the confidence
      // and rationale a contract rather than a request. See
      // INFERRED_ANSWER_JSON_SCHEMA.
      format: INFERRED_ANSWER_JSON_SCHEMA,
    });

    const rawContent = llmResponse.message.content ?? '';
    const inferred: InferredAnswer | null = parseInferredAnswer(rawContent);

    if (!inferred) {
      // No usable structured result. Deliberately NOT salvaged by treating the
      // raw text as the answer: without a score there is nothing to hold the
      // floor against, and a confidence invented here would be exactly the
      // fabrication this path exists to prevent. Keep the evidence — "nothing
      // came back" was previously impossible to diagnose from the logs alone.
      this.logger.warn('Answer inference returned no usable structured answer', {
        userId: ownerId,
        questionId: payload.questionId,
        content: rawContent.slice(0, 500),
      });

      return;
    }

    // A refusal is not an answer, whatever score came back with it. The floor
    // below would already catch it — parseInferredAnswer clamps a non-answer to
    // CONFIDENCE_NON_ANSWER — but the floor is owner-configurable and could be
    // set low enough to let one through, and "I do not have this information
    // recorded" written into ci.answers is indistinguishable at a glance from
    // the user having said it. Refuse the write itself, not just the score.
    if (isNonAnswer(inferred.answer)) {
      this.logger.log('Inferred answer discarded — model returned a non-answer', {
        userId: ownerId,
        questionId: payload.questionId,
        question: question.text,
        memoryEvidence: memoryEvidence.resultCount,
        response: inferred.answer,
        rationale: inferred.rationale,
      });

      return;
    }

    // The model's own score, capped by how much evidence the prompt actually
    // carried — a model handed nothing still claims certainty, and only this
    // side of the call knows how thin the context was.
    const evidenceCeiling = estimateInferredAnswerConfidence(
      resolvedAnswers.length,
      dossierBlock.length > 0,
      memoryEvidence.resultCount,
    );
    const confidence = calibrateInferredConfidence(inferred.confidence, evidenceCeiling);

    this.logger.log('Inferred answer to question', {
      userId: ownerId,
      questionId: payload.questionId,
      question: question.text,
      relatedAnswers: resolvedAnswers.length,
      memoryEvidence: memoryEvidence.resultCount,
      response: inferred.answer,
      modelConfidence: inferred.confidence,
      evidenceCeiling,
      confidence,
      confidenceLabel: confidenceLabel(confidence),
      rationale: inferred.rationale,
    });

    // The floor. Below it the appliance says nothing rather than writing a guess
    // into the user's own memory, where it would sit beside answers they typed
    // themselves and be indistinguishable from them at a glance. An unanswered
    // question costs a blank card; a fabricated one costs the credibility of
    // every other answer on the page. Configurable so an owner can demand more.
    const minConfidence = config.reflection.minAnswerConfidence;

    if (confidence < minConfidence) {
      this.logger.log('Inferred answer discarded — below the confidence floor', {
        userId: ownerId,
        questionId: payload.questionId,
        confidence,
        minConfidence,
        rationale: inferred.rationale,
      });

      return;
    }

    const decision = await this.personalizationService.decideAction(ownerId, {
      kind: 'inferred_fact',
      confidence,
      hasUserInput: true,
    });

    if (decision === 'review') {
      this.logger.log('Inferred answer left unwritten for context prompt', {
        userId: ownerId,
        questionId: payload.questionId,
      });

      return;
    }

    if (decision === 'skip') {
      return;
    }

    const existingAnswer = await this.answerService.findByQuestionId(serviceContext, payload.questionId);

    // A row this same path wrote before (answerSource: 'inferred') is safe to
    // refresh. Anything else — typed by the user, an about-you correction,
    // imported — is real content, and the only thing this listener knows about
    // it is that it did not write it. Overwriting on a benign timing race would
    // silently replace an answer the user actually gave. See AnswerProvenance on
    // the frontend, which keys the same "Inferred" vs "Manual" distinction off
    // this field.
    if (existingAnswer && existingAnswer.answerSource !== 'inferred') {
      this.logger.log('Inferred answer discarded — existing answer is not machine-inferred', {
        userId: ownerId,
        questionId: payload.questionId,
        answerId: existingAnswer.id,
        answerSource: existingAnswer.answerSource,
      });

      return;
    }

    if (existingAnswer) {
      await this.answerService.update(serviceContext, existingAnswer.id, {
        text: inferred.answer,
        answerMethod: 'inferred',
        answerSource: 'inferred',
        answerConfidence: confidence,
        answerRationale: inferred.rationale ?? null,
      });
    } else {
      await this.answerService.create(serviceContext, {
        text: inferred.answer,
        question: { id: payload.questionId },
        answerMethod: 'inferred',
        answerSource: 'inferred',
        answerConfidence: confidence,
        answerRationale: inferred.rationale ?? null,
      });
    }
  }

  /**
   * Retrieve the question's supporting evidence from the user's own indexed
   * memory, as a prompt-ready block plus the number of lines in it.
   *
   * RecallService already fails soft (it returns an empty block rather than
   * throwing), so this wrapper exists for the case it cannot cover — the call
   * itself blowing up — and to keep "no evidence" a normal, loggable outcome
   * rather than a lost inference. An answer grounded only in the dossier is
   * worse than one grounded in records, but it is still better than none.
   *
   * ═══ WHY 'grounded', AND WHY NOT 'answer' ═══
   *
   * The default recall strategy is tuned for an agent looking something up, where
   * a near-miss costs a wasted line. Here a near-miss costs a FABRICATION, or —
   * measured on the reference corpus — a refusal in spite of good evidence,
   * because the good evidence arrived buried in lexical noise. What the default
   * seed returned for these questions: song titles containing "City" for "What
   * city do you live in?", RC monster-truck shopping for "What sports do you
   * follow?", a 3D-digital-human article for "What languages do you speak?".
   * `strategy: 'grounded'` is the precision-first path built for exactly this.
   *
   * 'answer' is excluded because this listener WRITES ci.answers, and every row
   * in it was written by this listener. Retrieving them as "evidence retrieved
   * from the user's own imported memory" hands the model its own previous output
   * relabelled as a record of the user's life — and 20 of the 23 rows on the
   * reference corpus say "I do not have this information recorded", which
   * retrieved at cosine 0.891 as the third-best evidence for the very question
   * that produced it. Prior answers still reach the prompt, through
   * {@link findRelatedAnswers}, in the section that says what they are.
   */
  private async findMemoryEvidence(
    context: UserServiceContext,
    questionText: string,
  ): Promise<{ block: string; resultCount: number }> {
    try {
      const recall = await this.recallService.recall(
        context,
        {
          query: questionText,
          maxResults: MEMORY_EVIDENCE_SEEDS,
        },
        { strategy: 'grounded', excludeTypes: ['answer'] },
      );

      if (recall.block.trim() && recall.resultCount > 0) {
        return recall;
      }
    } catch (err) {
      this.logger.warn('Answer inference memory recall failed', {
        userId: context.userId,
        err: err instanceof Error ? err.message : String(err),
      });
    }

    return { block: '', resultCount: 0 };
  }

  private async findRelatedAnswers(
    context: UserServiceContext,
    questionText: string,
    excludeQuestionId: string,
  ): Promise<Answer[]> {
    const seen = new Set<string>();
    const resolved: Answer[] = [];

    try {
      const hits = await this.searchService.search(context, {
        query: questionText,
        mode: 'boosted',
        maxResults: RELATED_ANSWER_LIMIT,
        includeTypes: ['answer'],
      });

      if (hits.length > 0) {
        const byId = await this.answerService.findByIds(
          context as ServiceContext,
          hits.map((hit) => hit.id),
        );

        for (const answer of byId) {
          if (!answer || answer.question?.id === excludeQuestionId || seen.has(answer.id)) {
            continue;
          }

          // "I do not have this information recorded." is not a related answer,
          // it is the absence of one. Rows written before isNonAnswer gated the
          // write are still in ci.answers, and the prompt block presents them as
          // "questions the user already answered" — so the model reads a wall of
          // its own refusals as evidence that refusing is what this user does.
          if (isNonAnswer(answer.answer)) {
            continue;
          }

          seen.add(answer.id);
          resolved.push(answer);
        }
      }
    } catch (err) {
      this.logger.warn('Answer inference semantic search failed', {
        err: err instanceof Error ? err.message : String(err),
      });
    }

    if (resolved.length >= 3) {
      return resolved.slice(0, RELATED_ANSWER_LIMIT);
    }

    const recent = await this.answerService.findAll(context);
    const sorted = [...recent]
      .filter(
        (answer) =>
          answer.question?.id !== excludeQuestionId && !seen.has(answer.id) && !isNonAnswer(answer.answer),
      )
      .sort((a, b) => new Date(b.answeredAt).getTime() - new Date(a.answeredAt).getTime())
      .slice(0, RECENT_ANSWER_FALLBACK);

    return [...resolved, ...sorted].slice(0, RELATED_ANSWER_LIMIT);
  }
}
