import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { SYSTEM_USER, type ServiceContext } from '@ci/common/types';

import { type Item, ItemEntity } from '../entities/ItemEntity';

@Injectable()
export class ItemService {
  constructor(
    @InjectRepository(ItemEntity)
    private readonly itemRepository: Repository<ItemEntity>,
  ) {}

  async findAll(context: ServiceContext): Promise<Item[]> {
    const entities = await this.itemRepository.find({
      where: {
        ...(context.userId !== SYSTEM_USER && {
          userId: context.userId,
        }),
      },
    });

    return entities.map((entity) => ItemEntity.toEgressType(entity));
  }

  async findByIds(context: ServiceContext, ids: string[]): Promise<Item[]> {
    const entities = await this.itemRepository.find({
      where: {
        id: In(ids),
        ...(context.userId !== SYSTEM_USER && {
          userId: context.userId,
        }),
      },
    });

    return entities.map((entity) => ItemEntity.toEgressType(entity));
  }

  async findById(context: ServiceContext, id: string): Promise<Item | null> {
    const entity = await this.itemRepository.findOne({
      where: {
        id,
        ...(context.userId !== SYSTEM_USER && {
          userId: context.userId,
        }),
      },
    });

    if (entity == null) {
      return null;
    }

    return ItemEntity.toEgressType(entity);
  }
}
