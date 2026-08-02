import { Injectable } from '@nestjs/common';

import { type UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import { ConnectionService } from '@ci/domains/connections';

import { ConnectionSyncJobService } from './ConnectionSyncJobService';

export interface SyncNowResult {
  jobIds: string[];
  enqueued: number;
  skipped: number;
}

@Injectable()
export class SyncNowService {
  constructor(
    private readonly connectionService: ConnectionService,
    private readonly connectionSyncJobService: ConnectionSyncJobService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(SyncNowService.name);
  }

  /**
   * Enqueue pending incremental sync jobs for each active endpoint on the caller's
   * connections, skipping endpoints that already have pending/in-progress work.
   */
  async enqueueForUser(context: UserServiceContext): Promise<SyncNowResult> {
    const connections = await this.connectionService.findAll(context);
    const activeConnections = connections.filter((c) => c.active && !c.needsReauth);

    const jobIds: string[] = [];
    let skipped = 0;

    for (const connection of activeConnections) {
      for (const endpoint of connection.activeEndpoints) {
        const existing = await this.connectionSyncJobService.search(context, {
          connectionId: connection.id,
          userId: context.userId,
          endpointName: endpoint,
          orderBy: 'updated_at:DESC',
        });

        const hasPendingOrRunning = existing.some(
          (job) =>
            job.status === 'pending' ||
            (job.status === 'in_progress' &&
              Date.now() - new Date(job.updatedAt).getTime() < 60 * 60 * 1000),
        );

        if (hasPendingOrRunning) {
          skipped += 1;
          continue;
        }

        const job = await this.connectionSyncJobService.create(context, {
          connectionId: connection.id,
          userId: context.userId,
          endpointName: endpoint,
          type: 'incremental',
          status: 'pending',
        });

        jobIds.push(job.id);
      }
    }

    return {
      jobIds,
      enqueued: jobIds.length,
      skipped,
    };
  }
}
