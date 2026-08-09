import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { LoggerService } from '@ci/common/logging';

import { PythonFunctionService } from '../services/PythonFunctionService';
import type { PythonFunctionTarget } from '../types';

/**
 * The scheduler half of the Temporal replacement. These crons replicate the
 * former Temporal Schedules (summary system_schedules.py + HBPE schedule.py):
 * each tick enumerates onboarded users and enqueues ONE pg-boss job per user,
 * deduplicated by a window-scoped singleton key — so a slow run never stacks a
 * second copy of the same user+window, and per-user failures retry
 * independently instead of failing a whole fan-out batch.
 *
 * Cron layout (UTC, matching the old Temporal cadence — nightly HBPE at 02:30
 * deliberately lands after daily summaries at 00:10 and dossier refresh at :12):
 * - hourly summaries  :05 every hour
 * - daily summaries   00:10
 * - weekly summaries  00:15 Monday
 * - monthly summaries 00:20 on the 1st
 * - dossier refresh   :12 every hour
 * - insights          :30 every 3 hours
 * - actions           :45 every hour
 * - HBPE nightly      02:30
 * - HBPE bootstrap    app start + 03:00 daily sweep (no-op for warm users)
 *
 * Per-user window resolution (timezones) and personalization stay inside the
 * Python functions — the cron only sends the user id and a reference instant.
 */
@Injectable()
export class PythonFunctionCrons implements OnApplicationBootstrap {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly pythonFunctionService: PythonFunctionService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(PythonFunctionCrons.name);
  }

  /** Sweep cold users into bootstrap shortly after the API comes up. */
  onApplicationBootstrap(): void {
    // Fire-and-forget: pg-boss may still be initialising its queues during
    // bootstrap, and a failed sweep is retried by the daily cron anyway.
    setTimeout(() => {
      this.ensureHbpeBootstrap().catch((err) => {
        this.logger.warn('HBPE bootstrap sweep at startup failed', { err });
      });
    }, 30_000);
  }

  @Cron('0 5 * * * *')
  async hourlySummaries(): Promise<void> {
    await this.fanOut('summary', 'hourly_summary', hourKey());
  }

  @Cron('0 10 0 * * *')
  async dailySummaries(): Promise<void> {
    await this.fanOut('summary', 'daily_summary', dayKey(), { reference_time: new Date().toISOString() });
  }

  @Cron('0 15 0 * * 1')
  async weeklySummaries(): Promise<void> {
    await this.fanOut('summary', 'weekly_summary', dayKey(), { reference_time: new Date().toISOString() });
  }

  @Cron('0 20 0 1 * *')
  async monthlySummaries(): Promise<void> {
    await this.fanOut('summary', 'monthly_summary', dayKey(), { reference_time: new Date().toISOString() });
  }

  @Cron('0 12 * * * *')
  async dossierRefresh(): Promise<void> {
    await this.fanOut('summary', 'dossier_refresh', hourKey(), { lookback_days: 30 });
  }

  @Cron('0 30 */3 * * *')
  async insights(): Promise<void> {
    await this.fanOut('summary', 'insights_generation', hourKey(), { lookback_hours: 72 });
  }

  @Cron('0 45 * * * *')
  async actions(): Promise<void> {
    await this.fanOut('summary', 'actions_generation', hourKey(), { lookback_days: 7 });
  }

  @Cron('0 30 2 * * *')
  async hbpeNightly(): Promise<void> {
    await this.fanOut('hbpe', 'nightly', dayKey());
  }

  @Cron('0 0 3 * * *')
  async hbpeBootstrapSweep(): Promise<void> {
    await this.ensureHbpeBootstrap();
  }

  private async ensureHbpeBootstrap(): Promise<void> {
    await this.fanOut('hbpe', 'ensure_bootstrap', dayKey());
  }

  private async fanOut(
    target: PythonFunctionTarget,
    functionName: string,
    windowKey: string,
    args: Record<string, unknown> = {},
  ): Promise<void> {
    const userIds = await this.listOnboardedUserIds();

    if (userIds.length === 0) {
      return;
    }

    let enqueued = 0;

    for (const userId of userIds) {
      try {
        const didEnqueue = await this.pythonFunctionService.dispatch(target, functionName, userId, args, {
          singletonKey: `fn:${functionName}:${userId}:${windowKey}`,
        });

        if (didEnqueue) {
          enqueued += 1;
        }
      } catch (err) {
        this.logger.error(
          `Failed to enqueue ${functionName} for user ${userId}`,
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    }

    this.logger.log('Python function fan-out enqueued', {
      target,
      functionName,
      users: userIds.length,
      enqueued,
    });
  }

  /** Same population the Temporal system workflows fanned out over. */
  private async listOnboardedUserIds(): Promise<string[]> {
    type Row = { id: string };

    const rows = (await this.dataSource.query('SELECT id FROM ci.users WHERE onboarded = true')) as Row[];

    return rows.map((row) => String(row.id));
  }
}

/** Window key for hourly-cadence work: dedupes within the current UTC hour. */
function hourKey(now = new Date()): string {
  return now.toISOString().slice(0, 13);
}

/** Window key for daily-cadence work: dedupes within the current UTC day. */
function dayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}
