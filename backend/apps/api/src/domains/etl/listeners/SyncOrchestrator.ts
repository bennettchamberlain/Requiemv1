import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v7 as uuid7 } from 'uuid';
import { CronExpression } from '@nestjs/schedule';

import type { RequestContext, ServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import {
  ClientFactory,
  ConnectionService,
  type Connection,
  type SyncResponse,
} from '@ci/domains/connections';

import {Cron} from "@ci/common/schedule";
import {ConnectionSyncJobService} from "@ci/domains/etl";

@Injectable()
export class SyncOrchestrator {
  constructor(
    private readonly clientFactory: ClientFactory,
    private readonly connectionService: ConnectionService,
    private readonly connectionSyncJobService: ConnectionSyncJobService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(EtlService.name);
  }

  /**
   * Main entry point for ETL sync - handles sync for any connection type
   */

  @Cron(CronExpression.EVERY_MINUTE)
  async orchestrateSyncJobs(): Promise<void> {
    const activeConnections = await this.connectionService.findActiveConnections();

    const activeEndpoints: string[];

    activeConnections.forEach((connection) => {
      for (const endpoint of connection.activeEndpoints) {
        const iterationType = connection.provider.endpoints.find((e) => e.name === endpoint)?.iterationType;

        const iterationTypes = iterationType.split(',');

        if (iterationTypes.includes('incremental')) {
          const existingIncrementalSyncs = await this.connectionSyncJobService.search({
            connectionId: connection.id,
            endpoint,
            iterationType: 'incremental',
          });

          if (existingIncrementalSyncs.length === 0) {
            this.connectionSyncJobService.create({
              connectionId: connection.id,
              endpoint,
              iterationType: 'incremental',
              status: 'pending',
            });

            continue;
          }

          if (existingIncrementalSyncs[0].status === 'in_progress' || existingIncrementalSync[0].status === 'failed') {
            continue;
          }


        }
      }
    });
  }
}
