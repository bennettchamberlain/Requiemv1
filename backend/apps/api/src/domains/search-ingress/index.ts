/**
 * This module consumes entity creation, update, and removal events and
 * maintains an eventually consistent search index.
 *
 * @module SearchIngressModule
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { EmbeddingModule } from '@ci/common/embeddings';
import { ConversationModule } from '@ci/domains/conversations';
import { FilesModule } from '@ci/domains/files';
import { IntelligenceModule } from '@ci/domains/intelligence';
import { MemoryModule } from '@ci/domains/memory';

import { EmbeddingEntity } from './entities/EmbeddingEntity';
import { VectorEntity } from './entities/VectorEntity';
import { AnswerSearchIndexListener } from './listeners/AnswerSearchIndexListener';
import { CommunicationSearchIndexListener } from './listeners/CommunicationSearchIndexListener';
import { ContentSearchIndexListener } from './listeners/ContentSearchIndexListener';
import { EventSearchIndexListener } from './listeners/EventSearchIndexListener';
import { FileSearchIndexListener } from './listeners/FileSearchIndexListener';
import { ItemSearchIndexListener } from './listeners/ItemSearchIndexListener';
import { PersonSearchIndexListener } from './listeners/PersonSearchIndexListener';
import { PlaceSearchIndexListener } from './listeners/PlaceSearchIndexListener';
import { ThreadSearchIndexListener } from './listeners/ThreadSearchIndexListener';
import { EmbeddingService } from './services/EmbeddingService';
import { VectorService } from './services/VectorService';

/**
 * @internal
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([EmbeddingEntity, VectorEntity]),
    ConversationModule,
    EmbeddingModule,
    FilesModule,
    IntelligenceModule,
    MemoryModule,
  ],
  providers: [
    AnswerSearchIndexListener,
    CommunicationSearchIndexListener,
    ContentSearchIndexListener,
    EmbeddingService,
    EventSearchIndexListener,
    FileSearchIndexListener,
    ItemSearchIndexListener,
    PersonSearchIndexListener,
    PlaceSearchIndexListener,
    ThreadSearchIndexListener,
    VectorService,
  ],
})
export class SearchIngressModule {}

export { EmbeddingEntity, VectorEntity };
