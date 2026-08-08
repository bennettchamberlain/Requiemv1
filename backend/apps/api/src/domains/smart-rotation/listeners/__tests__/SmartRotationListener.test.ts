import type { LoggerService } from '@ci/common/logging';
import type { EventService } from '@ci/domains/events';
import { Events } from '@ci/domains/events';
import type { QuestionService } from '@ci/domains/intelligence';
import type { GraphEnrichmentService } from '@ci/domains/maintenance';
import type { SuggestionSyncService } from '@ci/domains/schedule';

import { SmartRotationListener } from '../../listeners/SmartRotationListener';
import type { SummaryServiceClient } from '../../services/SummaryServiceClient';

describe('SmartRotationListener', () => {
  it('delegates schedule_sync to SuggestionSyncService', async () => {
    const questionService = {} as QuestionService;
    const eventService = { send: jest.fn() } as unknown as EventService;
    const suggestionSyncService = { sync: jest.fn().mockResolvedValue(3) } as unknown as SuggestionSyncService;
    const summaryServiceClient = {} as SummaryServiceClient;
    const graphEnrichmentService = {} as GraphEnrichmentService;
    const dataSource = { query: jest.fn() };
    const logger = { setContext() {}, log() {} } as unknown as LoggerService;

    const listener = new SmartRotationListener(
      questionService,
      eventService,
      suggestionSyncService,
      summaryServiceClient,
      graphEnrichmentService,
      dataSource as never,
      logger,
    );

    await listener.handleWork({ userId: 'user-1', workType: 'schedule_sync' });

    expect(suggestionSyncService.sync).toHaveBeenCalledWith({ userId: 'user-1' });
  });

  it('delegates answer_infer to the inference event bus', async () => {
    const questionService = {
      enqueueNextFeedQueueQuestion: jest.fn(),
    } as unknown as QuestionService;
    const eventService = { send: jest.fn().mockResolvedValue(['job-1']) } as unknown as EventService;
    const suggestionSyncService = {} as SuggestionSyncService;
    const summaryServiceClient = {} as SummaryServiceClient;
    const graphEnrichmentService = {} as GraphEnrichmentService;
    const dataSource = { query: jest.fn().mockResolvedValue([{ id: 'q-1' }]) };
    const logger = { setContext() {}, log() {} } as unknown as LoggerService;

    const listener = new SmartRotationListener(
      questionService,
      eventService,
      suggestionSyncService,
      summaryServiceClient,
      graphEnrichmentService,
      dataSource as never,
      logger,
    );

    await listener.handleWork({ userId: 'user-1', workType: 'answer_infer' });

    expect(eventService.send).toHaveBeenCalledWith(Events.INFER_QUESTION_ANSWER, {
      ownerId: 'user-1',
      questionId: 'q-1',
    });
  });
});
