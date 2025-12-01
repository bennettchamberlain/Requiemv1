import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import type { RequestContext } from '@ci/common/types';

import { AnswerEntity } from '../entities/AnswerEntity';
import type { Answer, CreateAnswerDto, UpdateAnswerDto } from '../types';

@Injectable()
export class AnswerService {
  constructor(
    @InjectRepository(AnswerEntity)
    private readonly answerRepository: Repository<AnswerEntity>,
  ) {}

  async create(context: RequestContext, data: CreateAnswerDto): Promise<Answer> {
    const instance = this.answerRepository.create({
      answer_id: data.id ?? uuidv7(),
      answer_text: data.text,
      question: {
        question_id: data.question.id,
      },
      user: {
        id: context.userId,
      },
    });

    const entity = await this.answerRepository.save(instance);

    return entity.toAnswer();
  }

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

  async update(context: RequestContext, id: string, data: UpdateAnswerDto): Promise<Answer | null> {
    const updateResult = await this.answerRepository.update(
      {
        answer_id: id,
        user: {
          id: context.userId,
        },
      },
      data,
    );

    if (updateResult.affected === 0) {
      throw new NotFoundException();
    }

    // Fetch and return the updated answer using the existing findOne method
    return this.findOne(context, id);
  }
}
