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

describe('FeedQueueCron.topUpFeedQueue when smart.rotation is off', () => {
  function makeCron(overrides: { rotate?: jest.Mock; enqueue?: jest.Mock; userIds?: string[] } = {}) {
    const questionService = {
      listFeedQueueUserIds: jest.fn().mockResolvedValue(overrides.userIds ?? ['user-1', 'user-2']),
      rotateStaleFeedQuestions: overrides.rotate ?? jest.fn().mockResolvedValue(undefined),
      enqueueNextFeedQueueQuestion: overrides.enqueue ?? jest.fn().mockResolvedValue(true),
    } as unknown as QuestionService;
    const featureService = {
      isFeatureEnabled: jest.fn().mockResolvedValue(false),
    } as unknown as FeatureService;
    const log = jest.fn();
    const logger = { setContext() {}, log } as unknown as LoggerService;

    return { cron: new FeedQueueCron(questionService, logger, featureService), questionService, log };
  }

  it('rotates stale questions and tops up the queue for every feed-queue user', async () => {
    const { cron, questionService } = makeCron({ userIds: ['user-1', 'user-2'] });

    await cron.topUpFeedQueue();

    expect(questionService.rotateStaleFeedQuestions).toHaveBeenCalledWith('user-1');
    expect(questionService.rotateStaleFeedQuestions).toHaveBeenCalledWith('user-2');
    expect(questionService.enqueueNextFeedQueueQuestion).toHaveBeenCalledWith('user-1', 3);
    expect(questionService.enqueueNextFeedQueueQuestion).toHaveBeenCalledWith('user-2', 3);
  });

  it('counts enqueueCount only for users where a question was actually enqueued', async () => {
    const enqueue = jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const { cron, log } = makeCron({ userIds: ['user-1', 'user-2'], enqueue });

    await cron.topUpFeedQueue();

    expect(log).toHaveBeenCalledWith('Processed feed queue top-up', {
      usersProcessed: 2,
      questionsEnqueued: 1,
    });
  });

  it('does nothing (and logs zero) when there are no feed-queue users', async () => {
    const { cron, questionService, log } = makeCron({ userIds: [] });

    await cron.topUpFeedQueue();

    expect(questionService.rotateStaleFeedQuestions).not.toHaveBeenCalled();
    expect(questionService.enqueueNextFeedQueueQuestion).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('Processed feed queue top-up', {
      usersProcessed: 0,
      questionsEnqueued: 0,
    });
  });
});
