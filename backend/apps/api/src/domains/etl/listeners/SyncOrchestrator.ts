import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';

import { EventService } from '@ci/domains/events';
import { LoggerService } from '@ci/common/logging';
import {
  ClientFactory,
  ConnectionService,
} from '@ci/domains/connections';

import {Cron} from "@ci/common/schedule";
import {ConnectionSyncJobService} from "@ci/domains/etl";
import { ConnectionSyncJobCreatedEvent} from "../events";

@Injectable()
export class SyncOrchestrator {
  constructor(
    private readonly clientFactory: ClientFactory,
    private readonly connectionService: ConnectionService,
    private readonly connectionSyncJobService: ConnectionSyncJobService,
    private readonly eventService: EventService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(SyncOrchestrator.name);
  }

  /**
   * Main entry point for ETL sync - handles sync for any connection type
   */

  @Cron(CronExpression.EVERY_MINUTE)
  async orchestrateSyncJobs(): Promise<void> {
    console.log('Starting sync orchestration');
    const activeConnections = await this.connectionService.findActiveConnections();

    activeConnections.forEach(({ connection }) => {
      connection.activeEndpoints.forEach(async endpoint => {
        const providerEndpoint = connection.provider!.endpoints.find((e) => e.name === endpoint);
        if (!providerEndpoint) {
          this.logger.error('Active endpoint not found on provider', {
            connectionId: connection.id,
            endpoint,
          });

          return;
        }
        const iterationType = providerEndpoint.iterationType;

        const iterationTypes = iterationType.split(',');

        if (iterationTypes.includes('incremental')) {
          const existingIncrementalSyncs = await this.connectionSyncJobService.search({ userId: connection.userId }, {
            connectionId: connection.id,
            userId: connection.userId,
            endpointName: endpoint,
            type: 'incremental',
          });

          if (existingIncrementalSyncs.length === 0) {
            const newJob = await this.connectionSyncJobService.create({ userId: connection.userId }, {
              connectionId: connection.id,
              userId: connection.userId,
              endpointName: endpoint,
              type: 'incremental',
              status: 'pending',
            });

            await this.eventService.send(ConnectionSyncJobCreatedEvent, {
              connectionSyncJobId: newJob.id,
            });
          }

          const sync0 = existingIncrementalSyncs[0];

          if (sync0.status === 'in_progress' || sync0.status === 'failed') {
            return;
          }

          if (sync0.status === 'success') {
            const newJob = await this.connectionSyncJobService.create({ userId: connection.userId }, {
              connectionId: connection.id,
              userId: connection.userId,
              endpointName: endpoint,
              type: 'incremental',
              status: 'pending',
            });

            await this.eventService.send(ConnectionSyncJobCreatedEvent, {
              connectionSyncJobId: newJob.id,
            });
          }
        }

        if (iterationTypes.includes('historical')) {
          const existingHistoricalSyncs = await this.connectionSyncJobService.search({ userId: connection.userId }, {
            connectionId: connection.id,
            userId: connection.userId,
            endpointName: endpoint,
            type: 'historical',
          });

          if (existingHistoricalSyncs.length === 0) {
            const newJob = await this.connectionSyncJobService.create({ userId: connection.userId }, {
              connectionId: connection.id,
              userId: connection.userId,
              endpointName: endpoint,
              type: 'historical',
              status: 'pending',
            });

            await this.eventService.send(ConnectionSyncJobCreatedEvent, {
              connectionSyncJobId: newJob.id,
            });
          }

          const sync0 = existingHistoricalSyncs[0];

          if (sync0.status === 'success') {
            if (sync0.nextCursor != null) {
              const newJob = await this.connectionSyncJobService.create({ userId: connection.userId }, {
                connectionId: connection.id,
                userId: connection.userId,
                endpointName: endpoint,
                type: 'historical',
                status: 'pending',
                cursor: sync0.nextCursor,
              });

              await this.eventService.send(ConnectionSyncJobCreatedEvent, {
                connectionSyncJobId: newJob.id,
              });
            }

            if (sync0.nextCursor == null && sync0.completedAt && providerEndpoint.TTL != null) {
              const dateNow = new Date().getTime();
              const completedAt = new Date(sync0.completedAt).getTime();

              if (dateNow > completedAt + (providerEndpoint.TTL * 1000)) {
                const newJob = await this.connectionSyncJobService.create({ userId: connection.userId }, {
                  connectionId: connection.id,
                  userId: connection.userId,
                  endpointName: endpoint,
                  type: 'historical',
                  status: 'pending',
                });

                await this.eventService.send(ConnectionSyncJobCreatedEvent, {
                  connectionSyncJobId: newJob.id,
                });
              }
            }
          }
        }
      });
    });
  }
}
