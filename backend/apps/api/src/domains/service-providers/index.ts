import { Module } from '@nestjs/common';

import { EventsModule } from '@ci/domains/events';

import { ServiceProvidersController } from './controllers/service-providers-controller';

@Module({
  imports: [EventsModule],
  providers: [],
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
