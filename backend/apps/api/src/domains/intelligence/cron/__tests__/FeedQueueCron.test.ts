import type { FeatureService } from '@ci/common/feature';
import type { LoggerService } from '@ci/common/logging';

import type { QuestionService } from '../../services/QuestionService';
import { FeedQueueCron } from '../FeedQueueCron';

describe('FeedQueueCron with smart.rotation', () => {
  it('defers to the orchestrator when smart.rotation is enabled', async () => {
    const questionService = {
      listFeedQueueUserIds: jest.fn(),
      enqueueNextFeedQueueQuestion: jest.fn(),
    } as unknown as QuestionService;
    const featureService = {
      isFeatureEnabled: jest.fn().mockImplementation(async (key: string) => key === 'smart.rotation'),
    } as unknown as FeatureService;
    const logger = { setContext() {}, log() {} } as unknown as LoggerService;

    const cron = new FeedQueueCron(questionService, logger, featureService);

    await cron.topUpFeedQueue();

    expect(questionService.listFeedQueueUserIds).not.toHaveBeenCalled();
  });
});
