import { Injectable } from '@nestjs/common';

import { LoggerService } from '@ci/common/services';
import { Events, type EventPayloads, OnEvent } from '@ci/domains/events';

import { EmbeddingService } from '../services/EmbeddingService';

@Injectable()
export class EmbeddingEventListener {
  private readonly logger = new LoggerService(EmbeddingEventListener.name);

  constructor(private readonly embeddingService: EmbeddingService) {}

  @OnEvent(Events.SEARCH_EMBED_ENTITY)
  async handleEntityEmbedding(payload: EventPayloads[Events.SEARCH_EMBED_ENTITY]) {
    try {
      const success = await this.embeddingService.embedEntity(payload.entityId, payload.searchContent);

      if (!success) {
        throw new Error('Embedding service reported a failure while generating entity embedding.');
      }
    } catch (error) {
      this.logger.error('Failed to embed graph entity', {
        ownerId: payload.ownerId,
        entityId: payload.entityId,
        entityType: payload.entityType,
        error: error instanceof Error ? error.message : String(error),
      });

      throw error;
    }
  }
}
