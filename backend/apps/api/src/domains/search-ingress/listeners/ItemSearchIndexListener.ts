import { Injectable } from '@nestjs/common';

import { ServiceContext, SYSTEM_USER } from '@ci/common/context';
import { EmbeddingGenerationService } from '@ci/common/embeddings';
import { LoggerService } from '@ci/common/logging';
import { OnEvent } from '@ci/domains/events';
import { type Item, ItemService, PlaceService } from '@ci/domains/memory';
import {
  ItemCreatedEvent,
  ItemRemovedEvent,
  ItemUpdatedEvent,
  type ItemCreatedPayload,
  type ItemDeletedPayload,
  type ItemUpdatedPayload,
} from '@ci/domains/memory/events';
import { itemSearchDocument, itemWeightedTexts } from '@ci/domains/search-ingress/searchTexts';
import { EmbeddingService } from '@ci/domains/search-ingress/services/EmbeddingService';
import { VectorService } from '@ci/domains/search-ingress/services/VectorService';
import { type WeightedText } from '@ci/domains/search-ingress/types';

@Injectable()
export class ItemSearchIndexListener {
  constructor(
    private readonly itemService: ItemService,
    private readonly placeService: PlaceService,
    private readonly embeddingGenerationService: EmbeddingGenerationService,
    private readonly embeddingService: EmbeddingService,
    private readonly vectorService: VectorService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(ItemSearchIndexListener.name);
  }

  @OnEvent(ItemCreatedEvent, { queue: 'search-index' })
  async indexItem(payload: ItemCreatedPayload | ItemUpdatedPayload) {
    this.logger.log('Adding new item to search index', {
      itemId: payload.itemId,
    });

    await this.upsertItem(payload);
  }

  @OnEvent(ItemUpdatedEvent, { queue: 'search-index' })
  async updateItem(payload: ItemCreatedPayload | ItemUpdatedPayload) {
    this.logger.log('Updating item in search index', {
      itemId: payload.itemId,
    });

    await this.upsertItem(payload);
  }

  @OnEvent(ItemRemovedEvent, { queue: 'search-index' })
  async unindexItem(payload: ItemDeletedPayload) {
    this.logger.log('Removing item in search index', {
      itemId: payload.itemId,
    });

    const context = {
      userId: SYSTEM_USER,
    } satisfies ServiceContext;

    await this.embeddingService.remove(context, {
      entityType: 'item',
      entityId: payload.itemId,
    });

    this.logger.log('Removed embedding for item');

    await this.vectorService.remove(context, {
      entityType: 'item',
      entityId: payload.itemId,
    });

    this.logger.log('Removed tsvector for item');
  }

  private async upsertItem(payload: ItemCreatedPayload | ItemUpdatedPayload) {
    const context = {
      userId: SYSTEM_USER,
    } satisfies ServiceContext;

    const item = await this.itemService.findById(context, payload.itemId);

    if (item == null) {
      this.logger.warn('Item not found, skipping indexing');

      return;
    }

    if (item.userId == null) {
      this.logger.warn('Item has no associated user, cannot index');

      return;
    }

    const placeName = await this.lastSeenPlaceName(item.lastSeenPlaceEntityId);
    const searchDocument = this.getSearchDocument(item, placeName);

    if (searchDocument == null) {
      this.logger.log('Item has no search document, skipping embedding');
    } else {
      const embedding = await this.embeddingGenerationService.generateEmbedding(searchDocument);

      await this.embeddingService.upsert(
        {
          userId: item.userId,
        },
        {
          entityType: 'item',
          entityId: item.id,
          embedding,
        },
      );

      this.logger.log('Generated embedding for item');
    }

    const searchItem = this.getSearchItem(item, placeName);

    if (searchItem.length === 0) {
      this.logger.log('Item has no search item, skipping vectorization');
    } else {
      await this.vectorService.upsert(
        {
          userId: item.userId,
        },
        {
          entityType: 'item',
          entityId: item.id,
          searchableText: searchItem,
        },
      );

      this.logger.log('Generated tsvector for item');
    }
  }

  private async lastSeenPlaceName(placeId: string | null): Promise<string | null> {
    if (!placeId) {
      return null;
    }

    const place = await this.placeService.findById({ userId: SYSTEM_USER }, placeId);
    const name = place?.name?.trim();

    return name && name.length > 0 ? name : null;
  }

  private getSearchItem(item: Item, placeName: string | null): WeightedText[] {
    return itemWeightedTexts({ ...item, lastSeenPlaceName: placeName });
  }

  private getSearchDocument(item: Item, placeName: string | null): string | null {
    return itemSearchDocument({ ...item, lastSeenPlaceName: placeName });
  }
}
