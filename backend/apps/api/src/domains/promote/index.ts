import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ConnectionsModule, ConnectionEntity } from '@ci/domains/connections';
import { EtlModule, ApiLogEntity } from '@ci/domains/etl';
import { MemoryModule, PersonEntity, ContactEntity } from '@ci/domains/memory';

import { PromoteController } from './controllers/PromoteController';
import { GoogleCalendarEventPromotionService } from './services/CalendarPromotionService';
import { GmailPromotionService } from './services/GmailPromotionService';
import { PeoplePromotionService } from './services/PeoplePromotionService';
import { PromoteService } from './services/PromoteService';

@Module({
  imports: [
    TypeOrmModule.forFeature([ApiLogEntity, ConnectionEntity, PersonEntity, ContactEntity]),
    ConnectionsModule,
    EtlModule,
    MemoryModule,
  ],
  providers: [
    PromoteService,
    GmailPromotionService,
    GoogleCalendarEventPromotionService,
    PeoplePromotionService,
  ],
  controllers: [PromoteController],
  exports: [
    PromoteService,
    GmailPromotionService,
    GoogleCalendarEventPromotionService,
    PeoplePromotionService,
  ],
})
export class PromoteModule {}
