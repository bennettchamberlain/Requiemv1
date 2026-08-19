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
import { VectorService } from '../services/VectorService';

/**
 * Consumes {@link Events.SEARCH_EMBED_ENTITY} and maintains the search index for
 * an arbitrary entity: the `ci_search.vectors` tsvector AND the
 * `ci_search.embeddings` dense vector.
 *
 * Unlike the per-domain `*SearchIndexListener`s — which re-read a row by id and
 * derive their own search document — this listener embeds the `searchContent`
 * carried on the event payload directly. It exists so producers that don't own a
 * first-class memory row (notably graph person/concept nodes created via
 * GraphEventService) can still be made semantically searchable.
 *
 * Both rows matter, and for different reasons. `ci_search.vectors` is the search
 * CANDIDATE source — without a tsvector row the entity simply cannot be returned,
 * whatever its embedding says. And writing the embedding ALONE is worse than
 * writing nothing: `SearchIndexBackfillService.missingIds` anti-joins on
 * `ci_search.embeddings`, so an embedding-only row is permanently excluded from
 * the sweep that would otherwise have repaired it. The tsvector is written
 * unconditionally (keyword indexing is not gated by the embeddability quality
 * bar); only the dense embedding respects {@link entityEmbedSkipReason}.
 *
 * Scoped to the `search-index` queue like every other search-ingress listener.
 * The producer (`GraphEventListener.enqueueEntityEmbedding`) sends without a
 * queue, so the event is routed to every queue that has a listener for it — here,
 * only `search-index`.
 */
@Injectable()
export class EntityEmbeddingListener {
  constructor(
    private readonly embeddingGenerationService: EmbeddingGenerationService,
    private readonly embeddingService: EmbeddingService,
    private readonly vectorService: VectorService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(EntityEmbeddingListener.name);
  }

  @OnEvent(Events.SEARCH_EMBED_ENTITY, { queue: 'search-index' })
  async embedEntity(payload: EventPayloads[Events.SEARCH_EMBED_ENTITY]) {
    const searchType = normalizeEmbeddableType(payload.entityType);

    if (searchType == null) {
      this.logger.log('Skipping entity indexing', {
        entityId: payload.entityId,
        entityType: payload.entityType ?? null,
        reason: 'entity type is not embeddable',
      });

      return;
    }

    const entityType = searchType as IndexableEntity;
    const searchContent = (payload.searchContent ?? '').trim();

    if (searchContent.length === 0) {
      this.logger.log('Skipping entity indexing', {
        entityId: payload.entityId,
        entityType,
        reason: 'search content is empty',
      });

      return;
    }

    // Keyword row first, and unconditionally — it is what makes the entity a
    // search candidate at all, and it is never gated by embeddability.
    await this.vectorService.upsert(
      {
        userId: payload.ownerId,
      },
      {
        entityType,
        entityId: payload.entityId,
        searchableText: [{ text: searchContent, weight: 5 }],
      },
    );

    this.logger.log('Generated tsvector for entity', {
      entityId: payload.entityId,
      entityType,
    });

    const skipReason = entityEmbedSkipReason({
      entityType: payload.entityType,
      searchContent,
    });

    if (skipReason != null) {
      this.logger.log('Skipping entity embedding', {
        entityId: payload.entityId,
        entityType,
        reason: skipReason,
      });

      return;
    }

    const embedding = await this.embeddingGenerationService.generateEmbedding(searchContent);

    await this.embeddingService.upsert(
      {
        userId: payload.ownerId,
      },
      {
        entityType,
        entityId: payload.entityId,
        embedding,
      },
    );

    this.logger.log('Generated embedding for entity', {
      entityId: payload.entityId,
      entityType,
    });
  }
}
