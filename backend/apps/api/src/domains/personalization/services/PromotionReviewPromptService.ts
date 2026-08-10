import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { type RequestContext, type UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import { OllamaService, PROMPT_MODEL } from '@ci/domains/llm';
import { UserContextService } from '@ci/domains/memory';

import type { PromotionCandidateKind } from '../types';
import {
  promotionRelationshipSummary,
  promotionSourceQuestion,
  promotionValueText,
} from '../utils/promotionCandidatePayload';

const REVIEW_QUESTION_SCHEMA = z.object({
  question: z.string().min(8).max(200),
});

const REVIEW_QUESTION_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    question: { type: 'string' },
  },
  required: ['question'],
};

export interface PromotionReviewPromptInput {
  readonly kind: PromotionCandidateKind;
  readonly payload: Record<string, unknown>;
  readonly evidence?: unknown[];
  readonly sourceJob?: string | null;
}

@Injectable()
export class PromotionReviewPromptService {
  constructor(
    private readonly userContextService: UserContextService,
    private readonly ollamaService: OllamaService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(PromotionReviewPromptService.name);
  }

  async generate(context: UserServiceContext, input: PromotionReviewPromptInput): Promise<string> {
    const fallback = this.fallbackPrompt(input);

    try {
      const userContext = await this.userContextService.getUserContextForLLM(context.userId!);
      const dossier = userContext ? this.userContextService.formatContextForSystemPrompt(userContext) : '';
      const llmContext = { userId: context.userId } as RequestContext;
      const prompt = this.buildPrompt(input, dossier);

      const response = await this.ollamaService.chat(llmContext, [{ role: 'user', content: prompt }], {
        model: PROMPT_MODEL,
        enableTools: false,
        format: REVIEW_QUESTION_JSON_SCHEMA,
      });

      const parsed = REVIEW_QUESTION_SCHEMA.parse(JSON.parse(response.message.content));

      return parsed.question.trim();
    } catch (error) {
      this.logger.warn('Promotion review prompt generation failed', {
        userId: context.userId,
        kind: input.kind,
        sourceJob: input.sourceJob,
        error: error instanceof Error ? error.message : String(error),
      });

      return fallback;
    }
  }

  private buildPrompt(input: PromotionReviewPromptInput, dossier: string): string {
    const valueText = promotionValueText(input.payload, input.evidence);
    const sourceQuestion = promotionSourceQuestion(input.payload);
    const relationshipSummary = promotionRelationshipSummary(input.payload);

    return [
      'You write one short yes/no confirmation question for a personal assistant feed card.',
      'The user will tap Yes or No — do not ask them to explain or write anything.',
      '',
      `Suggestion kind: ${input.kind}`,
      input.sourceJob ? `Source: ${input.sourceJob}` : '',
      valueText ? `Proposed value: ${valueText}` : '',
      sourceQuestion ? `Original question answered: ${sourceQuestion}` : '',
      relationshipSummary ? `Relationship context: ${relationshipSummary}` : '',
      dossier ? `Known user context:\n${dossier.slice(0, 1500)}` : '',
      '',
      'Write a natural, friendly question in second person.',
      'For schedule or routine facts, confirm the fact — never call a time an interest.',
      'For inferred answers, confirm whether the proposed answer is accurate.',
      'For relationships, ask whether the relationship is correct.',
      'Return JSON only: { "question": "..." }',
    ]
      .filter(Boolean)
      .join('\n');
  }

  private fallbackPrompt(input: PromotionReviewPromptInput): string {
    const valueText = promotionValueText(input.payload, input.evidence);
    const sourceQuestion = promotionSourceQuestion(input.payload);
    const relationshipSummary = promotionRelationshipSummary(input.payload);

    if (input.kind === 'inferred_fact') {
      if (sourceQuestion && valueText) {
        return `Is it right that ${this.lowerFirst(valueText)}? (${sourceQuestion})`;
      }

      if (sourceQuestion) {
        return sourceQuestion;
      }

      if (valueText) {
        return `Is this accurate: ${valueText}?`;
      }
    }

    if (input.kind === 'relationship' && relationshipSummary) {
      return `Should I remember this relationship: ${relationshipSummary}?`;
    }

    if (valueText) {
      return `Should I remember this about you: ${valueText}?`;
    }

    return 'Is this suggestion accurate?';
  }

  private lowerFirst(text: string): string {
    if (!text) {
      return text;
    }

    return text.charAt(0).toLowerCase() + text.slice(1);
  }
}
