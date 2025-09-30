import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ConnectionsModule } from '@ci/domains/connections';
import { EventsModule } from '@ci/domains/events';
import { MemoryModule } from '@ci/domains/memory';
import { PersonEntity, ContactEntity } from '@ci/domains/memory';

import { GoogleController } from './controllers/google_controller';
import { ApiLogEntity } from './entities/ApiLogEntity';
import { ApiLogService } from './services/ApiLogService';
import { CalendarEventPromotionService } from './services/CalendarEventPromotionService';
import { GmailPromotionService } from './services/GmailPromotionService';
import { PeoplePromotionService } from './services/PeoplePromotionService';

@Module({
  imports: [
    TypeOrmModule.forFeature([ApiLogEntity, PersonEntity, ContactEntity]),
    ConnectionsModule,
    EventsModule,
    MemoryModule,
  ],
  providers: [ApiLogService, CalendarEventPromotionService, GmailPromotionService, PeoplePromotionService],
  controllers: [GoogleController],
  exports: [ApiLogService, CalendarEventPromotionService, GmailPromotionService, PeoplePromotionService],
})
export class EtlModule {}

// Entities
export { ApiLogEntity };

// Services
export { ApiLogService, CalendarEventPromotionService, GmailPromotionService, PeoplePromotionService };

// Controllers
export { GoogleController };

// Types
export type { ApiLog } from './types';
