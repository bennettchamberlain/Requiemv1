import { Injectable } from '@nestjs/common';

import { type ServiceContext, type UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import config from '@ci/configuration';
import { Events, type EventPayloads, OnEvent } from '@ci/domains/events';
import { Answer, AnswerService, QuestionService } from '@ci/domains/intelligence';
import {
  calibrateInferredConfidence,
  confidenceLabel,
  estimateInferredAnswerConfidence,
  INFERRED_ANSWER_JSON_SCHEMA,
  INFERRED_ANSWER_PROMPT_RULES,
  type InferredAnswer,
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

@Injectable()
export class AnswerInferenceListener {
  constructor(
    private readonly answerService: AnswerService,
    private readonly questionService: QuestionService,
    private readonly searchService: SearchService,
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

Ground the answer in the dossier and related Q&A below, and score how well grounded it actually is.

${INFERRED_ANSWER_PROMPT_RULES}`,
      dossierBlock ? `User dossier and graph context:\n${dossierBlock}` : null,
      resolvedAnswers.length > 0
        ? `Related questions the user already answered:\n\n${resolvedAnswers
            .map(
              (answer) => `Question: ${answer.question?.text ?? '(unspecified)'}\nAnswer: ${answer.answer}`,
            )
            .join('\n\n')}`
        : 'No related prior answers were found — rely on the dossier only.',
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

    // The model's own score, capped by how much evidence the prompt actually
    // carried — a model handed nothing still claims certainty, and only this
    // side of the call knows how thin the context was.
    const evidenceCeiling = estimateInferredAnswerConfidence(resolvedAnswers.length, dossierBlock.length > 0);
    const confidence = calibrateInferredConfidence(inferred.confidence, evidenceCeiling);

    this.logger.log('Inferred answer to question', {
      userId: ownerId,
      questionId: payload.questionId,
      question: question.text,
      relatedAnswers: resolvedAnswers.length,
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

    const userAnswer = await this.answerService.findByQuestionId(serviceContext, payload.questionId);

    if (userAnswer) {
      await this.answerService.update(serviceContext, userAnswer.id, {
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
      .filter((answer) => answer.question?.id !== excludeQuestionId && !seen.has(answer.id))
      .sort((a, b) => new Date(b.answeredAt).getTime() - new Date(a.answeredAt).getTime())
      .slice(0, RECENT_ANSWER_FALLBACK);

    return [...resolved, ...sorted].slice(0, RELATED_ANSWER_LIMIT);
  }
}
