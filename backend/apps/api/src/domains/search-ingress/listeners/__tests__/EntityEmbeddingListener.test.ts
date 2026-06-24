import type { EventPayloads, Events } from '@ci/domains/events';

import { EntityEmbeddingListener } from '../EntityEmbeddingListener';

type Payload = EventPayloads[Events.SEARCH_EMBED_ENTITY];

function makeListener() {
  const generateEmbedding = jest.fn(async () => [0.1, 0.2, 0.3]);
  const upsert = jest.fn(async () => null);
  const logger = { setContext: jest.fn(), log: jest.fn() };

  const listener = new EntityEmbeddingListener(
    { generateEmbedding } as never,
    { upsert } as never,
    logger as never,
  );

  return { listener, generateEmbedding, upsert, logger };
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

  it('skips generation and upsert when the search content is empty', async () => {
    const { listener, generateEmbedding, upsert } = makeListener();

    await listener.embedEntity({ ...basePayload, searchContent: '   ' });

    expect(generateEmbedding).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('skips a non-embeddable entity type', async () => {
    const { listener, generateEmbedding, upsert } = makeListener();

    await listener.embedEntity({ ...basePayload, entityType: 'Goal' });

    expect(generateEmbedding).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('skips when no entity type is supplied (cannot resolve a search type)', async () => {
    const { listener, generateEmbedding, upsert } = makeListener();

    await listener.embedEntity({ ...basePayload, entityType: undefined });

    expect(generateEmbedding).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });
});
