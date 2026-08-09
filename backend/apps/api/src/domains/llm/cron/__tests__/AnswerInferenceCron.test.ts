import type { FeatureService } from '@ci/common/feature';
import type { LoggerService } from '@ci/common/logging';
import type { EventService } from '@ci/domains/events';
import type { QuestionService } from '@ci/domains/intelligence';
import type { PromotionCandidateService } from '@ci/domains/personalization';

import { AnswerInferenceCron } from '../AnswerInferenceCron';

describe('AnswerInferenceCron with smart.rotation', () => {
  const promotionCandidateService = {
    hasPendingInferredFactReview: jest.fn().mockResolvedValue(false),
  } as unknown as PromotionCandidateService;

  it('defers to the orchestrator when smart.rotation is enabled', async () => {
    const eventService = { send: jest.fn() } as unknown as EventService;
    const questionService = { findUnansweredByUserId: jest.fn() } as unknown as QuestionService;
    const featureService = {
      isFeatureEnabled: jest.fn().mockImplementation(async (key: string) => key === 'smart.rotation'),
    } as unknown as FeatureService;
    const logger = { setContext() {}, log() {} } as unknown as LoggerService;

    const cron = new AnswerInferenceCron(
      eventService,
      questionService,
      promotionCandidateService,
      logger,
      featureService,
    );

    await cron.cronInferAnswers();

    expect(questionService.findUnansweredByUserId).not.toHaveBeenCalled();
    expect(eventService.send).not.toHaveBeenCalled();
  });

  it('still respects scheduled.answer.inferencing when smart.rotation is off', async () => {
    const eventService = { send: jest.fn() } as unknown as EventService;
    const questionService = {
      findUnansweredByUserId: jest.fn().mockResolvedValue(new Map()),
    } as unknown as QuestionService;
    const featureService = {
      isFeatureEnabled: jest.fn().mockImplementation(async (key: string) => key === 'scheduled.answer.inferencing'),
    } as unknown as FeatureService;
    const logger = { setContext() {}, log() {} } as unknown as LoggerService;

    const cron = new AnswerInferenceCron(
      eventService,
      questionService,
      promotionCandidateService,
      logger,
      featureService,
    );

    await cron.cronInferAnswers();

    expect(questionService.findUnansweredByUserId).toHaveBeenCalled();
  });

  it('skips users who already have a pending inferred-answer review', async () => {
    const eventService = { send: jest.fn() } as unknown as EventService;
    const questionService = {
      findUnansweredByUserId: jest.fn().mockResolvedValue(new Map([['user-1', ['q-1']]])),
    } as unknown as QuestionService;
    const featureService = {
      isFeatureEnabled: jest.fn().mockImplementation(async (key: string) => key === 'scheduled.answer.inferencing'),
    } as unknown as FeatureService;
    const logger = { setContext() {}, log() {} } as unknown as LoggerService;
    const pendingReviewService = {
      hasPendingInferredFactReview: jest.fn().mockResolvedValue(true),
    } as unknown as PromotionCandidateService;

    const cron = new AnswerInferenceCron(eventService, questionService, pendingReviewService, logger, featureService);

    await cron.cronInferAnswers();

    expect(eventService.send).not.toHaveBeenCalled();
  });
});
