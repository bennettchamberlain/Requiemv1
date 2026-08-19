import type { EventPayloads, Events } from '@ci/domains/events';

import { EntityEmbeddingListener } from '../EntityEmbeddingListener';

type Payload = EventPayloads[Events.SEARCH_EMBED_ENTITY];

function makeListener() {
  const generateEmbedding = jest.fn(async () => [0.1, 0.2, 0.3]);
  const upsert = jest.fn(async () => null);
  const vectorUpsert = jest.fn(async () => null);
  const logger = { setContext: jest.fn(), log: jest.fn() };

  const listener = new EntityEmbeddingListener(
    { generateEmbedding } as never,
    { upsert } as never,
    { upsert: vectorUpsert } as never,
    logger as never,
  );

  return { listener, generateEmbedding, upsert, vectorUpsert, logger };
}

const basePayload: Payload = {
  ownerId: 'owner-1',
  entityId: 'entity-1',
  entityType: 'Person',
  searchContent: 'Dana Scully fbi agent',
};

describe('EntityEmbeddingListener.embedEntity', () => {
  it('embeds the search content and upserts under the normalized search type', async () => {
    const { listener, generateEmbedding, upsert } = makeListener();

    await listener.embedEntity(basePayload);

    expect(generateEmbedding).toHaveBeenCalledWith('Dana Scully fbi agent');
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(
      { userId: 'owner-1' },
      // 'Person' (graph vocabulary) is normalized to 'person' (search vocabulary)
      // so the embedding lands in the space SearchService actually queries.
      { entityType: 'person', entityId: 'entity-1', embedding: [0.1, 0.2, 0.3] },
    );
  });

  it('also writes the tsvector row, which is what makes the entity a search candidate', async () => {
    // An embedding-only write leaves the entity unsearchable AND excludes it
    // from SearchIndexBackfillService, which anti-joins on ci_search.embeddings.
    const { listener, vectorUpsert } = makeListener();

    await listener.embedEntity(basePayload);

    expect(vectorUpsert).toHaveBeenCalledTimes(1);
    expect(vectorUpsert).toHaveBeenCalledWith(
      { userId: 'owner-1' },
      {
        entityType: 'person',
        entityId: 'entity-1',
        searchableText: [{ text: 'Dana Scully fbi agent', weight: 5 }],
      },
    );
  });

  it('skips generation and both upserts when the search content is empty', async () => {
    const { listener, generateEmbedding, upsert, vectorUpsert } = makeListener();

    await listener.embedEntity({ ...basePayload, searchContent: '   ' });

    expect(generateEmbedding).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(vectorUpsert).not.toHaveBeenCalled();
  });

  it('still writes the tsvector when the content is too low-value to embed', async () => {
    const { listener, generateEmbedding, upsert, vectorUpsert } = makeListener();

    await listener.embedEntity({ ...basePayload, searchContent: 'ok' });

    expect(vectorUpsert).toHaveBeenCalledTimes(1);
    expect(generateEmbedding).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('skips a non-embeddable entity type', async () => {
    const { listener, generateEmbedding, upsert, vectorUpsert } = makeListener();

    await listener.embedEntity({ ...basePayload, entityType: 'Goal' });

    expect(generateEmbedding).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(vectorUpsert).not.toHaveBeenCalled();
  });

  it('skips when no entity type is supplied (cannot resolve a search type)', async () => {
    const { listener, generateEmbedding, upsert, vectorUpsert } = makeListener();

    await listener.embedEntity({ ...basePayload, entityType: undefined });

    expect(generateEmbedding).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(vectorUpsert).not.toHaveBeenCalled();
  });
});
