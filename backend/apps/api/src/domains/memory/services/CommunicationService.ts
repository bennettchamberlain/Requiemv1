import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { LoggerService } from '@ci/common/services';
import { type RequestContext } from '@ci/common/types';

import { CommunicationEntity } from '../entities/CommunicationEntity';

export interface CreateCommunicationDto {
  time: Date;
  communication_type: 'email' | 'sms' | 'call';
  direction: 'inbound' | 'outbound';
  thread_id?: string;
  from_entity_id?: string;
  to_entity_ids?: string[];
  participants_metadata?: Record<string, unknown>;
  subject?: string;
  content: string;
  attachments?: unknown[];
  duration_seconds?: number;
  sentiment_score?: number;
  importance_score?: number;
  urgency_score?: number;
  category?: string;
  summary?: string;
  tags?: string[];
  connection_id?: string;
  is_encrypted?: boolean;
  is_archived?: boolean;
}

@Injectable()
export class CommunicationService {
  private logger = new LoggerService(CommunicationService.name);

  constructor(
    @InjectRepository(CommunicationEntity)
    private readonly communicationRepository: Repository<CommunicationEntity>,
  ) {}

  async create(context: RequestContext, data: CreateCommunicationDto): Promise<CommunicationEntity> {
    const communication = this.communicationRepository.create({
      ...data,
      user_id: context.userId,
      participants_metadata: data.participants_metadata || {},
      attachments: data.attachments || [],
      is_encrypted: data.is_encrypted || false,
      is_archived: data.is_archived || false,
    });

    // TODO: Build relationships using from_entity_id and to_entity_ids

    return this.communicationRepository.save(communication);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  findById(context: RequestContext, id: string) {
    throw new Error('Not implemented');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  findByIds(context: RequestContext, ids: string[]): Promise<CommunicationEntity[]> {
    throw new Error('Not implemented');
  }

  async findByThreadId(context: RequestContext, threadId: string): Promise<CommunicationEntity[]> {
    return this.communicationRepository.find({
      where: {
        user_id: context.userId,
        thread_id: threadId,
      },
      order: { time: 'ASC' },
    });
  }

  async findByUserId(context: RequestContext, limit = 100): Promise<CommunicationEntity[]> {
    return this.communicationRepository.find({
      where: {
        user_id: context.userId,
      },
      order: { time: 'DESC' },
      take: limit,
    });
  }
}
