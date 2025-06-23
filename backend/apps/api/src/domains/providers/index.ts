import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ProvidersController } from './controllers/ProvidersController';
import { ProviderEntity } from './entities/ProviderEntity';
import { ProviderService } from './services/ProviderService';

@Module({
  imports: [TypeOrmModule.forFeature([ProviderEntity])],
  providers: [ProviderService],
  controllers: [ProvidersController],
  exports: [ProviderService],
})
export class ProvidersModule {}

// Entities
export { ProviderEntity };

// Services
export { ProviderService };

// Types
export type { CreateProviderDto, Provider, UpdateProviderDto } from './types';
