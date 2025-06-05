import { Module } from '@nestjs/common';

import { JobsController } from './controllers/JobsController';
import { DelegationService, Queue } from './services/DelegationService';

@Module({
  imports: [],
  providers: [DelegationService],
  controllers: [JobsController],
  exports: [DelegationService],
})
export class JobsModule {}

// Entities
export {};

// Services
export { DelegationService };

// Types
export type {} from './types';
export { Queue };
