import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v7 as uuid7 } from 'uuid';

import { LoggerService } from '@ci/common/services';
import type { RequestContext } from '@ci/common/types';
import type { SyncResponse } from '@ci/domains/connections/clients/types';
import { ConnectionService } from '@ci/domains/connections/services/ConnectionService';
import type { Connection } from '@ci/domains/connections/types';

import { ApiLogEntity } from '../entities/ApiLogEntity';

import { GoogleService } from './GoogleService';

@Injectable()
export class EtlService {
  private logger = new LoggerService(EtlService.name);

  constructor(
    @InjectRepository(ApiLogEntity)
    private readonly apiLogRepository: Repository<ApiLogEntity>,
    private readonly connectionService: ConnectionService,
    private readonly googleService: GoogleService,
  ) {}

  /**
   * Main entry point for ETL sync - routes to appropriate handler based on connection type
   */
  async handleConnectionSync(context: RequestContext, connectionId: string): Promise<void> {
    this.logger.log('Starting ETL sync for connection', {
      connectionId,
      userId: context.userId,
    });

    try {
      // Get the connection to determine its type
      const connection = await this.connectionService.findById(connectionId);
      if (!connection) {
        this.logger.error('Connection not found', { connectionId });

        return;
      }

      // Route to appropriate handler based on provider
      const providerName = connection.provider?.name;
      if (providerName === 'Google') {
        await this.handleGoogleSync(context, connection);
      } else {
        this.logger.warn('Unsupported provider for ETL sync', {
          connectionId,
          providerName,
          providerId: connection.provider?.id,
        });
      }
    } catch (error) {
      this.logger.error('Error in ETL sync', {
        connectionId,
        userId: context.userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  private async handleGoogleSync(context: RequestContext, connection: Connection): Promise<void> {
    if (!this.googleService.isConnectionValid(connection)) {
      this.logger.warn('Skipping sync for invalid connection', { connectionId: connection.id });

      return;
    }

    const syncResponses = await this.connectionService.sync(context, connection.id);
    const updatedSyncState = await this.processSyncResponses(context, connection, syncResponses);

    if (Object.keys(updatedSyncState).length > 0) {
      await this.googleService.updateSyncState(connection.id, updatedSyncState);
    }
  }

  private async processSyncResponses(
    context: RequestContext,
    connection: Connection,
    syncResponses: SyncResponse[],
  ): Promise<Record<string, unknown>> {
    let updatedSyncState: Record<string, unknown> = {};

    for (const syncResponse of syncResponses) {
      if (syncResponse.success && syncResponse.data?.results) {
        await this.saveApiLogs(context, connection, syncResponse.data.results);
      }

      if (syncResponse.cursor) {
        updatedSyncState = { ...updatedSyncState, ...(syncResponse.cursor as Record<string, unknown>) };
      }
    }

    return updatedSyncState;
  }

  private async saveApiLogs(
    context: RequestContext,
    connection: Connection,
    results: Array<{ api: string; data: unknown; syncState?: Record<string, unknown> }>,
  ): Promise<void> {
    if (results.length === 0) {
      return;
    }

    const entities = results.map((result) =>
      this.apiLogRepository.create({
        id: uuid7(),
        user_id: context.userId || '',
        connection_id: connection.id,
        scope: result.api,
        content: result.data,
      }),
    );

    await this.apiLogRepository.save(entities);
  }
}
