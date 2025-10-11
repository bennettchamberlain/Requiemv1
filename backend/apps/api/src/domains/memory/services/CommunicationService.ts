import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { LoggerService } from '@ci/common/services';

import { CommunicationEntity } from '../entities/CommunicationEntity';

export interface CreateCommunicationDto {
  time: Date;
  user_id: string;
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

  async create(data: CreateCommunicationDto): Promise<CommunicationEntity> {
    const communication = this.communicationRepository.create({
      ...data,
      participants_metadata: data.participants_metadata || {},
      attachments: data.attachments || [],
      is_encrypted: data.is_encrypted || false,
      is_archived: data.is_archived || false,
    });

    return this.communicationRepository.save(communication);
  }

  async findByThreadId(threadId: string): Promise<CommunicationEntity[]> {
    return this.communicationRepository.find({
      where: { thread_id: threadId },
      order: { time: 'ASC' },
    });
  }

  async findByUserId(userId: string, limit = 100): Promise<CommunicationEntity[]> {
    return this.communicationRepository.find({
      where: { user_id: userId },
      order: { time: 'DESC' },
      take: limit,
    });
  }
}
