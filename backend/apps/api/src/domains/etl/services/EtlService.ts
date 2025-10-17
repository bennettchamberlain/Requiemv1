import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, IsNull, MoreThan } from 'typeorm';
import { v7 as uuid7 } from 'uuid';

import { LoggerService } from '@ci/common/services';
import type { RequestContext } from '@ci/common/types';
import {
  ConnectionEntity,
  ConnectionService,
  type Connection,
  type SyncResponse,
} from '@ci/domains/connections';

import { ApiLogEntity } from '../entities/ApiLogEntity';

@Injectable()
export class EtlService {
  private logger = new LoggerService(EtlService.name);

  constructor(
    @InjectRepository(ApiLogEntity)
    private readonly apiLogRepository: Repository<ApiLogEntity>,
    @InjectRepository(ConnectionEntity)
    private readonly connectionRepository: Repository<ConnectionEntity>,
    private readonly connectionService: ConnectionService,
  ) {}

  /**
   * Main entry point for ETL sync - handles sync for any connection type
   */
  async handleConnectionSync(context: RequestContext, connectionId: string): Promise<void> {
    this.logger.log('Starting ETL sync for connection', {
      connectionId,
      userId: context.userId,
    });

    try {
      // Get the connection
      const connection = await this.connectionService.findById(connectionId);
      if (!connection) {
        this.logger.error('Connection not found', { connectionId });

        return;
      }

      // Validate connection
      if (!this.isConnectionValid(connection)) {
        this.logger.warn('Skipping sync for invalid connection', { connectionId });

        return;
      }

      // Perform sync
      const syncResponses = await this.connectionService.sync(context, connection.id);
      const updatedSyncState = await this.processSyncResponses(context, connection, syncResponses);

      // Update sync state if there are changes
      if (Object.keys(updatedSyncState).length > 0) {
        await this.updateSyncState(connection.id, updatedSyncState);
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

  private isConnectionValid(connection: Connection): boolean {
    return (
      connection.active &&
      !!connection.accessToken &&
      !!connection.tokenExpiry &&
      connection.tokenExpiry > new Date() &&
      !!connection.provider?.id
    );
  }

  async findActiveConnections(): Promise<
    Array<Connection & { userId: string; lastSyncedAt?: Date; createdAt: Date }>
  > {
    const entities = await this.connectionRepository.find({
      where: [
        {
          active: true,
          accessToken: Not(IsNull()), // Must have an access token
          refreshToken: IsNull(), // No refresh token
          tokenExpiry: MoreThan(new Date()), // Token must not be expired
          provider: { id: Not(IsNull()) }, // Must have a valid provider
        },
        {
          active: true,
          accessToken: Not(IsNull()), // Must have an access token
          refreshToken: Not(IsNull()), //If there's a refresh token, then an expired access token can be refreshed
          provider: { id: Not(IsNull()) }, // Must have a valid provider
        },
      ],
      relations: ['user', 'provider'],
    });

    return entities.map((entity) => ({
      ...entity.toConnection(),
      userId: entity.user?.id || '',
      lastSyncedAt: entity.syncState?.lastSyncedAt
        ? new Date(entity.syncState.lastSyncedAt as string)
        : undefined,
      createdAt: entity.created_at,
    }));
  }

  private async updateSyncState(connectionId: string, syncState: Record<string, unknown>): Promise<void> {
    try {
      const entity = await this.connectionRepository.findOne({ where: { id: connectionId } });
      if (!entity) {
        throw new Error(`Connection not found: ${connectionId}`);
      }

      const existingSyncState = entity.syncState || {};
      const mergedSyncState = {
        ...existingSyncState,
        ...syncState,
        lastSyncedAt: new Date().toISOString(),
      };

      entity.syncState = mergedSyncState;
      await this.connectionRepository.save(entity);
    } catch (error) {
      this.logger.error('Failed to update sync state', {
        connectionId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
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
