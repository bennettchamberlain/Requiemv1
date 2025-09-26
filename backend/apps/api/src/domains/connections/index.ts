import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { EventsModule } from '@ci/domains/events';

import { ClientFactory } from './clients';
import { ConnectionsController } from './controllers/ConnectionsController';
import { ProvidersController } from './controllers/ProvidersController';
import { ConnectionEntity } from './entities/ConnectionEntity';
import { ProviderEntity } from './entities/ProviderEntity';
import { ConnectionService } from './services/ConnectionService';
import { ProviderService } from './services/ProviderService';

@Module({
  imports: [TypeOrmModule.forFeature([ConnectionEntity, ProviderEntity]), EventsModule],
  providers: [ClientFactory, ConnectionService, ProviderService],
  controllers: [ConnectionsController, ProvidersController],
  exports: [ConnectionService, ProviderService],
})
export class ConnectionsModule {}

// Entities
export { ConnectionEntity, ProviderEntity };

// Services
export { ConnectionService, ProviderService };

// Types
export type {} from './types';
