import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { v7 as uuid7 } from 'uuid';

import { SYSTEM_USER, type UserServiceContext, type ServiceContext } from '@ci/common/context';

import { type Item, ItemEntity } from '../entities/ItemEntity';
import type { CreateItemDto } from '../types';

@Injectable()
export class ItemService {
  constructor(
    @InjectRepository(ItemEntity)
    private readonly itemRepository: Repository<ItemEntity>,
  ) {}

  async create(context: UserServiceContext, data: CreateItemDto): Promise<Item> {
    const entity = this.itemRepository.create({
      id: uuid7(),
      userId: context.userId,
      name: data.name,
      description: data.description ?? null,
      category: data.category ?? null,
      subcategory: data.subcategory ?? null,
      brand: data.brand ?? null,
      model: data.model ?? null,
      currentValue: data.currentValue ?? null,
      currency: data.currency ?? 'USD',
      condition: data.condition ?? null,
      metadata: data.metadata ?? {},
    });

    await this.itemRepository.save(entity);

    return ItemEntity.toEgressType(entity);
  }

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

  async findByFileId(context: ServiceContext, fileId: string): Promise<Item[]> {
    const queryBuilder = this.itemRepository.createQueryBuilder('inventory');

    queryBuilder.where("inventory.metadata->>'source_file_id' = :fileId", { fileId });

    if (context.userId !== SYSTEM_USER) {
      queryBuilder.andWhere('inventory.userId = :userId', { userId: context.userId });
    }

    const entities = await queryBuilder.getMany();

    return entities.map((entity) => ItemEntity.toEgressType(entity));
  }

  async findByFileIds(context: ServiceContext, fileIds: string[]): Promise<Map<string, Item[]>> {
    const queryBuilder = this.itemRepository.createQueryBuilder('inventory');

    queryBuilder.where("inventory.metadata->>'source_file_id' IN (:...fileIds)", { fileIds });

    if (context.userId !== SYSTEM_USER) {
      queryBuilder.andWhere('inventory.userId = :userId', { userId: context.userId });
    }

    const entities = await queryBuilder.getMany();

    const itemsMap = new Map<string, Item[]>();

    for (const entity of entities) {
      const item = ItemEntity.toEgressType(entity);
      const fileId = item.sourceFileId;

      if (fileId) {
        if (!itemsMap.has(fileId)) {
          itemsMap.set(fileId, []);
        }

        itemsMap.get(fileId)!.push(item);
      }
    }

    return itemsMap;
  }
}
