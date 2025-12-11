import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { type UserServiceContext } from '@ci/common/types';

import { type Vector, VectorEntity } from '../entities/VectorEntity';
import { CreateVectorDto } from '../types';

@Injectable()
export class VectorService {
  constructor(
    @InjectRepository(VectorEntity)
    private readonly vectorRepo: Repository<VectorEntity>,
  ) {}

  async upsert(context: UserServiceContext, data: CreateVectorDto): Promise<Vector | null> {
    const rawSearchText = data.searchableText.join(' ');

    return this.vectorRepo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(VectorEntity);

      const existing = await repo.findOne({
        where: {
          entityType: data.entityType,
          entityId: data.entityId,
          userId: context.userId,
        },
      });

      if (existing == null) {
        const id = uuidv7();

        await repo
          .createQueryBuilder()
          .insert()
          .into(VectorEntity)
          .values({
            id: id,
            entityType: data.entityType,
            entityId: data.entityId,
            vector: () => `to_tsvector('english', :searchText)`,
            userId: context.userId,
          })
          .setParameter('searchText', rawSearchText)
          .returning('*')
          .execute();

        const entity = await repo.findOne({
          where: {
            id,
          },
        });

        return entity ? VectorEntity.toEgressType(entity) : null;
      }

      await repo
        .createQueryBuilder()
        .update(VectorEntity)
        .set({
          vector: () => `to_tsvector('english', :searchText)`,
        })
        .where('id = :id', {
          id: existing.id,
        })
        .setParameter('searchText', rawSearchText)
        .returning('*')
        .execute();

      const entity = await repo.findOne({
        where: {
          id: existing.id,
        },
      });

      return entity ? VectorEntity.toEgressType(entity) : null;
    });
  }
}
