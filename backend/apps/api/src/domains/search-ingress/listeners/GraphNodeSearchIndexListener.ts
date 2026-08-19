import { Injectable } from '@nestjs/common';

import { EmbeddingGenerationService, embedSkipReason, normalizeEmbeddableType } from '@ci/common/embeddings';
import { LoggerService } from '@ci/common/logging';
import { type EventPayloads, Events, OnEvent } from '@ci/domains/events';
import { type IndexableEntity } from '@ci/domains/search-next';

import { EmbeddingService } from '../services/EmbeddingService';
import { VectorService } from '../services/VectorService';
import { type WeightedText } from '../types';

/**
 * Graph types `GraphEventListener.emitSearchIndexEvent` already re-emits a
 * per-type `*Created`/`*UpdatedEvent` for. Their row lives in `ci.entities`, so
 * `PersonService` / `PlaceService` / `ConceptService` resolve it and the existing
 * `*SearchIndexListener` builds the richer, properties-aware search document.
 * Indexing them here as well would only pay for a second embedding of a strictly
 * poorer document.
 *
 * Keep in sync with `GRAPH_TYPE_TO_DOMAIN` in
 * `domains/memory/listeners/GraphEventListener.ts` — deliberately duplicated
 * rather than imported, so search-ingress does not reach into another domain's
 * listener module.
 */
const HANDLED_BY_PER_TYPE_LISTENER: ReadonlySet<string> = new Set(['person', 'place', 'concept']);

/**
 * Indexes a graph node written through `GraphEventService.upsertNode` for the
 * entity types whose per-type `*SearchIndexListener` cannot see it.
 *
 * `Event`, `Item` and `Content` are class-table-inherited: the authoritative row
 * is split between a `ci.entities` base row and a detail row in `ci.events` /
 * `ci.inventory` / `ci.content`. A generic graph upsert writes only the base
 * half, so `eventService.findById` and friends return null and their listeners
 * log "not found, skipping indexing" — the node stays invisible to search and to
 * /api/memory/recall.
 *
 * This listener closes that gap by indexing straight from the event payload, no
 * domain-service lookup required — which also means it does not race the
 * `default`-queue handler that performs the actual `ci.entities` write.
 *
 * It writes a `ci_search.vectors` row, not just an embedding. In this codebase
 * `ci_search.vectors` is the search CANDIDATE source and `ci_search.embeddings`
 * only a re-rank boost, so an embedding-only write leaves the row unsearchable —
 * and worse, permanently so: `SearchIndexBackfillService` anti-joins on
 * `ci_search.embeddings`, so a row that has one is never swept up again.
 */
@Injectable()
export class GraphNodeSearchIndexListener {
  constructor(
    private readonly embeddingGenerationService: EmbeddingGenerationService,
    private readonly embeddingService: EmbeddingService,
    private readonly vectorService: VectorService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(GraphNodeSearchIndexListener.name);
  }

  @OnEvent(Events.GRAPH_NODE_UPSERTED, { queue: 'search-index' })
  async indexGraphNode(payload: EventPayloads[Events.GRAPH_NODE_UPSERTED]) {
    const { node } = payload;

    if (!node?.entityId || !payload.ownerId) {
      return;
    }

    const searchType = normalizeEmbeddableType(node.entityType);

    if (searchType == null || HANDLED_BY_PER_TYPE_LISTENER.has(searchType)) {
      this.logger.debug('Skipping graph node search indexing', {
        entityId: node.entityId,
        entityType: node.entityType ?? null,
        reason: searchType == null ? 'type has no search representation' : 'handled by per-type listener',
      });

      return;
    }

    const entityType = searchType as IndexableEntity;
    const name = (node.name ?? '').trim();
    const description = (node.description ?? '').trim();
    const explicit = (node.searchContent ?? '').trim();

    const searchableText: WeightedText[] = [];

    if (name) {
      searchableText.push({ text: name, weight: 10 });
    }

    if (description) {
      searchableText.push({ text: description, weight: 5 });
    }

    if (explicit && explicit !== name && explicit !== description) {
      searchableText.push({ text: explicit, weight: 2 });
    }

    if (searchableText.length === 0) {
      this.logger.log('Graph node has no search content, skipping indexing', {
        entityId: node.entityId,
        entityType,
      });

      return;
    }

    const context = { userId: payload.ownerId };

    // Keyword indexing first, and unconditionally: the tsvector is what makes the
    // node a search CANDIDATE, and it is deliberately not gated by the
    // embeddability quality bar (see `@ci/common/embeddings`).
    await this.vectorService.upsert(context, {
      entityType,
      entityId: node.entityId,
      searchableText,
    });

    this.logger.log('Generated tsvector for graph node', {
      entityId: node.entityId,
      entityType,
    });

    const searchDocument = searchableText.map((part) => part.text).join(' ');
    const skipReason = embedSkipReason(searchDocument);

    if (skipReason != null) {
      this.logger.log('Skipping embedding for graph node', {
        entityId: node.entityId,
        entityType,
        reason: skipReason,
      });

      return;
    }

    const embedding = await this.embeddingGenerationService.generateEmbedding(searchDocument);

    await this.embeddingService.upsert(context, {
      entityType,
      entityId: node.entityId,
      embedding,
    });

    this.logger.log('Generated embedding for graph node', {
      entityId: node.entityId,
      entityType,
    });
  }
}
