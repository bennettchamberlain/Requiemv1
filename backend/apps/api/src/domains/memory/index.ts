import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UserModule } from '@ci/domains/user';

import { ContentController } from './controllers/ContentController';
import { EventController } from './controllers/EventController';
import { GraphController } from './controllers/GraphController';
import { MemoryController } from './controllers/MemoryController';
import { CommunicationEntity } from './entities/CommunicationEntity';
import { ContactEntity } from './entities/ContactEntity';
import { ContentEntity } from './entities/ContentEntity';
import { EventEntity } from './entities/EventEntity';
import { GraphNodeEntity } from './entities/GraphNodeEntity';
import { LocationEntity } from './entities/LocationEntity';
import { PersonEntity } from './entities/PersonEntity';
import { PlaceEntity } from './entities/PlaceEntity';
import { RelationshipEntity } from './entities/RelationshipEntity';
import { ThingEntity } from './entities/ThingEntity';
import { CommunicationService } from './services/CommunicationService';
import { ContentService } from './services/ContentService';
import { EventService } from './services/EventService';
import { GraphUtilityService } from './services/GraphUtilityService';
import { MemoryService } from './services/MemoryService';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CommunicationEntity,
      ContactEntity,
      ContentEntity,
      EventEntity,
      LocationEntity,
      PersonEntity,
      PlaceEntity,
      ThingEntity,
      GraphNodeEntity,
      RelationshipEntity,
    ]),
    UserModule,
  ],
  providers: [MemoryService, ContentService, EventService, CommunicationService, GraphUtilityService],
  controllers: [MemoryController, ContentController, EventController, GraphController],
  exports: [MemoryService, ContentService, EventService, CommunicationService, GraphUtilityService],
})
export class MemoryModule {}

export {
  CommunicationEntity,
  ContactEntity,
  ContentEntity,
  EventEntity,
  LocationEntity,
  PersonEntity,
  PlaceEntity,
  ThingEntity,
  GraphNodeEntity,
  RelationshipEntity,
};

// Services
export { MemoryService, ContentService, EventService, CommunicationService, GraphUtilityService };

// Types
export type {
  CreateEventDto,
  CreateContentDto,
  Memory,
  MemoryLocation,
  MemoryResponse,
  MemorySearchParams,
} from './types';
