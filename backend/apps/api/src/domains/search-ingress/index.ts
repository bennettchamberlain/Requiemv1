/**
 * This module consumes entity creation, update, and removal events and
 * maintains an eventually consistent search index.
 *
 * @module SearchIngressModule
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { EmbeddingModule } from '@ci/common/embeddings';
import { MemoryModule } from '@ci/domains/memory';

import { EmbeddingEntity } from './entities/EmbeddingEntity';
import { VectorEntity } from './entities/VectorEntity';
import { PersonSearchIndexListener } from './listeners/PersonSearchIndexListener';
import { EmbeddingService } from './services/EmbeddingService';

/**
 * @internal
 */
@Module({
  imports: [TypeOrmModule.forFeature([EmbeddingEntity, VectorEntity]), EmbeddingModule, MemoryModule],
  providers: [EmbeddingService, PersonSearchIndexListener],
})
export class SearchIngressModule {}
