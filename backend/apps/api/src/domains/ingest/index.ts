/**
 * REST bulk-ingest plane (`/v1/*`). Hosts the batch ingest endpoints for every
 * bulk kind — communications, contents, inventory, browser-activity, positions
 * (events stay on the memory domain's EventsIngestController) — plus the bulk
 * lifecycle pair POST /v1/ingest/finish + GET /v1/ingest/status, so a machine
 * client can run a complete load → enrich → drain cycle over plain REST.
 *
 * The controllers own no persistence: each route delegates to the existing
 * chunk-safe, provenance-deduped bulk service exported by its home domain, and
 * the lifecycle endpoints delegate to the maintenance domain's orchestrator /
 * search-index backfill. See BulkIngestController and
 * IngestLifecycleController for the contract.
 *
 * @module IngestModule
 */

import { Module } from '@nestjs/common';

import { BrowserActivityModule } from '@ci/domains/browser-activity';
import { MaintenanceModule } from '@ci/domains/maintenance';
import { MemoryModule } from '@ci/domains/memory';
import { PositionModule } from '@ci/domains/position';

import { BulkIngestController } from './controllers/BulkIngestController';
import { IngestLifecycleController } from './controllers/IngestLifecycleController';
import { IngestStatusService } from './services/IngestStatusService';

/**
 * @internal
 */
@Module({
  imports: [MemoryModule, BrowserActivityModule, PositionModule, MaintenanceModule],
  controllers: [BulkIngestController, IngestLifecycleController],
  providers: [IngestStatusService],
})
export class IngestModule {}

export { BulkIngestController } from './controllers/BulkIngestController';
export { IngestLifecycleController } from './controllers/IngestLifecycleController';
export { IngestStatusService, type IngestStatusSnapshot } from './services/IngestStatusService';
export type { BulkIngestResponse, IngestFinishRequest } from './types';
