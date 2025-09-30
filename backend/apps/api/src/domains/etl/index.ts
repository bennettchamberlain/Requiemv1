import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ConnectionsModule } from '@ci/domains/connections';
import { EventsModule } from '@ci/domains/events';

import { GoogleController } from './controllers/google_controller';
import { ApiLogEntity } from './entities/ApiLogEntity';
import { ApiLogService } from './services/ApiLogService';
import { CalendarEventPromotionService } from './services/CalendarEventPromotionService';

@Module({
  imports: [TypeOrmModule.forFeature([ApiLogEntity]), ConnectionsModule, EventsModule],
  providers: [ApiLogService, CalendarEventPromotionService],
  controllers: [GoogleController],
  exports: [ApiLogService, CalendarEventPromotionService],
})
export class EtlModule {}

// Entities
export { ApiLogEntity };

// Services
export { ApiLogService, CalendarEventPromotionService };

// Controllers
export { GoogleController };

// Types
export type { ApiLog } from './types';
