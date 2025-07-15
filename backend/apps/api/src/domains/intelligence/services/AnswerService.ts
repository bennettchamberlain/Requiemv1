import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type { RequestContext } from '@ci/common/types';

import { AnswerEntity } from '../entities/AnswerEntity';
import type { Answer, Question } from '../types';

@Injectable()
export class AnswerService {
  constructor(
    @InjectRepository(AnswerEntity)
    private readonly userRepository: Repository<AnswerEntity>,
  ) {}

  async findAll(context: RequestContext): Promise<Answer[]> {
    const result = await this.userRepository.find({
      where: {
        user: {
          id: context.userId,
        },
      },
      relations: ['user', 'question'],
    });

    return result.map((entity) => entity.toAnswer());
  }

  async findOne(context: RequestContext, id: string): Promise<Answer | null> {
    const result = await this.userRepository.findOne({
      where: {
        user: {
          id: context.userId,
        },
        id,
      },
      relations: ['user', 'question'],
    });

    return result?.toAnswer() ?? null;
  }

  async findAssociatedAnswers(context: RequestContext, question: Question): Promise<Answer[]> {
    // TODO: Hit the vector database using the provided answer.
    // Return a list of answers hydrated with their related questions to generate RAG context.
    return [];
  }
}
