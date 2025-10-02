import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, Not, IsNull, MoreThan } from 'typeorm';

import { LoggerService } from '@ci/common/services';
import { ConnectionEntity } from '@ci/domains/connections/entities/ConnectionEntity';
import type { Connection } from '@ci/domains/connections/types';

@Injectable()
export class GoogleService {
  private logger = new LoggerService(GoogleService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(ConnectionEntity)
    private readonly connectionRepository: Repository<ConnectionEntity>,
  ) {}

  async findActiveConnections(): Promise<Array<Connection & { userId: string }>> {
    const entities = await this.connectionRepository.find({
      where: {
        active: true,
        accessToken: Not(IsNull()), // Must have an access token
        tokenExpiry: MoreThan(new Date()), // Token must not be expired
      },
      relations: ['user', 'provider'],
    });

    return entities.map((entity) => ({
      ...entity.toConnection(),
      userId: entity.user?.id || '',
    }));
  }

  async updateSyncState(connectionId: string, syncState: Record<string, unknown>): Promise<void> {
    try {
      const entity = await this.connectionRepository.findOne({ where: { id: connectionId } });
      if (!entity) {
        throw new Error(`Connection not found: ${connectionId}`);
      }

      // Merge with existing sync state
      const existingSyncState = entity.syncState || {};
      const mergedSyncState = { ...existingSyncState, ...syncState };

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

  isConnectionValid(connection: Connection): boolean {
    return (
      connection.active &&
      !!connection.accessToken &&
      !!connection.tokenExpiry &&
      connection.tokenExpiry > new Date()
    );
  }
}
