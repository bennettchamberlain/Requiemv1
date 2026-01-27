/**
 * @module GraphModule
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { MessageService, MessageEntity, ThreadEntity, ThreadService } from '@ci/domains/conversations';
import { EventsModule } from '@ci/domains/events';
import { FileService } from '@ci/domains/files';
import {
  MemoryModule,
  CommunicationService,
  ContentService,
  EventService,
  ItemService,
  PersonService,
  PlaceService,
  CommunicationEntity,
  ContentEntity,
  EventEntity,
  FileEntity,
  ItemEntity,
  PersonEntity,
  PlaceEntity,
} from '@ci/domains/memory';
import { NoteService, NoteEntity } from '@ci/domains/notes';
import { UserModule } from '@ci/domains/user';

import { type Node, NodeEntity } from './entities/NodeEntity';
import { type Relationship, RelationshipEntity } from './entities/RelationshipEntity';
import { GraphService } from './services/GraphService';
import { NodeService } from './services/NodeService';
import { RelationshipService } from './services/RelationshipService';

/**
 * @internal
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      NodeEntity,
      CommunicationEntity,
      ContentEntity,
      EventEntity,
      FileEntity,
      ItemEntity,
      MessageEntity,
      NoteEntity,
      ThreadEntity,
      RelationshipEntity,
      PersonEntity,
      PlaceEntity,
    ]),
    EventsModule,
    MemoryModule,
    UserModule,
  ],
  providers: [
    CommunicationService,
    ContentService,
    EventService,
    FileService,
    ItemService,
    NoteService,
    ThreadService,
    GraphService,
    NodeService,
    MessageService,
    PersonService,
    PlaceService,
    RelationshipService,
  ],
  exports: [GraphService, NodeService, RelationshipService],
})
export class GraphModule {}

export { GraphService, NodeService, RelationshipService };
export type { Node, Relationship };
export { RelationshipType } from './types';
