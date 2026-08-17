import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { LoggerService } from '@ci/common/logging';

import { type AskAnswer, AskAnswerEntity } from '../entities/AskAnswerEntity';
import type { CreateAskAnswerDto } from '../types';

/**
 * Persists and retrieves the disclosure-filtered {@link AskAnswerEntity}. The
 * answer holds only entity references + a templated summary; the raw matching
 * nodes never leave the box. Visibility is enforced by the caller against the
 * parent ask (asker or responder), so this service does not re-scope by user.
 */
@Injectable()
export class AskAnswerService {
  constructor(
    @InjectRepository(AskAnswerEntity)
    private readonly answerRepository: Repository<AskAnswerEntity>,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(AskAnswerService.name);
  }

  /** Store the answer produced for an ask (one per ask; upserts on re-run). */
  async create(data: CreateAskAnswerDto): Promise<AskAnswer> {
    const existing = await this.answerRepository.findOne({ where: { askId: data.askId } });

    const record = this.answerRepository.create({
      id: existing?.id ?? data.id ?? uuidv7(),
      askId: data.askId,
      form: data.answer.form,
      answerSource: data.answerSource ?? 'peer',
      summary: data.answer.summary,
      disclosedEntities: data.answer.items,
      disclosedCount: data.answer.disclosedCount,
      withheldCount: data.answer.withheldCount,
      consentBasis: data.answer.consentBasis,
    });

    const entity = await this.answerRepository.save(record);

    return AskAnswerEntity.toEgressType(entity);
  }

  /** The answer for an ask, or null if it has not been answered yet. */
  async findByAskId(askId: string): Promise<AskAnswer | null> {
    const entity = await this.answerRepository.findOne({ where: { askId } });

    return entity ? AskAnswerEntity.toEgressType(entity) : null;
  }
}
