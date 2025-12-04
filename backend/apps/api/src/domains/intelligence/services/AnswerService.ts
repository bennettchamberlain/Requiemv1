import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import type { ServiceContext, UserServiceContext } from '@ci/common/types';
import { SYSTEM_USER } from '@ci/common/types';
import { EventService } from '@ci/domains/events';
import { AnswerCreatedEvent, AnswerUpdatedEvent, AnswerRemovedEvent } from '@ci/domains/intelligence/events';

import { Answer, AnswerEntity } from '../entities/AnswerEntity';
import type { CreateAnswerDto, UpdateAnswerDto } from '../types';

@Injectable()
export class AnswerService {
  constructor(
    @InjectRepository(AnswerEntity)
    private readonly answerRepository: Repository<AnswerEntity>,
    private readonly eventService: EventService,
  ) {}

  async create(context: UserServiceContext, data: CreateAnswerDto): Promise<Answer> {
    const instance = this.answerRepository.create({
      id: data.id ?? uuidv7(),
      answer: data.text,
      question: {
        id: data.question.id,
      },
      user: {
        id: context.userId,
      },
    });

    const entity = await this.answerRepository.save(instance);

    await this.eventService.send(AnswerCreatedEvent, {
      answerId: entity.id,
    });

    return AnswerEntity.toEgressType(entity);
  }

  async findAll(context: UserServiceContext): Promise<Answer[]> {
    const result = await this.answerRepository.find({
      where: {
        user: {
          id: context.userId,
        },
      },
      relations: ['user', 'question'],
    });

    return result.map((entity) => AnswerEntity.toEgressType(entity));
  }

  async findByIds(context: ServiceContext, ids: string[]): Promise<Answer[]> {
    if (ids.length === 0) {
      return [];
    }

    const result = await this.answerRepository.find({
      where: {
        ...(context.userId !== SYSTEM_USER && {
          user: { id: context.userId },
        }),
        id: In(ids),
      },
      relations: ['user', 'question'],
    });

    return result.map((entity) => AnswerEntity.toEgressType(entity));
  }

  async findById(context: ServiceContext, id: string): Promise<Answer | null> {
    const result = await this.answerRepository.findOne({
      where: {
        ...(context.userId !== SYSTEM_USER && {
          user: { id: context.userId },
        }),
        id: id,
      },
      relations: ['user', 'question'],
    });

    return result ? AnswerEntity.toEgressType(result) : null;
  }

  async findByQuestionId(context: ServiceContext, questionId: string): Promise<Answer | null> {
    const result = await this.answerRepository.findOne({
      where: {
        ...(context.userId !== SYSTEM_USER && {
          user: { id: context.userId },
        }),
        question: {
          id: questionId,
        },
      },
      relations: ['user', 'question'],
    });

    return result ? AnswerEntity.toEgressType(result) : null;
  }

  async update(context: ServiceContext, id: string, data: UpdateAnswerDto): Promise<Answer | null> {
    const updateData: Partial<AnswerEntity> = {};

    if (data.text !== undefined) {
      updateData.answer = data.text;
    }

    if (data.answerConfidence !== undefined) {
      updateData.answerConfidence = data.answerConfidence;
    }

    if (data.answerSource !== undefined) {
      updateData.answerSource = data.answerSource;
    }

    if (data.answerMethod !== undefined) {
      updateData.answerMethod = data.answerMethod;
    }

    if (data.answeredAt !== undefined) {
      updateData.answeredAt = data.answeredAt;
    }

    if (data.sessionContext !== undefined) {
      updateData.sessionContext = data.sessionContext;
    }

    if (data.emotionalState !== undefined) {
      updateData.emotionalState = data.emotionalState;
    }

    if (data.locationContext !== undefined) {
      updateData.locationContext = data.locationContext;
    }

    if (data.extractedEntities !== undefined) {
      updateData.extractedEntities = data.extractedEntities;
    }

    if (data.sentimentScore !== undefined) {
      updateData.sentimentScore = data.sentimentScore;
    }

    if (data.complexityScore !== undefined) {
      updateData.complexityScore = data.complexityScore;
    }

    if (data.isSensitive !== undefined) {
      updateData.isSensitive = data.isSensitive;
    }

    if (data.sharingLevel !== undefined) {
      updateData.sharingLevel = data.sharingLevel;
    }

    const answer = await this.answerRepository.findOne({
      where: {
        id: id,
        ...(context.userId !== SYSTEM_USER && {
          user: { id: context.userId },
        }),
      },
    });

    if (answer) {
      Object.assign(answer, updateData);
      await this.answerRepository.save(answer);
    } else {
      return null;
    }

    await this.eventService.send(AnswerUpdatedEvent, {
      answerId: id,
    });

    return this.findById(context, id);
  }

  async remove(context: ServiceContext, id: string): Promise<boolean> {
    console.log('remove answer', id, context.userId);
    const answer = await this.answerRepository.findOne({
      where: {
        id: id,
        ...(context.userId !== SYSTEM_USER && {
          user: { id: context.userId },
        }),
      },
    });

    console.log('answer to remove', answer);

    if (!answer) {
      return false;
    }

    await this.answerRepository.delete({
      id,
      ...(context.userId !== SYSTEM_USER && {
        user: { id: context.userId },
      }),
    });

    await this.eventService.send(AnswerRemovedEvent, {
      answerId: id,
    });

    return true;
  }
}
