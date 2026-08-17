import { Injectable, OnApplicationBootstrap } from '@nestjs/common';

import type { UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import { Cron } from '@ci/common/schedule';
import { UserService } from '@ci/domains/user';

import { PlaceTransitionService } from '../places/PlaceTransitionService';
import { DailyMetricsService, DEFAULT_REFRESH_WINDOW_DAYS } from '../services/DailyMetricsService';

/** Hourly at minute 10 — staggered from the activity rollup's :00/:15/:30/:45 ticks. */
const DAILY_METRICS_CRON = '0 10 * * * *';

/** Shorter window for the recurring tick; bootstrap still backfills a full month. */
const CRON_WINDOW_DAYS = 2;

@Injectable()
export class DailyMetricsCron implements OnApplicationBootstrap {
  private running = false;

  constructor(
    private readonly dailyMetricsService: DailyMetricsService,
    private readonly placeTransitionService: PlaceTransitionService,
    private readonly userService: UserService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(DailyMetricsCron.name);
  }

  /**
   * Kick a 30-day backfill at startup so a fresh install has rows before the
   * first hourly tick. Fire-and-forget; boot must not wait on it.
   */
  onApplicationBootstrap() {
    void this.refresh({ windowDays: DEFAULT_REFRESH_WINDOW_DAYS });
  }

  @Cron(DAILY_METRICS_CRON)
  async refreshRecent() {
    await this.refresh({ windowDays: CRON_WINDOW_DAYS });
  }

  private async refresh(options: { windowDays: number }) {
    if (this.running) {
      this.logger.warn('Skipping daily metrics refresh; previous run still in progress');

      return;
    }

    this.running = true;

    try {
      await this.dailyMetricsService.refreshAll(options.windowDays);
    } catch (err) {
      this.logger.error('Daily metrics refresh failed', err instanceof Error ? err : new Error(String(err)));
    }

    try {
      await this.refreshPlaces();
    } catch (err) {
      this.logger.error('Place engine refresh failed', err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.running = false;
    }
  }

  /**
   * Rebuild stay-point clusters + recency-decayed transitions for every user,
   * then score elapsed place_forecast_log rows. Failures for one user do not
   * abort the rest of the run.
   */
  private async refreshPlaces(): Promise<void> {
    const users = await this.userService.findAll();
    this.logger.log('Refreshing place engine', { users: users.length });

    for (const user of users) {
      const timezone = user.timezone || 'UTC';
      const context: UserServiceContext = { userId: user.id };

      try {
        await this.placeTransitionService.rebuild(context, { timezone });
        await this.placeTransitionService.scoreLog(context);
      } catch (err) {
        this.logger.error(
          `Place engine refresh failed for user ${user.id} (${timezone})`,
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    }
  }
}
