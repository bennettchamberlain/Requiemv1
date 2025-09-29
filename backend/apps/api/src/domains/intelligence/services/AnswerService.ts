import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import type { RequestContext } from '@ci/common/types';

import { AnswerEntity } from '../entities/AnswerEntity';
import type { Answer, UpdateAnswerDto } from '../types';

@Injectable()
export class AnswerService {
  constructor(
    @InjectRepository(AnswerEntity)
    private readonly answerRepository: Repository<AnswerEntity>,
  ) {}

  async findAll(context: RequestContext): Promise<Answer[]> {
    const result = await this.answerRepository.find({
      where: {
        user: {
          id: context.userId,
        },
      },
      relations: ['user', 'question'],
    });

    return result.map((entity) => entity.toAnswer());
  }

  async findSome(context: RequestContext, ids: string[]): Promise<Answer[]> {
    if (ids.length === 0) {
      return [];
    }

    const result = await this.answerRepository.find({
      where: {
        user: {
          id: context.userId,
        },
        answer_id: In(ids),
      },
      relations: ['user', 'question'],
    });

    return result.map((entity) => entity.toAnswer());
  }

  async findOne(context: RequestContext, id: string): Promise<Answer | null> {
    const result = await this.answerRepository.findOne({
      where: {
        user: {
          id: context.userId,
        },
        answer_id: id,
      },
      relations: ['user', 'question'],
    });

    return result?.toAnswer() ?? null;
  }

  async findByQuestionId(context: RequestContext, questionId: string): Promise<Answer | null> {
    const result = await this.answerRepository.findOne({
      where: {
        user: {
          id: context.userId,
        },
        question: {
          question_id: questionId,
        },
      },
      relations: ['user', 'question'],
    });

    return result?.toAnswer() ?? null;
  }

  async update(context: RequestContext, id: string, data: UpdateAnswerDto): Promise<boolean> {
    const result = await this.answerRepository.update(
      {
        answer_id: id,
        user: {
          id: context.userId,
        },
      },
      data,
    );

    if (result.affected === 0) {
      throw new NotFoundException();
    }

    return true;
  }
}
