import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import type { RequestContext } from '@ci/common/types';

import { ActionEntity } from '../entities/ActionEntity';
import type { CreateActionDto, Action } from '../types';

@Injectable()
export class ActionService {
  constructor(
    @InjectRepository(ActionEntity)
    private readonly actionRepository: Repository<ActionEntity>,
  ) {}

  async create(context: RequestContext, data: CreateActionDto): Promise<Action> {
    const instance = await this.actionRepository.create({
      id: uuidv7(),
      title: data.title,
      text: data.text,
      imageUrl: data.imageUrl,
      priority: data.priority,
      thread: {
        id: data.threadId,
      },
      user: {
        id: context.userId,
      },
    });

    const entity = await this.actionRepository.save(instance);

    return entity.toAction();
  }

  async findAll(context: RequestContext): Promise<Action[]> {
    const result = await this.actionRepository.find({
      where: {
        user: {
          id: context.userId,
        },
      },
      order: {
        priority: 'asc',
      },
      relations: ['tags'],
    });

    return result.map((entity) => entity.toAction());
  }

  async findOne(context: RequestContext, id: string): Promise<Action | null> {
    const result = await this.actionRepository.findOne({
      where: {
        user: {
          id: context.userId,
        },
        id,
      },
      relations: ['tags'],
    });

    return result?.toAction() ?? null;
  }

  async findByThreadId(context: RequestContext, threadId: string): Promise<Action | null> {
    const result = await this.actionRepository.findOne({
      where: {
        user: {
          id: context.userId,
        },
        threadId,
      },
      relations: ['tags'],
    });

    return result?.toAction() ?? null;
  }
}
