import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ProviderEntity, type Provider } from '../entities/ProviderEntity';

@Injectable()
export class ProviderService {
  constructor(
    @InjectRepository(ProviderEntity)
    private readonly providerRepository: Repository<ProviderEntity>,
  ) {}

  async findAll(): Promise<Provider[]> {
    const entities = await this.providerRepository.find();

    return entities.map((entity) => ProviderEntity.toEgressType(entity));
  }

  async findOne(id: string): Promise<Provider | null> {
    const entity = await this.providerRepository.findOne({
      where: {
        id,
      },
    });

    return entity ? ProviderEntity.toEgressType(entity) : null;
  }
}
