import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ServiceContext } from '@ci/common/types';

import { ProviderEntity, type Provider } from '../entities/ProviderEntity';

@Injectable()
export class ProviderService {
  constructor(
    @InjectRepository(ProviderEntity)
    private readonly providerRepository: Repository<ProviderEntity>,
  ) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async findAll(context: ServiceContext): Promise<Provider[]> {
    const entities = await this.providerRepository.find();

    return entities.map((entity) => ProviderEntity.toEgressType(entity));
  }

  async findById(context: ServiceContext, id: string): Promise<Provider | null> {
    const entity = await this.providerRepository.findOne({
      where: {
        id,
      },
    });

    return entity ? ProviderEntity.toEgressType(entity) : null;
  }
}
