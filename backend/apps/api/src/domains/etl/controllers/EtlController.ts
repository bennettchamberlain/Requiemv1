import { Controller } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';

import { type RequestContext } from '@ci/common/context';
import { FeatureService } from '@ci/common/feature';
import { LoggerService } from '@ci/common/logging';
import { Cron } from '@ci/common/schedule';
import { type Connection, ConnectionService } from '@ci/domains/connections';

import { EtlService } from '../services/EtlService';

@Controller('etl')
export class EtlController {
  constructor(
    private readonly connectionService: ConnectionService,
    private readonly etlService: EtlService,
    private readonly logger: LoggerService,
    private readonly featureService: FeatureService,
  ) {
    this.logger.setContext(EtlController.name);
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async syncConnections(): Promise<void> {
    const featureEnabled = await this.featureService.isFeatureEnabled('scheduled.connection.sync');

    if (!featureEnabled) {
      return;
    }

    try {
      const connections = await this.connectionService.findActiveConnections();
      const now = new Date();

      for (const connection of connections) {
        if (this.shouldSyncConnection(connection.connection, connection.lastSyncedAt, now)) {
          await this.syncConnection(connection.connection);
        }
      }
    } catch (error) {
      this.logger.error('Error syncing connections', error as Error);
    }
  }

  private shouldSyncConnection(connection: Connection, lastSyncedAt: Date | null, now: Date): boolean {
    if (!connection.schedule) {
      return false;
    }

    // Use lastSyncedAt if available, otherwise use createdAt
    const lastSync = lastSyncedAt || connection.createdAt;
    const timeSinceLastSync = now.getTime() - lastSync.getTime();

    const scheduleInterval = this.getScheduleIntervalMs(connection.schedule);

    return timeSinceLastSync >= scheduleInterval;
  }

  private getScheduleIntervalMs(schedule: string): number {
    const intervals: Record<string, number> = {
      '1 min': 1 * 60 * 1000, // 1 minute
      '5 min': 5 * 60 * 1000, // 5 minutes
      '10 min': 10 * 60 * 1000, // 10 minutes
      '30 min': 30 * 60 * 1000, // 30 minutes
      '1 hour': 60 * 60 * 1000, // 1 hour
      '2 hours': 2 * 60 * 60 * 1000, // 2 hours
      '6 hours': 6 * 60 * 60 * 1000, // 6 hours
      '12 hours': 12 * 60 * 60 * 1000, // 12 hours
      daily: 24 * 60 * 60 * 1000, // 24 hours
      weekly: 7 * 24 * 60 * 60 * 1000, // 7 days
    };

    return intervals[schedule] || 60 * 60 * 1000;
  }

  private async syncConnection(connection: Connection): Promise<void> {
    try {
      await this.etlService.handleConnectionSync(
        { userId: connection.userId } as RequestContext,
        connection.id,
      );
    } catch (error) {
      this.logger.error('Error syncing connection', {
        connectionId: connection.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}
