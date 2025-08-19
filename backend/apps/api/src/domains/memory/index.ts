import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ContentController } from '@ci/domains/memory/controllers/ContentController';
import { EventController } from '@ci/domains/memory/controllers/EventController';
import { ContentService } from '@ci/domains/memory/services/ContentService';
import { EventService } from '@ci/domains/memory/services/EventService';
import { UserModule } from '@ci/domains/user';

import { MemoryController } from './controllers/MemoryController';
import { ContactEntity } from './entities/ContactEntity';
import { ContentEntity } from './entities/ContentEntity';
import { EventEntity } from './entities/EventEntity';
import { LocationEntity } from './entities/LocationEntity';
import { PersonEntity } from './entities/PersonEntity';
import { PlaceEntity } from './entities/PlaceEntity';
import { ThingEntity } from './entities/ThingEntity';
import { MemoryService } from './services/MemoryService';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ContactEntity,
      ContentEntity,
      EventEntity,
      LocationEntity,
      PersonEntity,
      PlaceEntity,
      ThingEntity,
    ]),
    UserModule,
  ],
  providers: [MemoryService, ContentService, EventService],
  controllers: [MemoryController, ContentController, EventController],
  exports: [MemoryService],
})
export class MemoryModule {}

// Entities
export { ContactEntity, ContentEntity, EventEntity, LocationEntity, PersonEntity, PlaceEntity, ThingEntity };

// Services
export { MemoryService };

// Types
export type { Memory, MemoryLocation, MemoryResponse, MemorySearchParams } from './types';
