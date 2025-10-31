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
      if (!this.hasMeaningfulText(payload.searchContent)) {
        this.logger.debug('Skipping entity embedding due to empty search content', {
          ownerId: payload.ownerId,
          entityId: payload.entityId,
        });

        return;
      }

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

  @OnEvent(Events.SEARCH_EMBED_CONTENT)
  async handleContentEmbedding(payload: EventPayloads[Events.SEARCH_EMBED_CONTENT]) {
    try {
      if (!this.hasMeaningfulText(payload.text)) {
        this.logger.debug('Skipping content embedding due to empty text', {
          ownerId: payload.ownerId,
          contentId: payload.contentId,
        });

        return;
      }

      const success = await this.embeddingService.embedContent(payload.contentId, payload.text);

      if (!success) {
        throw new Error('Embedding service reported a failure while generating content embedding.');
      }
    } catch (error) {
      this.logger.error('Failed to embed content record', {
        ownerId: payload.ownerId,
        contentId: payload.contentId,
        error: error instanceof Error ? error.message : String(error),
      });

      throw error;
    }
  }

  @OnEvent(Events.SEARCH_EMBED_EVENT)
  async handleEventEmbedding(payload: EventPayloads[Events.SEARCH_EMBED_EVENT]) {
    try {
      if (!this.hasMeaningfulText(payload.searchContent)) {
        this.logger.debug('Skipping event embedding due to empty search content', {
          ownerId: payload.ownerId,
          eventId: payload.eventId,
        });

        return;
      }

      const success = await this.embeddingService.embedEvent(payload.eventId, payload.searchContent);

      if (!success) {
        throw new Error('Embedding service reported a failure while generating event embedding.');
      }
    } catch (error) {
      this.logger.error('Failed to embed event record', {
        ownerId: payload.ownerId,
        eventId: payload.eventId,
        error: error instanceof Error ? error.message : String(error),
      });

      throw error;
    }
  }

  @OnEvent(Events.SEARCH_EMBED_COMMUNICATION)
  async handleCommunicationEmbedding(payload: EventPayloads[Events.SEARCH_EMBED_COMMUNICATION]) {
    const { communication } = payload;
    const segments: Array<string | null> = [communication.subject ?? null, communication.content ?? null];
    const searchContent = segments
      .filter((segment): segment is string => this.hasMeaningfulText(segment))
      .join(' ')
      .trim();

    try {
      if (!this.hasMeaningfulText(searchContent)) {
        this.logger.debug('Skipping communication embedding due to empty search content', {
          ownerId: payload.ownerId,
          communicationType: communication.communicationType,
          occurredAt: communication.occurredAt,
        });

        return;
      }

      const success = await this.embeddingService.embedCommunication(
        communication.userId,
        communication.communicationType,
        communication.occurredAt,
        searchContent,
      );

      if (!success) {
        throw new Error('Embedding service reported a failure while generating communication embedding.');
      }
    } catch (error) {
      this.logger.error('Failed to embed communication record', {
        ownerId: payload.ownerId,
        userId: communication.userId,
        communicationType: communication.communicationType,
        occurredAt: communication.occurredAt,
        error: error instanceof Error ? error.message : String(error),
      });

      throw error;
    }
  }

  private hasMeaningfulText(value?: string | null): value is string {
    return typeof value === 'string' && value.trim().length > 0;
  }
}
