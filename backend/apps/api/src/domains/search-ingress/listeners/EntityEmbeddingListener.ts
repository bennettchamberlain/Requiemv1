import { Injectable } from '@nestjs/common';

import {
  EmbeddingGenerationService,
  entityEmbedSkipReason,
  normalizeEmbeddableType,
} from '@ci/common/embeddings';
import { LoggerService } from '@ci/common/logging';
import { type EventPayloads, Events, OnEvent } from '@ci/domains/events';
import { type IndexableEntity } from '@ci/domains/search-next';

import { EmbeddingService } from '../services/EmbeddingService';

/**
 * Consumes {@link Events.SEARCH_EMBED_ENTITY} and maintains the dense embedding
 * for an arbitrary entity in `ci_search.embeddings`.
 *
 * Unlike the per-domain `*SearchIndexListener`s — which re-read a row by id and
 * derive their own search document — this listener embeds the `searchContent`
 * carried on the event payload directly. It exists so producers that don't own a
 * first-class memory row (notably graph person/concept nodes created via
 * GraphEventService) can still be made semantically searchable.
 *
 * Scoped to the `search-index` queue like every other search-ingress listener.
 * The producer (`GraphEventListener.enqueueEntityEmbedding`) sends without a
 * queue, so the event fans out to every registered queue; only the `search-index`
 * worker has a listener for it, the rest skip — matching how all other events in
 * this codebase are routed.
 */
@Injectable()
export class EntityEmbeddingListener {
  constructor(
    private readonly embeddingGenerationService: EmbeddingGenerationService,
    private readonly embeddingService: EmbeddingService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(EntityEmbeddingListener.name);
  }

  @OnEvent(Events.SEARCH_EMBED_ENTITY, { queue: 'search-index' })
  async embedEntity(payload: EventPayloads[Events.SEARCH_EMBED_ENTITY]) {
    const skipReason = entityEmbedSkipReason({
      entityType: payload.entityType,
      searchContent: payload.searchContent,
    });

    // `searchType` is non-null whenever `skipReason` is null (both go through
    // `isEmbeddableType`/`normalizeEmbeddableType`); the explicit guard narrows
    // the type for the upsert.
    const searchType = normalizeEmbeddableType(payload.entityType);

    if (skipReason != null || searchType == null) {
      this.logger.log('Skipping entity embedding', {
        entityId: payload.entityId,
        entityType: payload.entityType ?? null,
        reason: skipReason ?? 'entity type is not embeddable',
      });

      return;
    }

    const embedding = await this.embeddingGenerationService.generateEmbedding(payload.searchContent);

    await this.embeddingService.upsert(
      {
        userId: payload.ownerId,
      },
      {
        entityType: searchType as IndexableEntity,
        entityId: payload.entityId,
        embedding,
      },
    );

    this.logger.log('Generated embedding for entity', {
      entityId: payload.entityId,
      entityType: searchType,
    });
  }
}
