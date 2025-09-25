import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ApiLogEntity } from './entities/ApiLogEntity';
import { ApiLogService } from './services/ApiLogService';

@Module({
  imports: [TypeOrmModule.forFeature([ApiLogEntity])],
  providers: [ApiLogService],
  controllers: [],
  exports: [ApiLogService],
})
export class EtlModule {}

// Entities
export { ApiLogEntity };

// Services
export { ApiLogService };

// Types
export type { ApiLog } from './types';
