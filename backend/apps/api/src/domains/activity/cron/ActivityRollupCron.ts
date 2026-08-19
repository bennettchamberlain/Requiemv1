import { Injectable, OnApplicationBootstrap } from '@nestjs/common';

import { LoggerService } from '@ci/common/logging';
import { serves } from '@ci/common/roles';
import { Cron } from '@ci/common/schedule';

import { ActivityRollupService } from '../services/ActivityRollupService';

const ACTIVITY_ROLLUP_CRON = '0 */15 * * * *';

@Injectable()
export class ActivityRollupCron implements OnApplicationBootstrap {
  private running = false;

  constructor(
    private readonly activityRollupService: ActivityRollupService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(ActivityRollupCron.name);
  }

  /**
   * Kick one refresh at startup so a fresh install serves data before the
   * first quarter-hour tick. Fire-and-forget; boot must not wait on it.
   */
  onApplicationBootstrap() {
    // Web-role work: the boot refresh duplicated across a split topology is
    // waste, and the in-process `running` guard cannot see the other process.
    if (!serves('web')) {
      return;
    }

    void this.refreshRollup();
  }

  @Cron(ACTIVITY_ROLLUP_CRON, { name: 'ActivityRollupCron.refreshRollup' })
  async refreshRollup() {
    if (this.running) {
      this.logger.warn('Skipping activity rollup refresh; previous run still in progress');

      return;
    }

    this.running = true;

    try {
      await this.activityRollupService.refreshAll();
    } catch (err) {
      this.logger.error(
        'Activity rollup refresh failed',
        err instanceof Error ? err : new Error(String(err)),
      );
    } finally {
      this.running = false;
    }
  }
}
