/**
 * This module handles the Extract, Transform, and Load (ETL) processes for syncing
 * data from third-party services. It orchestrates fetching data from external APIs,
 * transforming it into a standardized format, and storing it within the application.
 *
 * ### Key Components:
 * - **ETL Service (`EtlService`)**: Contains the core logic for running synchronization
 *   jobs for various providers (e.g., Google).
 * - **ETL Controller (`EtlController`)**: Exposes API endpoints to trigger and manage
 *   the ETL sync processes.
 * - **API Logging (`ApiLogEntity`)**: Records logs of API calls made to external
 *   services during the ETL process for auditing and debugging.
 * - **Module Integration**: Works closely with the `ConnectionsModule` to manage API
 *   credentials and the `EventsModule` to store synchronized data.
 *
 * @module ETLModule
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ConnectionsModule, ConnectionEntity } from '@ci/domains/connections';
import { EventsModule } from '@ci/domains/events';
import { FilesModule } from '@ci/domains/files';
import { GraphModule } from '@ci/domains/graph';
import { MemoryModule } from '@ci/domains/memory';
import { PromoteModule } from '@ci/domains/promote';
import { SearchNextModule } from '@ci/domains/search-next';

import { ConnectionSyncJobEntity } from './entities/ConnectionSyncJobEntity';
import { SyncOrchestrator } from './listeners/SyncOrchestrator';
import { ConnectionSyncJobService } from './services/ConnectionSyncJobService';
import { EndpointServiceMap } from './services/EndpointServiceMap';
import { GmailTransformService } from './services/Google/transform/TransformGmail';
import { GoogleCalendarTransformService } from './services/Google/transform/TransformGoogleCalendar';
import { GoogleContactsTransformService } from './services/Google/transform/TransformGoogleContacts';
import { GoogleDriveTransformService } from './services/Google/transform/TransformGoogleDrive';
import { YouTubeActivitiesTransformService } from './services/Google/transform/TransformYouTubeActivities';
import { YouTubeLikesTransformService } from './services/Google/transform/TransformYouTubeLikes';
import { YouTubePlaylistsTransformService } from './services/Google/transform/TransformYouTubePlaylists';
import { YouTubeSubscriptionsTransformService } from './services/Google/transform/TransformYouTubeSubscriptions';

/**
 * @internal
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([ConnectionEntity, ConnectionSyncJobEntity]),
    ConnectionsModule,
    EventsModule,
    FilesModule,
    GraphModule,
    MemoryModule,
    PromoteModule,
    SearchNextModule,
  ],
  providers: [
    ConnectionSyncJobService,
    EndpointServiceMap,
    SyncOrchestrator,
    GmailTransformService,
    GoogleCalendarTransformService,
    GoogleContactsTransformService,
    GoogleDriveTransformService,
    YouTubeActivitiesTransformService,
    YouTubeLikesTransformService,
    YouTubePlaylistsTransformService,
    YouTubeSubscriptionsTransformService,
  ],
  exports: [ConnectionSyncJobService],
})
export class EtlNewModule {}

// Entities
export { ConnectionSyncJobEntity };

// Services
export { ConnectionSyncJobService };

// Types
export type { ConnectionSyncJob, JobStatus } from './types';
export type { CreateConnectionSyncJobDto, UpdateConnectionSyncJobDto } from './types';
