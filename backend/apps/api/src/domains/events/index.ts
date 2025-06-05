import { Module } from '@nestjs/common';

import { EventService, Queue } from './services/EventService';

@Module({
  imports: [],
  providers: [EventService],
  controllers: [],
  exports: [EventService],
})
export class EventsModule {}

// Entities
export {};

// Services
export { EventService };

// Types
export type {} from './types';
export { Events, type EventPayloads } from './event-registry';
export { Queue };

// Misc
export { OnEvent } from './decorators/on-event';
