import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { SYSTEM_USER, type ServiceContext } from '@ci/common/types';

import { type Fact, FactEntity } from '../entities/FactEntity';

@Injectable()
export class FactService {
  constructor(
    @InjectRepository(FactEntity)
    private readonly factRepository: Repository<FactEntity>,
  ) {}

  async findAll(context: ServiceContext): Promise<Fact[]> {
    const entities = await this.factRepository.find({
      where: {
        ...(context.userId !== SYSTEM_USER && {
          fact_owner_id: context.userId,
        }),
      },
    });

    return entities.map((entity) => FactEntity.toEgressType(entity));
  }

  async findByIds(context: ServiceContext, ids: string[]): Promise<Fact[]> {
    const entities = await this.factRepository.find({
      where: {
        id: In(ids),
        ...(context.userId !== SYSTEM_USER && {
          fact_owner_id: context.userId,
        }),
      },
    });

    return entities.map((entity) => FactEntity.toEgressType(entity));
  }

  async findById(context: ServiceContext, id: string): Promise<Fact | null> {
    const entity = await this.factRepository.findOne({
      where: {
        id,
        ...(context.userId !== SYSTEM_USER && {
          fact_owner_id: context.userId,
        }),
      },
    });

    if (entity == null) {
      return null;
    }

    return FactEntity.toEgressType(entity);
  }
}
