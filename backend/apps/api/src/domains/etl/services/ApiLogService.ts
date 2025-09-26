import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v7 as uuid7 } from 'uuid';

import { LoggerService } from '@ci/common/services';

import { ApiLogEntity } from '../entities/ApiLogEntity';
import type { ApiLog } from '../types';

@Injectable()
export class ApiLogService {
  private logger = new LoggerService(ApiLogService.name);

  constructor(
    @InjectRepository(ApiLogEntity)
    private readonly apiLogRepository: Repository<ApiLogEntity>,
  ) {}

  async create(data: {
    content: unknown;
    userId: string;
    connectionId?: string;
    scope?: string;
    embedding?: number[];
    location?: { type: 'Point'; coordinates: [number, number] };
  }): Promise<ApiLog> {
    this.logger.log('Creating API log entry', {
      userId: data.userId,
      connectionId: data.connectionId,
      scope: data.scope,
      hasContent: !!data.content,
    });

    const entity = this.apiLogRepository.create({
      id: uuid7(),
      user_id: data.userId,
      connection_id: data.connectionId,
      scope: data.scope,
      content: data.content,
      embedding: data.embedding ? JSON.stringify(data.embedding) : undefined,
      location: data.location,
    });

    const saved = await this.apiLogRepository.save(entity);

    this.logger.log('API log entry created successfully', {
      id: saved.id,
      userId: data.userId,
      connectionId: data.connectionId,
      scope: data.scope,
    });

    return saved.toApiLog();
  }

  async findByUserId(userId: string): Promise<ApiLog[]> {
    const entities = await this.apiLogRepository.find({
      where: { user_id: userId },
      order: { created_at: 'DESC' },
    });

    return entities.map((entity) => entity.toApiLog());
  }

  async findByConnectionId(connectionId: string): Promise<ApiLog[]> {
    const entities = await this.apiLogRepository.find({
      where: { connection_id: connectionId },
      order: { created_at: 'DESC' },
    });

    return entities.map((entity) => entity.toApiLog());
  }
}
