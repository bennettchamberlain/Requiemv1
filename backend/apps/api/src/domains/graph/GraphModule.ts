import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { EventsModule } from '@ci/domains/events';
import { UserModule } from '@ci/domains/user';

import { FactEntity } from './entities/FactEntity';
import { GraphNodeEntity } from './entities/GraphNodeEntity';
import { RelationshipEntity } from './entities/RelationshipEntity';
import { GraphEventListener } from './listeners/GraphEventListener';
import { GraphQueryService } from './services/GraphQueryService';
import { GraphUtilityService } from './services/GraphUtilityService';
import { UserContextService } from './services/UserContextService';

@Module({
  imports: [
    TypeOrmModule.forFeature([GraphNodeEntity, RelationshipEntity, FactEntity]),
    EventsModule,
    UserModule,
  ],
  providers: [GraphUtilityService, GraphQueryService, UserContextService, GraphEventListener],
  exports: [GraphQueryService, UserContextService, GraphUtilityService],
})
export class GraphModule {}
