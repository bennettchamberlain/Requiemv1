import { Controller } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { Context } from '@ci/common/decorators';
import { LoggerService } from '@ci/common/services';
import type { RequestContext } from '@ci/common/types';
import config from '@ci/configuration';

import { PromoteService } from '../services/PromoteService';

@Controller('promote')
export class PromoteController {
  private logger = new LoggerService(PromoteController.name);

  constructor(private readonly promoteService: PromoteService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async promoteApiLogs(@Context() context: RequestContext): Promise<void> {
    if (!config.features['scheduled.entity.promotion']) {
      return;
    }

    try {
      await this.promoteService.promoteApiLogs({ userId: context.userId } as RequestContext);
    } catch (error) {
      this.logger.error('Error promoting connections', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}
