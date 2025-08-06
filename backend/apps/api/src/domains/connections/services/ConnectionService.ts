import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v7 as uuid7 } from 'uuid';

import { LoggerService } from '@ci/common/services/LoggerService';
import type { RequestContext } from '@ci/common/types';

import { ClientFactory } from '../clients';
import { ApiLogEntity } from '../entities/ApiLogEntity';
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
    @InjectRepository(ConnectionEntity)
    private readonly connectionRepository: Repository<ConnectionEntity>,
    @InjectRepository(ApiLogEntity)
    private readonly apiLogRepository: Repository<ApiLogEntity>,
    private readonly clientFactory: ClientFactory,
  ) {}

  async create(context: RequestContext, data: CreateConnectionDto): Promise<Connection> {
    const { providerId, ...rest } = data;

    this.logger.debug('Creating connection', {
      providerId,
      hasClientId: !!rest.clientid,
      hasClientSecret: !!rest.clientsecret,
      userId: context.userId,
    });

    // Ensure credentials are trimmed when saving
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

    this.logger.debug('Connection created', {
      connectionId: entity.id,
      hasClientId: !!entity.clientid,
      hasClientSecret: !!entity.clientsecret,
    });

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

  async findAllActive(): Promise<Array<Connection & { userId: string }>> {
    const entities = await this.connectionRepository
      .createQueryBuilder('connection')
      .leftJoinAndSelect('connection.provider', 'provider')
      .leftJoinAndSelect('connection.user', 'user')
      .where('connection.active = :active', { active: true })
      .andWhere('connection.accessToken IS NOT NULL')
      .getMany();

    return entities.map((entity) => ({
      ...entity.toConnection(),
      userId: entity.user?.id || 'unknown',
    }));
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

  async sync(
    context: RequestContext,
    connectionId: string,
  ): Promise<{ success: boolean; message: string; data?: unknown }> {
    const connection = await this.findOne(context, connectionId);

    if (!connection.accessToken) {
      throw new NotFoundException('Connection not authenticated');
    }

    const provider = connection.provider;
    if (!provider) {
      throw new NotFoundException('Provider not found');
    }

    this.logger.log('Starting manual sync for connection', {
      connectionId,
      providerName: provider.name,
      userId: context.userId,
    });

    try {
      const apiProvider = this.clientFactory.getClientByProviderId(provider.id);

      const syncResponse = await apiProvider.sync(connection);

      await this.apiLogRepository.save({
        id: uuid7(),
        content: JSON.stringify(syncResponse),
        connection: {
          id: connectionId,
        },
        user: {
          id: context.userId,
        },
      });

      this.logger.log('Sync completed', {
        connectionId,
        success: syncResponse.success,
        message: syncResponse.message,
      });

      return syncResponse;
    } catch (error) {
      this.logger.error('Sync failed', {
        connectionId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  async connect(context: RequestContext, connectionId: string): Promise<{ url: string }> {
    const connection = await this.findOne(context, connectionId);

    if (!connection.clientid) {
      throw new Error('OAuth credentials not configured');
    }

    const provider = connection.provider;

    if (provider == null) {
      throw new Error('Connection not associated with a provider');
    }

    const client = this.clientFactory.getClientByProviderId(provider.id);

    return {
      url: await client.getAuthorizationUrl(connection),
    };
  }

  async callback(context: RequestContext, connectionId: string, code: string): Promise<Connection> {
    const connection = await this.findOne(context, connectionId);

    if (connection.clientid == null || connection.clientsecret == null) {
      throw new Error('OAuth credentials not configured');
    }

    const provider = connection.provider;

    if (provider == null) {
      throw new Error('Connection not associated with a provider');
    }

    const client = this.clientFactory.getClientByProviderId(provider.id);

    const tokenExchange = await client.exchangeAuthorizationCode(connection, code);

    return this.update(context, connectionId, {
      ...tokenExchange,
    });
  }
}
