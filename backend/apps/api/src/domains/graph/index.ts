/**
 * @module GraphModule
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { EventsModule } from '@ci/domains/events';
import { MemoryModule } from '@ci/domains/memory';
import { UserModule } from '@ci/domains/user';

import { GraphDeltaEntity } from './entities/GraphDeltaEntity';
import { type Node, NodeEntity } from './entities/NodeEntity';
import { RelationshipEntity } from './entities/RelationshipEntity';
import { GraphDeltaService } from './services/GraphDeltaService';
import { GraphService } from './services/GraphService';
import { NodeService } from './services/NodeService';
import { RelationshipService } from './services/RelationshipService';
import { GraphDeltaEntitySubscriber } from './subscribers/GraphDeltaEntitySubscriber';

/**
 * @internal
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([NodeEntity, RelationshipEntity, GraphDeltaEntity]),
    EventsModule,
    MemoryModule,
    UserModule,
  ],
  providers: [GraphService, NodeService, RelationshipService, GraphDeltaService, GraphDeltaEntitySubscriber],
  exports: [GraphService, NodeService, RelationshipService, GraphDeltaService],
})
export class GraphModule {}

export { GraphService, NodeService, RelationshipService, GraphDeltaService };
export type { Node };
export type { GraphDelta, NodeType, ChangeType, ChangedField } from './entities/GraphDeltaEntity';
export type { CreateGraphDeltaDto, FindDeltasOptions, UpdateDeltasSummaryDto } from './types';
export { RelationshipType } from './types';
