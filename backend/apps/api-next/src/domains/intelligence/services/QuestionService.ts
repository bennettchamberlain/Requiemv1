import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type { RequestContext } from '@ci/common/types';

import { QuestionEntity } from '../entities/QuestionEntity';
import type { Question } from '../types';

@Injectable()
export class QuestionService {
  constructor(
    @InjectRepository(QuestionEntity)
    private readonly userRepository: Repository<QuestionEntity>,
  ) {}

  async findAll(context: RequestContext): Promise<Question[]> {
    const result = await this.userRepository.find({
      where: {
        user: {
          id: context.userId,
        },
      },
      relations: ['user'],
    });

    return result.map((entity) => entity.toQuestion());
  }

  async findOne(context: RequestContext, id: string): Promise<Question | null> {
    const result = await this.userRepository.findOne({
      where: {
        user: {
          id: context.userId,
        },
        id,
      },
      relations: ['user'],
    });

    return result?.toQuestion() ?? null;
  }
}
