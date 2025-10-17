/**
 * This module is responsible for "promoting" raw data synced from external sources
 * into the application's structured knowledge graph (managed by the `MemoryModule`).
 * It acts as a transformation layer, taking data from ETL processes and converting it
 * into meaningful, interconnected entities like people, events, and content within
 * the user's memory.
 *
 * ### Key Components:
 * - **`PromoteService`**: A central service that orchestrates the overall promotion process.
 * - **Specialized Promotion Services**: A suite of services, such as `GmailPromotionService`
 *   and `ContactsPromotionService`, each tailored to handle the transformation logic for a
 *   specific type of data from a specific provider (e.g., Google).
 * - **`PromoteController`**: Exposes API endpoints to trigger and manage data promotion tasks.
 *
 * ### Module Integration:
 * - **`EtlModule`**: Consumes the output of ETL sync jobs as the source for promotion.
 * - **`MemoryModule`**: The destination for the transformed data, where it is stored as
 *   nodes and relationships in the knowledge graph.
 * - **`EventsModule`**: Listens for events (e.g., `sync.connection.success`) to trigger
 *   promotion tasks asynchronously.
 * - **`ConnectionsModule` & `UserModule`**: To access connection details and associate
 *   promoted data with the correct user.
 *
 * @module PromoteModule
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ConnectionsModule, ConnectionEntity } from '@ci/domains/connections';
import { EtlModule, ApiLogEntity } from '@ci/domains/etl';
import { EventsModule } from '@ci/domains/events';
import { FilesModule } from '@ci/domains/files';
import { GraphModule, GraphNodeEntity, RelationshipEntity } from '@ci/domains/graph';
import { MemoryModule } from '@ci/domains/memory';
import { UserModule, UserEntity } from '@ci/domains/user';

import { PromoteController as MicrosoftPromoteController } from './controllers/microsoft/PromoteController';
import { PromoteController } from './controllers/PromoteController';
import { GoogleCalendarEventPromotionService } from './services/google/CalendarPromotionService';
import { ContactsPromotionService } from './services/google/ContactsPromotionService';
import { DrivePromotionService } from './services/google/DrivePromotionService';
import { GmailPromotionService } from './services/google/GmailPromotionService';
import { YouTubePromotionService } from './services/google/YouTubePromotionService';
import { OutlookMailPromotionService } from './services/microsoft/OutlookMailPromotionService';
import { PersonPromotionService } from './services/PersonPromotionService';
import { PromoteService } from './services/PromoteService';

/**
 * @internal
 */
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
    FilesModule,
    EtlModule,
    EventsModule,
    MemoryModule,
    GraphModule,
    UserModule,
  ],
  providers: [
    PromoteService,
    GmailPromotionService,
    GoogleCalendarEventPromotionService,
    YouTubePromotionService,
    DrivePromotionService,
    ContactsPromotionService,
    PersonPromotionService,
    OutlookMailPromotionService,
  ],
  controllers: [PromoteController, MicrosoftPromoteController],
  exports: [
    PromoteService,
    GmailPromotionService,
    GoogleCalendarEventPromotionService,
    YouTubePromotionService,
    DrivePromotionService,
    ContactsPromotionService,
    PersonPromotionService,
  ],
})
export class PromoteModule {}
