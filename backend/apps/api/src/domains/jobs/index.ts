import { Module } from '@nestjs/common';

import { EventsModule } from '@ci/domains/events';

import { JobsController } from './controllers/JobsController';

@Module({
  imports: [EventsModule],
  providers: [],
  controllers: [JobsController],
  exports: [],
})
export class JobsModule {}

// Entities
export {};

// Services
export {};

// Types
export type {} from './types';
