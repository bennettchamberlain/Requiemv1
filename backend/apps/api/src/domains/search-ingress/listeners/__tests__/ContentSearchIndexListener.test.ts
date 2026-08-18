import { SYSTEM_USER } from '@ci/common/context';

import { ContentSearchIndexListener } from '../ContentSearchIndexListener';

function makeListener(content: Record<string, unknown> | null = null) {
  const contentService = { findById: jest.fn().mockResolvedValue(content) };
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

  const listener = new ContentSearchIndexListener(
    contentService as never,
    embeddingGenerationService as never,
    embeddingService as never,
    vectorService as never,
    logger as never,
  );

  return { listener, contentService, embeddingService, vectorService, logger };
}

const SUBSTANTIVE = {
  id: 'content-1',
  type: 'article',
  title: 'A real title',
  text: 'A substantive body of text about something searchable.',
  url: 'https://example.com/a',
  mimetype: 'text/html',
};

describe('ContentSearchIndexListener.indexRemove', () => {
  it('removes the embedding and the vector for (content, id), under the system context', async () => {
    const { listener, embeddingService, vectorService } = makeListener();

    await listener.unindexContent({ contentId: 'content-1' } as never);

    expect(embeddingService.remove).toHaveBeenCalledWith(
      { userId: SYSTEM_USER },
      { entityType: 'content', entityId: 'content-1' },
    );
    expect(vectorService.remove).toHaveBeenCalledWith(
      { userId: SYSTEM_USER },
      { entityType: 'content', entityId: 'content-1' },
    );
  });
});

describe('ContentSearchIndexListener owner-id resolution', () => {
  // This is the historical bug's exact regression surface: ci.content.user_id
  // used to persist NULL (see typeorm-relation-fk-insert-false), so the listener
  // was written to fall back to the eager-loaded `user.id` relation. Both inputs
  // must keep working.
  it('indexes using the scalar userId when present', async () => {
    const { listener, embeddingService } = makeListener({ ...SUBSTANTIVE, userId: 'user-scalar' });

    await listener.indexContent({ contentId: 'content-1' } as never);

    expect(embeddingService.upsert).toHaveBeenCalledWith(
      { userId: 'user-scalar' },
      expect.objectContaining({ entityType: 'content', entityId: 'content-1' }),
    );
  });

  it('falls back to the eager-loaded user relation when the scalar userId is null', async () => {
    const { listener, embeddingService } = makeListener({
      ...SUBSTANTIVE,
      userId: null,
      user: { id: 'user-relation' },
    });

    await listener.indexContent({ contentId: 'content-1' } as never);

    expect(embeddingService.upsert).toHaveBeenCalledWith(
      { userId: 'user-relation' },
      expect.objectContaining({ entityType: 'content' }),
    );
  });

  it('skips indexing entirely when NEITHER the scalar userId nor the relation is set', async () => {
    const { listener, embeddingService, vectorService, logger } = makeListener({
      ...SUBSTANTIVE,
      userId: null,
      user: null,
    });

    await listener.indexContent({ contentId: 'content-1' } as never);

    expect(embeddingService.upsert).not.toHaveBeenCalled();
    expect(vectorService.upsert).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('no associated user'));
  });
});

describe('ContentSearchIndexListener.indexContent / updateContent', () => {
  it('is a no-op when the content row cannot be found (transient — not an error)', async () => {
    const { listener, embeddingService, vectorService, logger } = makeListener(null);

    await listener.indexContent({ contentId: 'ghost' } as never);

    expect(embeddingService.upsert).not.toHaveBeenCalled();
    expect(vectorService.upsert).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('embeds and vectorizes substantive content, scoped to its owner', async () => {
    const { listener, embeddingService, vectorService } = makeListener({
      ...SUBSTANTIVE,
      userId: 'user-1',
    });

    await listener.updateContent({ contentId: 'content-1' } as never);

    expect(embeddingService.upsert).toHaveBeenCalledWith(
      { userId: 'user-1' },
      { entityType: 'content', entityId: 'content-1', embedding: [0.1, 0.2] },
    );
    expect(vectorService.upsert).toHaveBeenCalledWith(
      { userId: 'user-1' },
      expect.objectContaining({ entityType: 'content', entityId: 'content-1' }),
    );
  });

  it('skips both embedding and vectorization when there is no searchable content at all', async () => {
    const { listener, embeddingService, vectorService } = makeListener({
      id: 'content-2',
      userId: 'user-1',
      type: null,
      title: null,
      text: null,
      url: null,
      mimetype: null,
    });

    await listener.indexContent({ contentId: 'content-2' } as never);

    expect(embeddingService.upsert).not.toHaveBeenCalled();
    expect(vectorService.upsert).not.toHaveBeenCalled();
  });
});
