import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ConnectionsModule } from '@ci/domains/connections';
import { EventsModule } from '@ci/domains/events';

import { GoogleController } from './controllers/google_controller';
import { ApiLogEntity } from './entities/ApiLogEntity';
import { ApiLogService } from './services/ApiLogService';

@Module({
  imports: [TypeOrmModule.forFeature([ApiLogEntity]), ConnectionsModule, EventsModule],
  providers: [ApiLogService],
  controllers: [GoogleController],
  exports: [ApiLogService],
})
export class EtlModule {}

// Entities
export { ApiLogEntity };

// Services
export { ApiLogService };

// Controllers
export { GoogleController };

// Types
export type { ApiLog } from './types';
