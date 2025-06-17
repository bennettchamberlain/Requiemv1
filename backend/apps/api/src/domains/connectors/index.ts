import { Module } from '@nestjs/common';

import { EventsModule } from '@ci/domains/events';

import { ConnectorsController } from './controllers/ConnectorsController';
import { ConnectorsService } from './services/ConnectorsService';

@Module({
  imports: [EventsModule],
  providers: [ConnectorsService],
  controllers: [ConnectorsController],
  exports: [],
})
export class ConnectorsModule {}

// Entities
export {};

// Services
export {};

// Types
export type {} from './types';
