import { Injectable } from '@nestjs/common';

import { FeatureService } from '@ci/common/feature';
import { LoggerService } from '@ci/common/logging';
import { Cron } from '@ci/common/schedule';
import { QuestionService } from '@ci/domains/intelligence';

import { SmartRotationService } from '../services/SmartRotationService';

/** Implements scheduled.entity.promotion — enqueue graph_enrich after scanning pending promotions. */
@Injectable()
export class EntityPromotionCron {
  constructor(
    private readonly featureService: FeatureService,
    private readonly questionService: QuestionService,
    private readonly rotationService: SmartRotationService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(EntityPromotionCron.name);
  }

  @Cron('0 20 */2 * * *', { name: 'EntityPromotionCron.run' })
  async run(): Promise<void> {
    if (!(await this.featureService.isFeatureEnabled('scheduled.entity.promotion'))) {
      return;
    }

    if (!(await this.rotationService.isEnabled())) {
      return;
    }

    const userIds = await this.questionService.listFeedQueueUserIds();
    let enqueued = 0;

    for (const userId of userIds) {
      const didEnqueue = await this.rotationService.enqueueWork(userId, 'graph_enrich');
      if (didEnqueue) {
        enqueued += 1;
      }
    }

    if (enqueued > 0) {
      this.logger.log('Entity promotion cron enqueued graph enrich', { enqueued });
    }
  }
}
