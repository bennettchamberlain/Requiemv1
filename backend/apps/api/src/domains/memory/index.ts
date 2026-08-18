/**
 * This module is responsible for managing the application's long-term, structured memory.
 * It functions as a knowledge graph, storing and organizing information about various
 * entities such as people, places, events, and content. This allows the AI to build a
 * persistent and interconnected understanding of the user's world.
 *
 * ### Key Components:
 * - **Entities**: A rich set of entities (`PersonEntity`, `EventEntity`, `ContentEntity`,
 *   `GraphNodeEntity`, `RelationshipEntity`, etc.) that define the structure of the
 *   knowledge graph.
 * - **Services**:
 *   - `GraphUtilityService`: Offers tools for traversing and manipulating the graph structure.
 * - **Controllers**: Expose REST API endpoints (`ContentController`, etc.)
 *   for creating, retrieving, and managing memory entities.
 * - **User Integration**: Connects with the `UserModule` to ensure all memory entities are
 *   scoped to the correct user.
 *
 * @module MemoryModule
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BrowserActivityModule, BrowserActivityEntity } from '@ci/domains/browser-activity';
import { EventsModule } from '@ci/domains/events';
import { FilesModule } from '@ci/domains/files';
import { SearchNextModule } from '@ci/domains/search-next';
import { UserModule, UserEntity } from '@ci/domains/user';

import { GraphController } from './controllers/GraphController';
import { BaseEntity } from './entities/BaseEntity';
import { CommunicationBaseEntity } from './entities/CommunicationBaseEntity';
import { type Communication, CommunicationEntity } from './entities/CommunicationEntity';
import { type Concept, ConceptEntity } from './entities/ConceptEntity';
import { ContentBaseEntity } from './entities/ContentBaseEntity';
import { ContentEntity } from './entities/ContentEntity';
import { EntityMergeBlockEntity } from './entities/EntityMergeBlockEntity';
import { EventBaseEntity } from './entities/EventBaseEntity';
import { type Event, EventEntity } from './entities/EventEntity';
import { FileEntity } from './entities/FileEntity';
import { GraphNodeEntity } from './entities/GraphNodeEntity';
import { ItemBaseEntity } from './entities/ItemBaseEntity';
import {
  type Item,
  type InventoryCondition,
  type InventoryIdentityMethod,
  type InventoryLifecycleState,
  ItemEntity,
} from './entities/ItemEntity';
import {
  type ObjectObservation,
  ObjectObservationEntity,
  type ObservationResolutionMethod,
  type ObservationSourceKind,
} from './entities/ObjectObservationEntity';
import { type Person, PersonEntity } from './entities/PersonEntity';
import { type Place, PlaceEntity } from './entities/PlaceEntity';
import { type ProductModel, ProductModelEntity } from './entities/ProductModelEntity';
import { type Receipt, ReceiptEntity, type ReceiptExtractionState } from './entities/ReceiptEntity';
import { type ReceiptLineItem, ReceiptLineItemEntity } from './entities/ReceiptLineItemEntity';
import { RelationshipEntity } from './entities/RelationshipEntity';
import { GraphEventListener } from './listeners/GraphEventListener';
import { CommunicationService } from './services/CommunicationService';
import { ConceptService } from './services/ConceptService';
import { ContentService } from './services/ContentService';
import { EntityMergeBlockService } from './services/EntityMergeBlockService';
import { EventService } from './services/EventService';
import { FileService } from './services/FileService';
import { GraphDeltaWriter } from './services/GraphDeltaWriter';
import { GraphEventService } from './services/GraphEventService';
import { GraphQueryService } from './services/GraphQueryService';
import { GraphReadService } from './services/GraphReadService';
import { GraphUtilityService } from './services/GraphUtilityService';
import { ItemService } from './services/ItemService';
import { KnownPlacesService } from './services/KnownPlacesService';
import { LifeStatsService } from './services/LifeStatsService';
import { PersonActivityService } from './services/PersonActivityService';
import { PersonDuplicateService } from './services/PersonDuplicateService';
import { PersonMergeService } from './services/PersonMergeService';
import { PersonService } from './services/PersonService';
import { PlaceService } from './services/PlaceService';
import { UserContextService } from './services/UserContextService';

/**
 * @internal
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      EntityMergeBlockEntity,
      CommunicationEntity,
      CommunicationBaseEntity,
      ContentEntity,
      ContentBaseEntity,
      EventEntity,
      EventBaseEntity,
      PersonEntity,
      ConceptEntity,
      PlaceEntity,
      GraphNodeEntity,
      ItemEntity,
      ItemBaseEntity,
      ProductModelEntity,
      ReceiptEntity,
      ReceiptLineItemEntity,
      ObjectObservationEntity,
      RelationshipEntity,
      FileEntity,
      BrowserActivityEntity,
      UserEntity,
      RelationshipEntity,
    ]),
    UserModule,
    EventsModule,
    FilesModule,
    BrowserActivityModule,
    SearchNextModule,
  ],
  providers: [
    GraphDeltaWriter,
    CommunicationService,
    ContentService,
    EventService,
    GraphEventService,
    GraphUtilityService,
    GraphQueryService,
    GraphReadService,
    ItemService,
    UserContextService,
    GraphEventListener,
    PersonService,
    PersonActivityService,
    EntityMergeBlockService,
    PersonDuplicateService,
    PersonMergeService,
    ConceptService,
    FileService,
    PlaceService,
    KnownPlacesService,
    LifeStatsService,
  ],
  controllers: [GraphController],
  exports: [
    CommunicationService,
    ContentService,
    GraphDeltaWriter,
    EventService,
    GraphEventService,
    ItemService,
    PersonService,
    PersonActivityService,
    EntityMergeBlockService,
    PersonDuplicateService,
    PersonMergeService,
    ConceptService,
    UserContextService,
    GraphUtilityService,
    GraphQueryService,
    GraphReadService,
    FileService,
    PlaceService,
    KnownPlacesService,
  ],
})
export class MemoryModule {}

// FileEntity is deliberately absent: the graph's file row is an internal
// concern maintained by the FileUploadedEvent listener, and re-exporting it
// under that name would collide with the files domain's FileEntity — the
// record it references — at every call site that imports both.
export {
  BaseEntity,
  CommunicationEntity,
  CommunicationBaseEntity,
  ContentEntity,
  ContentBaseEntity,
  EventEntity,
  EventBaseEntity,
  ItemEntity,
  ObjectObservationEntity,
  PersonEntity,
  ConceptEntity,
  PlaceEntity,
  ProductModelEntity,
  ReceiptEntity,
  ReceiptLineItemEntity,
  GraphNodeEntity,
  ItemBaseEntity,
  RelationshipEntity,
};

// Services
export {
  ContentService,
  GraphDeltaWriter,
  EventService,
  CommunicationService,
  GraphEventService,
  ItemService,
  PersonService,
  PersonActivityService,
  EntityMergeBlockService,
  PersonDuplicateService,
  PersonMergeService,
  ConceptService,
  UserContextService,
  GraphUtilityService,
  GraphQueryService,
  GraphReadService,
  FileService,
  PlaceService,
  KnownPlacesService,
};

export type { Content } from './entities/ContentEntity';
export type { PlaceKind } from './entities/PlaceEntity';
export type { PlaceVisitStats } from './services/PlaceService';
export { EntityMergeBlockEntity, orderPair, pairKey } from './entities/EntityMergeBlockEntity';
export { previewFromContent } from './entities/CommunicationEntity';
export type { BlockReason } from './services/EntityMergeBlockService';
export type { PersonDuplicateGroup, DuplicateReason } from './services/PersonDuplicateService';
export type { PersonInteractionStats } from './services/PersonActivityService';
export type { MergeCounts } from './services/PersonMergeService';
export type { CreateEventDto, UpdateEventDto, CreateContentDto, UpdateContentDto } from './types';
// The remaining ingest DTOs, exported for the same reason as the ones above:
// they are the shapes other domains hand to this one's services, so they belong
// on the public surface rather than behind a reach into ./types.
export type {
  CreateItemDto,
  UpdateItemDto,
  PhysicalItemPropertiesDto,
  CreatePersonDto,
  UpdatePersonDto,
} from './types';
// The physical vocabulary of an item. Exported because the API layer needs the
// same enums the CHECK constraints hold, and importers/listeners need the same
// unit parsing the services use — a second implementation of either is a second
// definition of what a millimetre is.
export {
  ACQUISITION_METHODS,
  MAX_ARRAY_TERMS,
  MAX_DIMENSION_MM,
  MAX_MASS_G,
  MAX_VOLUME_ML,
  PhysicalPropertyError,
  UNIT_SYSTEMS,
  normalizeAcquisitionMethod,
  normalizeColorHex,
  normalizeColors,
  normalizeComposition,
  normalizeMaterials,
  normalizePhysicalProperties,
  normalizeUnitSystem,
  parseDimensions,
  parseLengthMm,
  parseMassG,
  parseVolumeMl,
} from './physicalProperties';
export type { AcquisitionMethod, NormalizedPhysicalProperties, UnitSystem } from './physicalProperties';
export type {
  KnownPlace,
  KnownPlaceKind,
  KnownPlaceSource,
  KnownPlaceCandidate,
} from './services/KnownPlacesService';
export type { Concept, Event, Item, InventoryCondition, Person, Communication, Place };
export type {
  InventoryIdentityMethod,
  InventoryLifecycleState,
  ObjectObservation,
  ObservationResolutionMethod,
  ObservationSourceKind,
  ProductModel,
  Receipt,
  ReceiptExtractionState,
  ReceiptLineItem,
};
export {
  CommunicationDirection,
  CommunicationType,
  CreateCommunicationDto,
  NORMALIZED_PERSON_FIELDS,
  UpdateCommunicationDto,
} from './types';
