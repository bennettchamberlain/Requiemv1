/**
 * This module is executing search queries against the Companion Intelligence
 * search index and for manipulating entity tags.
 *
 * @module SearchNextModule
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { EmbeddingModule } from '@ci/common/embeddings';
import { RetrievalPolicyModule } from '@ci/domains/retrieval-policy';

import { type EntityTag, EntityTagEntity } from './entities/EntityTagEntity';
import { type Tag, type TimestampedTag, TagEntity } from './entities/TagEntity';
import { SearchService } from './services/SearchService';
import { type RemoveTagResult, TagService, type UpdateTagResult } from './services/TagService';

/**
 * @internal
 */
@Module({
  imports: [TypeOrmModule.forFeature([EntityTagEntity, TagEntity]), EmbeddingModule, RetrievalPolicyModule],
  providers: [SearchService, TagService],
  exports: [SearchService, TagService],
})
export class SearchNextModule {}

export { SearchService, TagService };
export {
  type AnchoredSearchOptions,
  SEMANTIC_DISTANCE_THRESHOLD,
  SEMANTIC_MAX_RESULTS,
  type SemanticSearchPlan,
  type SemanticSearchScope,
} from './services/SearchService';
export type { EntityTag, RemoveTagResult, Tag, TimestampedTag, UpdateTagResult };
export { INDEXABLE_ENTITIES, TAGGABLE_ENTITIES } from './types';
export type { EntityIdentifier, IndexableEntity, PromptSearchResult, TaggableEntity } from './types';
export { buildPromptQuery } from './promptQuery';
export type { BuildPromptQueryOptions, PromptQueryGroup } from './promptQuery';
