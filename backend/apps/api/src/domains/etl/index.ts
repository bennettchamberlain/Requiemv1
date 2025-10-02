import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ConnectionsModule } from '@ci/domains/connections';
import { ConnectionEntity } from '@ci/domains/connections/entities/ConnectionEntity';
import { EventsModule } from '@ci/domains/events';

import { EtlController } from './controllers/EtlController';
import { ApiLogEntity } from './entities/ApiLogEntity';
import { EtlService } from './services/EtlService';
import { GoogleService } from './services/GoogleService';

@Module({
  imports: [TypeOrmModule.forFeature([ApiLogEntity, ConnectionEntity]), ConnectionsModule, EventsModule],
  providers: [EtlService, GoogleService],
  controllers: [EtlController],
  exports: [EtlService, GoogleService],
})
export class EtlModule {}

// Entities
export { ApiLogEntity };

// Services
export { EtlService };

// Controllers
export { EtlController };

// Types
export type { ApiLog } from './types';
