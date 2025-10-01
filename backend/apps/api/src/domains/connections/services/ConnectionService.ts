import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, Not, IsNull, MoreThan } from 'typeorm';
import { v7 as uuid7 } from 'uuid';

import { LoggerService } from '@ci/common/services/LoggerService';
import type { RequestContext } from '@ci/common/types';
import config from '@ci/configuration';

import { ClientFactory } from '../clients';
import { ConnectionEntity } from '../entities/ConnectionEntity';
import type {
  CreateConnectionDto,
  Connection,
  UpdateConnectionDto,
  UpdateConnectionCredentialsDto,
} from '../types';

@Injectable()
export class ConnectionService {
  private logger = new LoggerService(ConnectionService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(ConnectionEntity)
    private readonly connectionRepository: Repository<ConnectionEntity>,
    private readonly clientFactory: ClientFactory,
  ) {}

  async create(context: RequestContext, data: CreateConnectionDto): Promise<Connection> {
    const { providerId, ...rest } = data;

    const sanitizedData = {
      ...rest,
      clientid: rest.clientid?.trim(),
      clientsecret: rest.clientsecret?.trim(),
    };

    const instance = this.connectionRepository.create({
      ...sanitizedData,
      id: uuid7(),
      active: true,
      user: {
        id: context.userId,
      },
      provider: {
        id: providerId,
      },
    });

    const entity = await this.connectionRepository.save(instance);

    return this.findOne(context, entity.id);
  }

  async findAll(context: RequestContext): Promise<Connection[]> {
    const entities = await this.connectionRepository.find({
      where: {
        user: {
          id: context.userId,
        },
      },
      relations: ['provider'],
    });

    return entities.map((entity) => entity.toConnection());
  }

  async findOne(context: RequestContext, id: string): Promise<Connection> {
    const entity = await this.connectionRepository.findOne({
      where: {
        id,
        user: {
          id: context.userId,
        },
      },
      relations: ['provider'],
    });

    if (entity == null) {
      throw new NotFoundException();
    }

    return entity.toConnection();
  }

  async update(
    context: RequestContext,
    id: string,
    data: UpdateConnectionDto & UpdateConnectionCredentialsDto,
  ): Promise<Connection> {
    const updatePayload: UpdateConnectionDto = {
      ...data,
      clientid: data.clientid?.trim(),
      clientsecret: data.clientsecret?.trim(),
    };

    const result = await this.connectionRepository.update(
      {
        id,
        user: {
          id: context.userId,
        },
      },
      updatePayload,
    );

    if (result.affected === 0) {
      throw new NotFoundException();
    }

    const updated = await this.findOne(context, id);

    return updated;
  }

  async delete(context: RequestContext, id: string): Promise<boolean> {
    const result = await this.connectionRepository.delete({
      id,
      user: {
        id: context.userId,
      },
    });

    if (result.affected === 0) {
      throw new NotFoundException();
    }

    return true;
  }

  async findSyncTargetsByUserId(): Promise<Map<string, string[]>> {
    type Row = {
      id: string;
      user_id: string;
    };

    const rows = (await this.dataSource.query(`
      SELECT
        connections.id as id,
        connections.user_id as user_id
      FROM
        connections
      WHERE active = true 
        AND access_token IS NOT NULL 
        AND token_expiry > NOW();
    `)) satisfies Array<Row>;

    const groupedByUserId = new Map<string, string[]>();

    for (const row of rows) {
      const userId = row.user_id;

      if (!groupedByUserId.has(userId)) {
        groupedByUserId.set(userId, []);
      }

      groupedByUserId.get(userId)!.push(row.id);
    }

    return groupedByUserId;
  }

  async getAuthorizationUrl(connection: Connection, providerId?: string) {
    const resolvedProviderId = providerId ?? connection.provider?.id;
    const client = this.clientFactory.getClientByProviderId(resolvedProviderId);

    return client.getAuthorizationUrl(connection);
  }

  async connect(context: RequestContext, connectionId: string): Promise<{ url: string }> {
    const connection = await this.findOne(context, connectionId);
    const client = this.clientFactory.getClientByProviderId(connection.provider?.id);

    return {
      url: await client.getAuthorizationUrl(connection),
    };
  }

  async callback(context: RequestContext, connectionId: string, code: string): Promise<Connection> {
    const connection = await this.findOne(context, connectionId);
    const client = this.clientFactory.getClientByProviderId(connection.provider?.id);
    const tokenExchange = await client.exchangeAuthorizationCode(connection, code);

    return this.update(context, connectionId, {
      ...tokenExchange,
    });
  }

  async sync(context: RequestContext, connectionId: string) {
    this.logger.log('Starting manual sync for connection', {
      connectionId,
      userId: context.userId,
    });

    try {
      const connection = await this.findOne(context, connectionId);
      const client = this.clientFactory.getClientByProviderId(connection.provider?.id);
      const syncResponse = await client.sync(connection);

      this.logger.log('Sync completed', {
        connectionId,
        userId: context.userId,
        success: syncResponse.success,
        message: syncResponse.message,
      });

      return syncResponse;
    } catch (error) {
      this.logger.error('Sync failed', {
        connectionId,
        userId: context.userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      throw error;
    }
  }

  async findById(connectionId: string): Promise<Connection | null> {
    const entity = await this.connectionRepository.findOne({
      where: { id: connectionId },
      relations: ['user', 'provider'],
    });

    return entity?.toConnection() ?? null;
  }

  async findActiveGoogleConnections(): Promise<Array<Connection & { userId: string }>> {
    const entities = await this.connectionRepository.find({
      where: {
        active: true,
        provider: {
          id: config.auth.providers.google.id, // Use the actual Google provider ID from config
        },
        accessToken: Not(IsNull()), // Must have an access token
        tokenExpiry: MoreThan(new Date()), // Token must not be expired
      },
      relations: ['user', 'provider'],
    });

    this.logger.log('Found authenticated Google connections', {
      count: entities.length,
      connections: entities.map((entity) => ({
        id: entity.id,
        userId: entity.user?.id,
        hasAccessToken: !!entity.accessToken,
        tokenExpiry: entity.tokenExpiry,
        isExpired: entity.tokenExpiry ? entity.tokenExpiry < new Date() : true,
      })),
    });

    return entities.map((entity) => ({
      ...entity.toConnection(),
      userId: entity.user?.id || '',
    }));
  }

  async makePaginatedRequest(connectionId: string, endpoint: string): Promise<unknown> {
    const connection = await this.findById(connectionId);
    if (!connection) {
      throw new Error('Connection not found');
    }

    const client = this.clientFactory.getClientByProviderId(connection.provider?.id);

    // Use the client's request method to make the API call
    return await client.request(connection, endpoint);
  }

  async updateSyncState(connectionId: string, syncState: Record<string, unknown>): Promise<void> {
    const entity = await this.connectionRepository.findOne({ where: { id: connectionId } });
    if (!entity) {
      throw new Error('Connection not found');
    }

    entity.syncState = syncState;
    await this.connectionRepository.save(entity);

    this.logger.log('Updated connection sync state', {
      connectionId,
      syncStateKeys: Object.keys(syncState),
    });
  }
}
