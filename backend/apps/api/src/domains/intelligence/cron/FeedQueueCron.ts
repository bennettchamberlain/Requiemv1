import { Injectable } from '@nestjs/common';

import { FeatureService } from '@ci/common/feature';
import { LoggerService } from '@ci/common/logging';
import { Cron } from '@ci/common/schedule';

import { QuestionService } from '../services/QuestionService';

const FEED_QUEUE_CRON = '0 */20 * * * *';
const FEED_QUEUE_LIMIT = 3;

@Injectable()
export class FeedQueueCron {
  constructor(
    private readonly questionService: QuestionService,
    private readonly logger: LoggerService,
    private readonly featureService: FeatureService,
  ) {
    this.logger.setContext(FeedQueueCron.name);
  }

  @Cron(FEED_QUEUE_CRON)
  async topUpFeedQueue() {
    if (await this.featureService.isFeatureEnabled('smart.rotation')) {
      return;
    }

    const userIds = await this.questionService.listFeedQueueUserIds();
    let enqueueCount = 0;

    for (const userId of userIds) {
      await this.questionService.rotateStaleFeedQuestions(userId);
      const enqueued = await this.questionService.enqueueNextFeedQueueQuestion(userId, FEED_QUEUE_LIMIT);

      if (enqueued) {
        enqueueCount += 1;
      }
    }

    this.logger.log('Processed feed queue top-up', {
      usersProcessed: userIds.length,
      questionsEnqueued: enqueueCount,
    });
  }
}
