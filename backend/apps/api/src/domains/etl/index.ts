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

import { EtlController } from './controllers/EtlController';
import { ApiLogEntity } from './entities/ApiLogEntity';
import { ConnectionSyncJobEntity } from './entities/ConnectionSyncJobEntity';
import { EtlService } from './services/EtlService';
import { ConnectionSyncJobService } from './services/ConnectionSyncJobService';

/**
 * @internal
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([ApiLogEntity, ConnectionSyncJobEntity, ConnectionEntity]),
    ConnectionsModule,
    EventsModule,
  ],
  providers: [EtlService, ConnectionSyncJobService],
  controllers: [EtlController],
  exports: [EtlService, ConnectionSyncJobService],
})
export class EtlModule {}

// Entities
export { ApiLogEntity };
export { ConnectionSyncJobEntity };

// Services
export { EtlService };
export { ConnectionSyncJobService };

// Controllers
export { EtlController };

// Types
export type { ApiLog, ConnectionSyncJob, JobStatus } from './types';
export type { CreateConnectionSyncJobDto, UpdateConnectionSyncJobDto } from './types';
export type {
  CalendarSyncState,
  GmailSyncState,
  DriveSyncState,
  ContactsSyncState,
  YouTubeSyncState,
  GoogleSyncState,
  OutlookMailSyncState,
  OutlookCalendarsSyncState,
  OutlookCalendarSyncState,
  OneDriveSyncState,
  FacebookSyncState,
  SyncResult,
  CalendarSyncResult,
  GmailSyncResult,
} from './types/syncTypes';
