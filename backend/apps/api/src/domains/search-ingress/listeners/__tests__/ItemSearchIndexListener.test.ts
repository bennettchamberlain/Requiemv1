import { SYSTEM_USER } from '@ci/common/context';

import { ItemSearchIndexListener } from '../ItemSearchIndexListener';

function makeListener(
  item: Record<string, unknown> | null = null,
  place: Record<string, unknown> | null = null,
) {
  const itemService = { findById: jest.fn().mockResolvedValue(item) };
  const placeService = { findById: jest.fn().mockResolvedValue(place) };
  const embeddingGenerationService = { generateEmbedding: jest.fn().mockResolvedValue([0.1, 0.2]) };
  const embeddingService = {
    upsert: jest.fn().mockResolvedValue(null),
    remove: jest.fn().mockResolvedValue(true),
  };
  const vectorService = {
    upsert: jest.fn().mockResolvedValue(null),
    remove: jest.fn().mockResolvedValue(true),
  };
  const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() };

  const listener = new ItemSearchIndexListener(
    itemService as never,
    placeService as never,
    embeddingGenerationService as never,
    embeddingService as never,
    vectorService as never,
    logger as never,
  );

  return {
    listener,
    itemService,
    placeService,
    embeddingGenerationService,
    embeddingService,
    vectorService,
    logger,
  };
}

describe('ItemSearchIndexListener.unindexItem', () => {
  it('removes the embedding and the vector for (item, id), under the system context', async () => {
    const { listener, embeddingService, vectorService } = makeListener();

    await listener.unindexItem({ itemId: 'item-1' } as never);

    expect(embeddingService.remove).toHaveBeenCalledWith(
      { userId: SYSTEM_USER },
      { entityType: 'item', entityId: 'item-1' },
    );
    expect(vectorService.remove).toHaveBeenCalledWith(
      { userId: SYSTEM_USER },
      { entityType: 'item', entityId: 'item-1' },
    );
  });
});

describe('ItemSearchIndexListener — resolving the last-seen place name', () => {
  it("looks up the item's lastSeenPlaceEntityId under the SYSTEM context and folds the name into the document", async () => {
    const { listener, placeService, embeddingGenerationService } = makeListener(
      { id: 'item-1', userId: 'user-1', name: 'Cordless drill', lastSeenPlaceEntityId: 'place-1' },
      { id: 'place-1', name: 'Garage' },
    );

    await listener.indexItem({ itemId: 'item-1' } as never);

    expect(placeService.findById).toHaveBeenCalledWith({ userId: SYSTEM_USER }, 'place-1');
    expect(embeddingGenerationService.generateEmbedding).toHaveBeenCalledWith('Cordless drill Garage');
  });

  it('skips the place lookup entirely when the item has no lastSeenPlaceEntityId', async () => {
    const { listener, placeService } = makeListener({
      id: 'item-1',
      userId: 'user-1',
      name: 'Cordless drill',
      lastSeenPlaceEntityId: null,
    });

    await listener.indexItem({ itemId: 'item-1' } as never);

    expect(placeService.findById).not.toHaveBeenCalled();
  });

  it('treats a place with a blank/whitespace-only name as having no name', async () => {
    const { listener, embeddingGenerationService } = makeListener(
      { id: 'item-1', userId: 'user-1', name: 'Cordless drill', lastSeenPlaceEntityId: 'place-1' },
      { id: 'place-1', name: '   ' },
    );

    await listener.indexItem({ itemId: 'item-1' } as never);

    expect(embeddingGenerationService.generateEmbedding).toHaveBeenCalledWith('Cordless drill');
  });

  it('tolerates the place having been deleted (findById resolves null) — indexes without the place name', async () => {
    const { listener, embeddingService } = makeListener(
      { id: 'item-1', userId: 'user-1', name: 'Cordless drill', lastSeenPlaceEntityId: 'gone' },
      null,
    );

    await listener.indexItem({ itemId: 'item-1' } as never);

    expect(embeddingService.upsert).toHaveBeenCalledWith(
      { userId: 'user-1' },
      expect.objectContaining({ entityType: 'item', entityId: 'item-1' }),
    );
  });
});

describe('ItemSearchIndexListener.indexItem / updateItem', () => {
  it('is a no-op when the item cannot be found', async () => {
    const { listener, embeddingService, logger } = makeListener(null);

    await listener.indexItem({ itemId: 'ghost' } as never);

    expect(embeddingService.upsert).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('is a no-op when the item has no associated user', async () => {
    const { listener, embeddingService, placeService } = makeListener({
      id: 'item-1',
      userId: null,
      name: 'Cordless drill',
    });

    await listener.indexItem({ itemId: 'item-1' } as never);

    expect(embeddingService.upsert).not.toHaveBeenCalled();
    // No point resolving a place name for an item we are about to refuse to index.
    expect(placeService.findById).not.toHaveBeenCalled();
  });

  it('embeds and vectorizes an item scoped to its user', async () => {
    const { listener, embeddingService, vectorService } = makeListener({
      id: 'item-1',
      userId: 'user-1',
      name: 'Cordless drill',
      brand: 'DeWalt',
      lastSeenPlaceEntityId: null,
    });

    await listener.updateItem({ itemId: 'item-1' } as never);

    expect(embeddingService.upsert).toHaveBeenCalledWith(
      { userId: 'user-1' },
      { entityType: 'item', entityId: 'item-1', embedding: [0.1, 0.2] },
    );
    expect(vectorService.upsert).toHaveBeenCalledWith(
      { userId: 'user-1' },
      expect.objectContaining({ entityType: 'item', entityId: 'item-1' }),
    );
  });

  it('skips both embedding and vectorization for an item with no searchable fields', async () => {
    const { listener, embeddingService, vectorService } = makeListener({
      id: 'item-2',
      userId: 'user-1',
      name: null,
      description: null,
      category: null,
      subcategory: null,
      brand: null,
      model: null,
      lastSeenPlaceEntityId: null,
      colors: null,
      materials: null,
    });

    await listener.indexItem({ itemId: 'item-2' } as never);

    expect(embeddingService.upsert).not.toHaveBeenCalled();
    expect(vectorService.upsert).not.toHaveBeenCalled();
  });
});
