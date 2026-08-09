/**
 * @module AuditModule
 *
 * The READ side of `ci.graph_deltas`: history of what changed in the knowledge
 * graph, served to the API and to the summary app.
 *
 * The write side is not here, and deliberately so. It used to be —
 * `DeltaEntitySubscriber`, a TypeORM entity subscriber on NodeEntity and
 * RelationshipEntity — and it never recorded a single delta: subscribers fire
 * only for writes made through the ORM's entity manager, while `GraphIngestService`
 * writes with `.createQueryBuilder().insert()` in bulk, which does not emit
 * subscriber events. Measured on a live appliance: 170 entities, 0 deltas, and a
 * Python consumer (`insight_aggregator.py`) reporting a perfectly quiet graph.
 *
 * Deltas are now written by statement-level triggers on `ci.entities` and
 * `ci.relationships` — see
 * `db/postgres/migrations/20260809182943_graph_delta_triggers.sql` and
 * `__tests__/graphDeltaTrigger.spec.ts`. A trigger cannot be bypassed by any
 * write path, which is exactly the property the subscriber lacked.
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { GraphModule } from '@ci/domains/graph';

import { AuditController } from './controllers/AuditController';
import { DeltaEntity } from './entities/DeltaEntity';
import { DeltaService } from './services/DeltaService';

@Module({
  imports: [
    TypeOrmModule.forFeature([DeltaEntity]),
    GraphModule, // For NodeService, injected by AuditController
  ],
  controllers: [AuditController],
  providers: [DeltaService],
  exports: [DeltaService],
})
export class AuditModule {}

export { DeltaService };
export { DeltaEntity };
export type { Delta, NodeType, ChangeType, ChangedField } from './entities/DeltaEntity';
export type { CreateDeltaDto, FindDeltasOptions, UpdateDeltasSummaryDto } from './types';
