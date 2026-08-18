import { SYSTEM_USER } from '@ci/common/context';

import { ConceptSearchIndexListener } from '../ConceptSearchIndexListener';

function makeListener(concept: Record<string, unknown> | null = null) {
  const conceptService = { findById: jest.fn().mockResolvedValue(concept) };
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

  const listener = new ConceptSearchIndexListener(
    conceptService as never,
    embeddingGenerationService as never,
    embeddingService as never,
    vectorService as never,
    logger as never,
  );

  return { listener, conceptService, embeddingGenerationService, embeddingService, vectorService, logger };
}

describe('ConceptSearchIndexListener.unindexConcept', () => {
  it('removes the embedding and the vector for (concept, id), under the system context', async () => {
    const { listener, embeddingService, vectorService } = makeListener();

    await listener.unindexConcept({ conceptId: 'concept-1' } as never);

    expect(embeddingService.remove).toHaveBeenCalledWith(
      { userId: SYSTEM_USER },
      { entityType: 'concept', entityId: 'concept-1' },
    );
    expect(vectorService.remove).toHaveBeenCalledWith(
      { userId: SYSTEM_USER },
      { entityType: 'concept', entityId: 'concept-1' },
    );
  });
});

describe('ConceptSearchIndexListener.indexConcept / updateConcept', () => {
  it('is a no-op when the concept cannot be found', async () => {
    const { listener, embeddingService, vectorService, logger } = makeListener(null);

    await listener.indexConcept({ conceptId: 'ghost' } as never);

    expect(embeddingService.upsert).not.toHaveBeenCalled();
    expect(vectorService.upsert).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('is a no-op when the concept has no associated user', async () => {
    const { listener, embeddingService, vectorService } = makeListener({
      id: 'concept-1',
      userId: null,
      name: 'Photography',
      description: 'A hobby',
    });

    await listener.indexConcept({ conceptId: 'concept-1' } as never);

    expect(embeddingService.upsert).not.toHaveBeenCalled();
    expect(vectorService.upsert).not.toHaveBeenCalled();
  });

  it('embeds and vectorizes a concept scoped to its user, passing the generated embedding through', async () => {
    const { listener, embeddingGenerationService, embeddingService, vectorService } = makeListener({
      id: 'concept-1',
      userId: 'user-1',
      name: 'Photography',
      description: 'A creative hobby',
    });

    await listener.updateConcept({ conceptId: 'concept-1' } as never);

    expect(embeddingGenerationService.generateEmbedding).toHaveBeenCalledWith('Photography A creative hobby');
    expect(embeddingService.upsert).toHaveBeenCalledWith(
      { userId: 'user-1' },
      { entityType: 'concept', entityId: 'concept-1', embedding: [0.1, 0.2] },
    );
    expect(vectorService.upsert).toHaveBeenCalledWith(
      { userId: 'user-1' },
      {
        entityType: 'concept',
        entityId: 'concept-1',
        searchableText: [
          { text: 'Photography', weight: 10 },
          { text: 'A creative hobby', weight: 5 },
        ],
      },
    );
  });

  it('skips both embedding and vectorization for a concept with no name or description', async () => {
    const { listener, embeddingService, vectorService } = makeListener({
      id: 'concept-2',
      userId: 'user-1',
      name: null,
      description: null,
    });

    await listener.indexConcept({ conceptId: 'concept-2' } as never);

    expect(embeddingService.upsert).not.toHaveBeenCalled();
    expect(vectorService.upsert).not.toHaveBeenCalled();
  });

  // getSearchDocument dedupes via a Set — an identical name and description
  // must not double up in the embedded document.
  it('dedupes the embedded document when name and description are identical', async () => {
    const { listener, embeddingGenerationService } = makeListener({
      id: 'concept-3',
      userId: 'user-1',
      name: 'Same text',
      description: 'Same text',
    });

    await listener.indexConcept({ conceptId: 'concept-3' } as never);

    expect(embeddingGenerationService.generateEmbedding).toHaveBeenCalledWith('Same text');
  });

  // No IndexSkipService dependency and no low-value filter (unlike Communication
  // / Thread / BrowserActivity): ANY non-empty name/description is embedded,
  // however short. This documents that, so a future addition of the skip guard
  // is a deliberate, visible change to this test — not a silent behavior shift.
  it('embeds even a very short name — no low-value skip check exists here', async () => {
    const { listener, embeddingService } = makeListener({
      id: 'concept-4',
      userId: 'user-1',
      name: 'ok',
      description: null,
    });

    await listener.indexConcept({ conceptId: 'concept-4' } as never);

    expect(embeddingService.upsert).toHaveBeenCalled();
  });
});
