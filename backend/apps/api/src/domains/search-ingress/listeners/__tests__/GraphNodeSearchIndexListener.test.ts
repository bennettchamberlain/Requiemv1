import type { EventPayloads, Events } from '@ci/domains/events';

import { GraphNodeSearchIndexListener } from '../GraphNodeSearchIndexListener';

type Payload = EventPayloads[Events.GRAPH_NODE_UPSERTED];

function makeListener() {
  const generateEmbedding = jest.fn(async () => [0.1, 0.2, 0.3]);
  const embeddingUpsert = jest.fn(async () => null);
  const vectorUpsert = jest.fn(async () => null);
  const logger = { setContext: jest.fn(), log: jest.fn(), debug: jest.fn(), warn: jest.fn() };

  const listener = new GraphNodeSearchIndexListener(
    { generateEmbedding } as never,
    { upsert: embeddingUpsert } as never,
    { upsert: vectorUpsert } as never,
    logger as never,
  );

  return { listener, generateEmbedding, embeddingUpsert, vectorUpsert, logger };
}

function payload(overrides: Partial<Payload['node']> = {}): Payload {
  return {
    ownerId: 'owner-1',
    node: {
      entityId: 'entity-1',
      entityType: 'Item',
      name: 'Mochi',
      description: 'Greyhound rescued about a year ago',
      properties: {},
      ...overrides,
    },
  } as Payload;
}

describe('GraphNodeSearchIndexListener.indexGraphNode', () => {
  it('writes a tsvector row — the search CANDIDATE source — not just an embedding', async () => {
    const { listener, vectorUpsert, embeddingUpsert } = makeListener();

    await listener.indexGraphNode(payload());

    expect(vectorUpsert).toHaveBeenCalledTimes(1);
    expect(vectorUpsert).toHaveBeenCalledWith(
      { userId: 'owner-1' },
      {
        entityType: 'item',
        entityId: 'entity-1',
        searchableText: [
          { text: 'Mochi', weight: 10 },
          { text: 'Greyhound rescued about a year ago', weight: 5 },
        ],
      },
    );
    expect(embeddingUpsert).toHaveBeenCalledWith(
      { userId: 'owner-1' },
      { entityType: 'item', entityId: 'entity-1', embedding: [0.1, 0.2, 0.3] },
    );
  });

  it('normalizes the graph type onto the search vocabulary', async () => {
    const { listener, vectorUpsert } = makeListener();

    await listener.indexGraphNode(payload({ entityType: 'Content' }));

    expect(vectorUpsert).toHaveBeenCalledWith(
      { userId: 'owner-1' },
      expect.objectContaining({ entityType: 'content' }),
    );
  });

  it('leaves person / place / concept to their per-type listeners', async () => {
    for (const entityType of ['Person', 'Contact', 'Place', 'Location', 'Concept']) {
      const { listener, vectorUpsert, embeddingUpsert, generateEmbedding } = makeListener();

      await listener.indexGraphNode(payload({ entityType }));

      expect(vectorUpsert).not.toHaveBeenCalled();
      expect(embeddingUpsert).not.toHaveBeenCalled();
      expect(generateEmbedding).not.toHaveBeenCalled();
    }
  });

  it('skips a type with no search representation', async () => {
    const { listener, vectorUpsert, embeddingUpsert } = makeListener();

    await listener.indexGraphNode(payload({ entityType: 'Organization' }));

    expect(vectorUpsert).not.toHaveBeenCalled();
    expect(embeddingUpsert).not.toHaveBeenCalled();
  });

  it('skips a node with no text at all', async () => {
    const { listener, vectorUpsert, embeddingUpsert } = makeListener();

    await listener.indexGraphNode(payload({ name: '  ', description: null, searchContent: null }));

    expect(vectorUpsert).not.toHaveBeenCalled();
    expect(embeddingUpsert).not.toHaveBeenCalled();
  });

  it('still writes the tsvector when the text is too low-value to embed', async () => {
    // Keyword indexing is deliberately NOT gated by the embeddability bar, and
    // skipping the embedding must not skip the candidate row.
    const { listener, vectorUpsert, embeddingUpsert, generateEmbedding } = makeListener();

    await listener.indexGraphNode(payload({ name: 'ok', description: null, searchContent: null }));

    expect(vectorUpsert).toHaveBeenCalledTimes(1);
    expect(generateEmbedding).not.toHaveBeenCalled();
    expect(embeddingUpsert).not.toHaveBeenCalled();
  });

  it('adds an explicit searchContent as a third, lower-weighted term', async () => {
    const { listener, vectorUpsert } = makeListener();

    await listener.indexGraphNode(payload({ searchContent: 'dog greyhound rescue' }));

    expect(vectorUpsert).toHaveBeenCalledWith(
      { userId: 'owner-1' },
      expect.objectContaining({
        searchableText: [
          { text: 'Mochi', weight: 10 },
          { text: 'Greyhound rescued about a year ago', weight: 5 },
          { text: 'dog greyhound rescue', weight: 2 },
        ],
      }),
    );
  });

  it('does not duplicate a searchContent that merely repeats the name', async () => {
    const { listener, vectorUpsert } = makeListener();

    await listener.indexGraphNode(payload({ description: null, searchContent: 'Mochi' }));

    expect(vectorUpsert).toHaveBeenCalledWith(
      { userId: 'owner-1' },
      expect.objectContaining({ searchableText: [{ text: 'Mochi', weight: 10 }] }),
    );
  });

  it('ignores a payload with no entity id', async () => {
    const { listener, vectorUpsert } = makeListener();

    await listener.indexGraphNode(payload({ entityId: '' }));

    expect(vectorUpsert).not.toHaveBeenCalled();
  });
});
