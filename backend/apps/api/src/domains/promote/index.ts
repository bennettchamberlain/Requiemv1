import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ConnectionsModule, ConnectionEntity } from '@ci/domains/connections';
import { EtlModule, ApiLogEntity } from '@ci/domains/etl';
import { EventsModule } from '@ci/domains/events';
import { MemoryModule, GraphNodeEntity, RelationshipEntity } from '@ci/domains/memory';
import { UserModule, UserEntity } from '@ci/domains/user';

import { PromoteController } from './controllers/PromoteController';
import { GoogleCalendarEventPromotionService } from './services/CalendarPromotionService';
import { ContactsPromotionService } from './services/ContactsPromotionService';
import { DrivePromotionService } from './services/DrivePromotionService';
import { GmailPromotionService } from './services/GmailPromotionService';
import { PeoplePromotionService } from './services/PeoplePromotionService';
import { PromoteService } from './services/PromoteService';
import { YouTubePromotionService } from './services/YouTubePromotionService';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ApiLogEntity,
      ConnectionEntity,
      GraphNodeEntity,
      RelationshipEntity,
      UserEntity,
    ]),
    ConnectionsModule,
    EtlModule,
    EventsModule,
    MemoryModule,
    UserModule,
  ],
  providers: [
    PromoteService,
    GmailPromotionService,
    GoogleCalendarEventPromotionService,
    YouTubePromotionService,
    DrivePromotionService,
    ContactsPromotionService,
    PeoplePromotionService,
  ],
  controllers: [PromoteController],
  exports: [
    PromoteService,
    GmailPromotionService,
    GoogleCalendarEventPromotionService,
    YouTubePromotionService,
    DrivePromotionService,
    ContactsPromotionService,
    PeoplePromotionService,
  ],
})
export class PromoteModule {}
