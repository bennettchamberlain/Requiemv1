import { Module } from '@nestjs/common';

import { EventsModule } from '@ci/domains/events';

import { ServiceProvidersController } from './controllers/ServiceProvidersController';
import { ServiceProvidersService } from './services/ServiceProvidersService';

@Module({
  imports: [EventsModule],
  providers: [ServiceProvidersService],
  controllers: [ServiceProvidersController],
  exports: [],
})
export class ServiceProvidersModule {}

// Entities
export {};

// Services
export {};

// Types
export type {} from './types';
