import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { SYSTEM_USER, type ServiceContext, type UserServiceContext } from '@ci/common/types';

import { type Action, ActionEntity } from '../entities/ActionEntity';
import type { CreateActionDto } from '../types';

@Injectable()
export class ActionService {
  constructor(
    @InjectRepository(ActionEntity)
    private readonly actionRepository: Repository<ActionEntity>,
  ) {}

  async create(context: UserServiceContext, data: CreateActionDto): Promise<Action> {
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

    return ActionEntity.toEgressType(entity);
  }

  async findAll(context: ServiceContext): Promise<Action[]> {
    const entities = await this.actionRepository.find({
      where: {
        ...(context.userId !== SYSTEM_USER && {
          user: {
            id: context.userId,
          },
        }),
      },
      order: {
        priority: 'asc',
      },
      relations: ['tags'],
    });

    return entities.map((entity) => ActionEntity.toEgressType(entity));
  }

  async findByIds(context: ServiceContext, ids: string[]): Promise<Action[]> {
    const entities = await this.actionRepository.find({
      where: {
        ...(context.userId !== SYSTEM_USER && {
          user: {
            id: context.userId,
          },
        }),
        id: In(ids),
      },
      relations: ['tags'],
    });

    return entities.map((entity) => ActionEntity.toEgressType(entity));
  }

  async findById(context: ServiceContext, id: string): Promise<Action | null> {
    const entity = await this.actionRepository.findOne({
      where: {
        ...(context.userId !== SYSTEM_USER && {
          user: {
            id: context.userId,
          },
        }),
        id,
      },
      relations: ['tags'],
    });

    if (entity == null) {
      return null;
    }

    return ActionEntity.toEgressType(entity);
  }

  async findByThreadId(context: ServiceContext, threadId: string): Promise<Action | null> {
    const entity = await this.actionRepository.findOne({
      where: {
        ...(context.userId !== SYSTEM_USER && {
          user: {
            id: context.userId,
          },
        }),
        threadId,
      },
      relations: ['tags'],
    });

    if (entity == null) {
      return null;
    }

    return ActionEntity.toEgressType(entity);
  }
}
