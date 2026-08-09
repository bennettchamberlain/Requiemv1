import type { FeatureService } from '@ci/common/feature';
import type { LoggerService } from '@ci/common/logging';
import type { EventService } from '@ci/domains/events';
import type { QuestionService } from '@ci/domains/intelligence';

import { SmartRotationWorkEvent } from '../../events';
import { SMART_ROTATION_QUEUE } from '../../types';
import { SmartRotationService } from '../SmartRotationService';

function createService(overrides: {
  dataSource?: { query: jest.Mock };
  questionService?: Partial<QuestionService>;
  eventService?: { send: jest.Mock };
  featureService?: { isFeatureEnabled: jest.Mock };
} = {}) {
  const dataSource = overrides.dataSource ?? { query: jest.fn().mockResolvedValue([{ count: '0' }]) };
  const questionService = (overrides.questionService ?? {}) as QuestionService;
  const eventService = (overrides.eventService ?? { send: jest.fn().mockResolvedValue(['job-1']) }) as unknown as EventService;
  const featureService = (overrides.featureService ?? {
    isFeatureEnabled: jest.fn().mockResolvedValue(true),
  }) as unknown as FeatureService;
  const logger = { setContext() {}, log() {}, warn() {}, error() {} } as unknown as LoggerService;

  return {
    service: new SmartRotationService(dataSource as never, questionService, eventService, featureService, logger),
    dataSource,
    questionService,
    eventService,
    featureService,
  };
}

describe('SmartRotationService.enqueueWork', () => {
  it('uses a singleton key on the smart-rotation queue', async () => {
    const send = jest.fn().mockResolvedValue(['job-1']);
    const { service } = createService({ eventService: { send } });

    await service.enqueueWork('user-1', 'question_feed');

    expect(send).toHaveBeenCalledWith(
      SmartRotationWorkEvent,
      { userId: 'user-1', workType: 'question_feed' },
      {
        queue: SMART_ROTATION_QUEUE,
        singletonKey: 'smart-rotation:user-1:question_feed',
        priority: -2,
      },
    );
  });
});

describe('SmartRotationService.runScheduledWork', () => {
  it('returns early when smart.rotation is disabled', async () => {
    const { service } = createService({
      featureService: { isFeatureEnabled: jest.fn().mockResolvedValue(false) },
    });

    await expect(service.runScheduledWork('question_feed')).resolves.toBe(0);
  });

  it('enqueues work for users in the round-robin batch', async () => {
    const send = jest.fn().mockResolvedValue(['job-1']);
    const { service } = createService({
      eventService: { send },
      questionService: {
        listFeedQueueUserIds: jest.fn().mockResolvedValue(['user-1', 'user-2']),
      },
    });

    await expect(service.runScheduledWork('schedule_sync', 2)).resolves.toBe(2);

    expect(send).toHaveBeenCalledTimes(2);
  });
});
