import { Controller } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { LoggerService } from '@ci/common/services';
import type { RequestContext } from '@ci/common/types';
import config from '@ci/configuration';

import { EtlService } from '../services/EtlService';
import { GoogleService } from '../services/GoogleService';

interface ConnectionWithUser {
  id: string;
  userId: string;
}

@Controller('etl')
export class EtlController {
  private logger = new LoggerService(EtlController.name);

  constructor(
    private readonly etlService: EtlService,
    private readonly googleService: GoogleService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async syncGoogleConnections(): Promise<void> {
    if (!config.features['scheduled.google.sync']) {
      return;
    }

    try {
      const connections = await this.googleService.findActiveConnections();

      for (const connection of connections) {
        await this.syncConnection(connection);
      }
    } catch (error) {
      this.logger.error('Error syncing Google connections', error as Error);
    }
  }

  private async syncConnection(connection: ConnectionWithUser): Promise<void> {
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
