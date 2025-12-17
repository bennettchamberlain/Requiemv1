import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, IsNull, MoreThan, Repository } from 'typeorm';
import { v7 as uuid7 } from 'uuid';

import { SYSTEM_USER, UserServiceContext, type ServiceContext } from '@ci/common/context';

import { ConnectionEntity, type Connection } from '../entities/ConnectionEntity';
import type { CreateConnectionDto, UpdateConnectionDto } from '../types';

@Injectable()
export class ConnectionService {
  constructor(
    @InjectRepository(ConnectionEntity)
    private readonly connectionRepository: Repository<ConnectionEntity>,
  ) {}

  async create(context: UserServiceContext, data: CreateConnectionDto): Promise<Connection> {
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

    return ConnectionEntity.toEgressType(entity);
  }

  async findAll(context: ServiceContext): Promise<Connection[]> {
    const entities = await this.connectionRepository.find({
      where: {
        ...(context.userId !== SYSTEM_USER && {
          user: {
            id: context.userId,
          },
        }),
        active: true,
      },
      relations: ['provider'],
    });

    return entities.map((entity) => ConnectionEntity.toEgressType(entity));
  }

  async findByIds(context: ServiceContext, ids: string[]): Promise<Connection[]> {
    const entities = await this.connectionRepository.find({
      where: {
        id: In(ids),
        ...(context.userId !== SYSTEM_USER && {
          user: {
            id: context.userId,
          },
        }),
      },
      relations: ['provider'],
    });

    return entities.map((entity) => ConnectionEntity.toEgressType(entity));
  }

  async findById(context: ServiceContext, id: string): Promise<Connection | null> {
    const entity = await this.connectionRepository.findOne({
      where: {
        id,
        ...(context.userId !== SYSTEM_USER && {
          user: {
            id: context.userId,
          },
        }),
      },
      relations: ['provider'],
    });

    return entity ? ConnectionEntity.toEgressType(entity) : null;
  }

  async update(context: ServiceContext, id: string, data: UpdateConnectionDto): Promise<Connection | null> {
    const { syncState, ...rest } = data;

    const result = await this.connectionRepository.update(
      {
        id,
        ...(context.userId !== SYSTEM_USER && {
          user: {
            id: context.userId,
          },
        }),
      },
      {
        ...rest,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        syncState: syncState as any, // TypeORM will handle JSON serialization
      },
    );

    if (result.affected === 0) {
      return null;
    }

    return this.findById(context, id);
  }

  async remove(context: ServiceContext, id: string): Promise<boolean> {
    const result = await this.connectionRepository.update(
      {
        id,
        ...(context.userId !== SYSTEM_USER && {
          user: {
            id: context.userId,
          },
        }),
      },
      {
        active: false,
      },
    );

    if (result.affected === 0) {
      throw new NotFoundException();
    }

    return true;
  }

  async findActiveConnections() {
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
      connection: ConnectionEntity.toEgressType(entity),
      lastSyncedAt: entity.syncState?.lastSyncedAt ? new Date(entity.syncState.lastSyncedAt as string) : null,
    }));
  }
}
