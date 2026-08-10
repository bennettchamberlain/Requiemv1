import type { LoggerService } from '@ci/common/logging';
import type { OllamaService } from '@ci/domains/llm';
import type { UserContextService } from '@ci/domains/memory';

import { PromotionReviewPromptService } from '../PromotionReviewPromptService';

describe('PromotionReviewPromptService', () => {
  const context = { userId: 'user-1' };

  function buildService(chatImpl?: OllamaService['chat']) {
    return new PromotionReviewPromptService(
      {
        getUserContextForLLM: jest.fn().mockResolvedValue(null),
        formatContextForSystemPrompt: jest.fn(),
      } as unknown as UserContextService,
      {
        chat: chatImpl ?? jest.fn(),
      } as unknown as OllamaService,
      { setContext() {}, warn() {} } as unknown as LoggerService,
    );
  }

  it('falls back to a natural inferred-fact question when LLM fails', async () => {
    const service = buildService(jest.fn().mockRejectedValue(new Error('offline')));

    const prompt = await service.generate(context, {
      kind: 'inferred_fact',
      payload: {
        questionText: 'What time do you usually wake up?',
        inferredText: 'around 7am',
      },
      sourceJob: 'infer.question.answer',
    });

    expect(prompt).toContain('around 7am');
    expect(prompt).not.toContain('possible interest');
  });

  it('falls back to a remember-this question for entity promotions', async () => {
    const service = buildService(jest.fn().mockRejectedValue(new Error('offline')));

    const prompt = await service.generate(context, {
      kind: 'entity',
      payload: { valueText: 'Hiking on weekends' },
      evidence: [{ text: 'Hiking on weekends' }],
      sourceJob: 'hydrate_answers',
    });

    expect(prompt).toContain('Hiking on weekends');
  });
});
