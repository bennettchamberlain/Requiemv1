import type { LoggerService } from '@ci/common/logging';
import type { EventService } from '@ci/domains/events';
import { Events } from '@ci/domains/events';
import type { QuestionService } from '@ci/domains/intelligence';
import type { GraphEnrichmentService, MaintenanceOrchestratorService } from '@ci/domains/maintenance';
import type { PythonFunctionService } from '@ci/domains/python-functions';
import type { SuggestionSyncService } from '@ci/domains/schedule';


import { SmartRotationListener } from '../../listeners/SmartRotationListener';

describe('SmartRotationListener', () => {
  it('delegates schedule_sync to SuggestionSyncService', async () => {
    const questionService = {} as QuestionService;
    const contextGapQuestionService = {} as import('../../services/ContextGapQuestionService').ContextGapQuestionService;
    const eventService = { send: jest.fn() } as unknown as EventService;
    const suggestionSyncService = { sync: jest.fn().mockResolvedValue(3) } as unknown as SuggestionSyncService;
    const pythonFunctionService = {} as PythonFunctionService;
    const graphEnrichmentService = {} as GraphEnrichmentService;
    const maintenanceOrchestratorService = {} as MaintenanceOrchestratorService;
    const dataSource = { query: jest.fn() };
    const logger = { setContext() {}, log() {} } as unknown as LoggerService;

    const personalizationService = {} as import('@ci/domains/personalization').PersonalizationService;
    const promotionReviewService = { surfacePendingReviews: jest.fn() } as never;
    const promotionCandidateService = {
      hasPendingInferredFactReview: jest.fn().mockResolvedValue(false),
    } as never;
    const crossTableHydrationService = {} as import('@ci/domains/personalization').CrossTableHydrationService;
    const lifeContextService = { hasNoveltySinceLastRun: jest.fn(), buildForUser: jest.fn() } as never;

    const listener = new SmartRotationListener(
      questionService,
      contextGapQuestionService,
      eventService,
      suggestionSyncService,
      pythonFunctionService,
      graphEnrichmentService,
      maintenanceOrchestratorService,
      personalizationService,
      promotionCandidateService,
      promotionReviewService,
      crossTableHydrationService,
      lifeContextService,
      dataSource as never,
      logger,
    );

    await listener.handleWork({ userId: 'user-1', workType: 'schedule_sync' });

    expect(suggestionSyncService.sync).toHaveBeenCalledWith({ userId: 'user-1' });
  });

  it('delegates answer_infer to the inference event bus', async () => {
    const questionService = {
      rotateStaleFeedQuestions: jest.fn(),
      enqueueNextFeedQueueQuestion: jest.fn(),
    } as unknown as QuestionService;
    const contextGapQuestionService = { tryGenerateAndEnqueue: jest.fn() } as unknown as import('../../services/ContextGapQuestionService').ContextGapQuestionService;
    const eventService = { send: jest.fn().mockResolvedValue(['job-1']) } as unknown as EventService;
    const suggestionSyncService = {} as SuggestionSyncService;
    const pythonFunctionService = {} as PythonFunctionService;
    const graphEnrichmentService = {} as GraphEnrichmentService;
    const maintenanceOrchestratorService = {} as MaintenanceOrchestratorService;
    const dataSource = { query: jest.fn().mockResolvedValue([{ id: 'q-1' }]) };
    const logger = { setContext() {}, log() {} } as unknown as LoggerService;

    const personalizationService = {} as import('@ci/domains/personalization').PersonalizationService;
    const promotionReviewService = { surfacePendingReviews: jest.fn() } as never;
    const promotionCandidateService = {
      hasPendingInferredFactReview: jest.fn().mockResolvedValue(false),
    } as never;
    const crossTableHydrationService = {} as import('@ci/domains/personalization').CrossTableHydrationService;
    const lifeContextService = { hasNoveltySinceLastRun: jest.fn(), buildForUser: jest.fn() } as never;

    const listener = new SmartRotationListener(
      questionService,
      contextGapQuestionService,
      eventService,
      suggestionSyncService,
      pythonFunctionService,
      graphEnrichmentService,
      maintenanceOrchestratorService,
      personalizationService,
      promotionCandidateService,
      promotionReviewService,
      crossTableHydrationService,
      lifeContextService,
      dataSource as never,
      logger,
    );

    await listener.handleWork({ userId: 'user-1', workType: 'answer_infer' });

    expect(eventService.send).toHaveBeenCalledWith(
      Events.INFER_QUESTION_ANSWER,
      {
        ownerId: 'user-1',
        questionId: 'q-1',
      },
      {
        singletonKey: 'infer:user-1:q-1',
      },
    );
  });

  it('delegates graph_link to the maintenance orchestrator graph prep legs', async () => {
    const questionService = {} as QuestionService;
    const contextGapQuestionService = {} as import('../../services/ContextGapQuestionService').ContextGapQuestionService;
    const eventService = { send: jest.fn() } as unknown as EventService;
    const suggestionSyncService = {} as SuggestionSyncService;
    const pythonFunctionService = {} as PythonFunctionService;
    const graphEnrichmentService = {} as GraphEnrichmentService;
    const maintenanceOrchestratorService = {
      isRunning: jest.fn().mockReturnValue(false),
      orchestrate: jest.fn().mockResolvedValue({ ok: true, legs: [], totalDurationMs: 1 }),
    } as unknown as MaintenanceOrchestratorService;
    const dataSource = { query: jest.fn() };
    const logger = { setContext() {}, log() {} } as unknown as LoggerService;

    const personalizationService = {} as import('@ci/domains/personalization').PersonalizationService;
    const promotionReviewService = { surfacePendingReviews: jest.fn() } as never;
    const promotionCandidateService = {
      hasPendingInferredFactReview: jest.fn().mockResolvedValue(false),
    } as never;
    const crossTableHydrationService = {} as import('@ci/domains/personalization').CrossTableHydrationService;
    const lifeContextService = { hasNoveltySinceLastRun: jest.fn(), buildForUser: jest.fn() } as never;

    const listener = new SmartRotationListener(
      questionService,
      contextGapQuestionService,
      eventService,
      suggestionSyncService,
      pythonFunctionService,
      graphEnrichmentService,
      maintenanceOrchestratorService,
      personalizationService,
      promotionCandidateService,
      promotionReviewService,
      crossTableHydrationService,
      lifeContextService,
      dataSource as never,
      logger,
    );

    await listener.handleWork({ userId: 'user-1', workType: 'graph_link' });

    expect(maintenanceOrchestratorService.orchestrate).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        stages: ['extract_people', 'link_communications', 'link_events'],
      }),
    );
  });
});
