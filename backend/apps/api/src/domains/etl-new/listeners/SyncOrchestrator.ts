import {Injectable} from '@nestjs/common';
import {CronExpression} from '@nestjs/schedule';

import {OnEvent, EventService} from "@ci/domains/events";
import {SYSTEM_USER,} from '@ci/common/context';
import {LoggerService} from '@ci/common/logging';
import {Cron} from '@ci/common/schedule';
import {ConnectionService} from '@ci/domains/connections';

import {ConnectionSyncJobService} from '../services/ConnectionSyncJobService';
import {ConnectionSyncJobExecuteEvent} from '../events';

@Injectable()
export class SyncOrchestrator {
  constructor(
    private readonly connectionService: ConnectionService,
    private readonly connectionSyncJobService: ConnectionSyncJobService,
    private readonly eventService: EventService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(SyncOrchestrator.name);
  }

  /**
   * This method creates sync jobs for connection endpoints that are ready to be run again.
   * For incremental syncs, this is where there are no prior ones, or the last one was successful.
   * For historical syncs, this is where there are no prior ones, or the last one was successful and has a nextCursor,
   * or the last one was successful and has no nextCursor but was completed more than TTL ago.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async orchestrateSyncJobs(): Promise<void> {
    const activeConnections = await this.connectionService.findActiveConnections();

    activeConnections.forEach(({ connection }) => {
      connection.activeEndpoints.forEach(async (endpoint) => {
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
          const existingIncrementalSyncs = await this.connectionSyncJobService.search(
            { userId: connection.userId },
            {
              connectionId: connection.id,
              userId: connection.userId,
              endpointName: endpoint,
              type: 'incremental',
            },
          );

          if (existingIncrementalSyncs.length === 0) {
            await this.connectionSyncJobService.create(
              { userId: connection.userId },
              {
                connectionId: connection.id,
                userId: connection.userId,
                endpointName: endpoint,
                type: 'incremental',
                status: 'pending',
              },
            );
          } else {
            const sync0 = existingIncrementalSyncs[0];

            if (sync0.status === 'in_progress' || sync0.status === 'failed' || sync0.status === 'pending') {
              return;
            }

            if (sync0.status === 'success') {
              await this.connectionSyncJobService.create(
                { userId: connection.userId },
                {
                  connectionId: connection.id,
                  userId: connection.userId,
                  endpointName: endpoint,
                  type: 'incremental',
                  status: 'pending',
                },
              );
            }
          }
        }

        if (iterationTypes.includes('historical')) {
          const existingHistoricalSyncs = await this.connectionSyncJobService.search(
            { userId: connection.userId },
            {
              connectionId: connection.id,
              userId: connection.userId,
              endpointName: endpoint,
              type: 'historical',
            },
          );

          if (existingHistoricalSyncs.length === 0) {
            await this.connectionSyncJobService.create(
              { userId: connection.userId },
              {
                connectionId: connection.id,
                userId: connection.userId,
                endpointName: endpoint,
                type: 'historical',
                status: 'pending',
              },
            );
          } else {
            const sync0 = existingHistoricalSyncs[0];

            if (sync0.status === 'in_progress' || sync0.status === 'failed' || sync0.status === 'pending') {
              return;
            }

            if (sync0.status === 'success') {
              if (Object.keys(sync0.nextCursor).length > 0) {
                await this.connectionSyncJobService.create(
                  { userId: connection.userId },
                  {
                    connectionId: connection.id,
                    userId: connection.userId,
                    endpointName: endpoint,
                    type: 'historical',
                    status: 'pending',
                    cursor: sync0.nextCursor,
                  },
                );
              }

              if (
                Object.keys(sync0.nextCursor).length === 0 &&
                sync0.completedAt &&
                providerEndpoint.TTL != null
              ) {
                const dateNow = new Date().getTime();
                const completedAt = new Date(sync0.completedAt).getTime();

                if (dateNow > completedAt + providerEndpoint.TTL * 1000) {
                  await this.connectionSyncJobService.create(
                    { userId: connection.userId },
                    {
                      connectionId: connection.id,
                      userId: connection.userId,
                      endpointName: endpoint,
                      type: 'historical',
                      status: 'pending',
                    },
                  );
                }
              }
            }
          }
        }
      });
    });
  }

  /**
   * This method finds sync jobs that are ready to be run (status pending) and executes them.
   * It will only execute one endpoint job per connection to avoid rate limits.
   * It will also limit itself to 5 total jobs in progress to avoid overwhelming the system.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async executeSyncJobs(): Promise<void> {
    console.log('executing sync jobs');
    const pendingSyncJobs = await this.connectionSyncJobService.search(
      { userId: SYSTEM_USER },
      {
        status: 'pending',
      },
    );

    console.log('pendingSyncJobs', pendingSyncJobs)

    const inProgressSyncJobs = await this.connectionSyncJobService.search(
      { userId: SYSTEM_USER },
      {
        status: 'in_progress',
      },
    );
    console.log('inProgressSyncJobs', inProgressSyncJobs)

    const connectionsToRun = new Set<string>();
    const syncJobsToRun = new Set<string>();

    for (const syncJob of inProgressSyncJobs) {
      connectionsToRun.add(syncJob.connectionId);
    }

    for (const syncJob of pendingSyncJobs) {
      if (connectionsToRun.has(syncJob.connectionId)) {
        continue;
      } else {
        connectionsToRun.add(syncJob.connectionId);
        syncJobsToRun.add(syncJob.id);
      }

      if (syncJobsToRun.size + inProgressSyncJobs.length >= 5) {
        break;
      }
    }

    console.log('syncJobsToRun', syncJobsToRun)

    for (const jobId of syncJobsToRun) {
      await this.eventService.send(ConnectionSyncJobExecuteEvent, {
        connectionSyncJobId: jobId,
      })
    }
  }

  @OnEvent(ConnectionSyncJobExecuteEvent)
  async handleSyncJobExecuteEvent(payload: { connectionSyncJobId: string }): Promise<void> {
    const syncJob = await this.connectionSyncJobService.findById(
      { userId: SYSTEM_USER },
      payload.connectionSyncJobId,
    );

    if (!syncJob) {
      this.logger.error('Sync job not found for execution', {
        connectionSyncJobId: payload.connectionSyncJobId,
      });

      return;
    }

    await this.connectionSyncJobService.update(
      { userId: SYSTEM_USER },
      syncJob.id,
      {
        status: 'in_progress',
      },
    );
  }
}
