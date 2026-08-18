import { FileChunkSearchIndexListener } from '../FileChunkSearchIndexListener';

function makeListener(chunks: Record<string, unknown>[]) {
  const chunkService = { findByIds: jest.fn().mockResolvedValue(chunks) };
  const embeddingGenerationService = { generateEmbedding: jest.fn().mockResolvedValue([0.1, 0.2]) };
  const embeddingService = { upsert: jest.fn().mockResolvedValue(null) };
  const vectorService = { upsert: jest.fn().mockResolvedValue(null) };
  const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() };

  const listener = new FileChunkSearchIndexListener(
    chunkService as never,
    embeddingGenerationService as never,
    embeddingService as never,
    vectorService as never,
    logger as never,
  );

  return { listener, chunkService, embeddingGenerationService, embeddingService, vectorService, logger };
}

function chunk(overrides: Record<string, unknown> = {}) {
  return {
    id: 'chunk-1',
    userId: 'user-1',
    fileId: 'file-1',
    sectionTitle: null,
    content: 'Some chunk text.',
    ...overrides,
  };
}

describe('FileChunkSearchIndexListener.indexChunks', () => {
  it('looks up every chunk id from the payload and indexes each one, scoped to its own user', async () => {
    const { listener, chunkService, embeddingService, vectorService } = makeListener([
      chunk({ id: 'c1', userId: 'user-1', content: 'First chunk of text.' }),
      chunk({ id: 'c2', userId: 'user-2', content: 'Second chunk of text.' }),
    ]);

    await listener.indexChunks({ fileId: 'file-1', chunkIds: ['c1', 'c2'] } as never);

    expect(chunkService.findByIds).toHaveBeenCalledWith(['c1', 'c2']);
    expect(embeddingService.upsert).toHaveBeenCalledWith(
      { userId: 'user-1' },
      expect.objectContaining({ entityType: 'file-chunk', entityId: 'c1' }),
    );
    expect(embeddingService.upsert).toHaveBeenCalledWith(
      { userId: 'user-2' },
      expect.objectContaining({ entityType: 'file-chunk', entityId: 'c2' }),
    );
    expect(vectorService.upsert).toHaveBeenCalledTimes(2);
  });

  it('weights an available sectionTitle above the chunk content', async () => {
    const { listener, vectorService } = makeListener([
      chunk({ sectionTitle: 'Introduction', content: 'The chunk body.' }),
    ]);

    await listener.indexChunks({ fileId: 'file-1', chunkIds: ['chunk-1'] } as never);

    expect(vectorService.upsert).toHaveBeenCalledWith(
      { userId: 'user-1' },
      expect.objectContaining({
        searchableText: [
          { text: 'Introduction', weight: 8 },
          { text: 'The chunk body.', weight: 3 },
        ],
      }),
    );
  });

  it('omits the sectionTitle entry when the chunk has none', async () => {
    const { listener, vectorService } = makeListener([chunk({ sectionTitle: null, content: 'Body only.' })]);

    await listener.indexChunks({ fileId: 'file-1', chunkIds: ['chunk-1'] } as never);

    expect(vectorService.upsert).toHaveBeenCalledWith(
      { userId: 'user-1' },
      expect.objectContaining({ searchableText: [{ text: 'Body only.', weight: 3 }] }),
    );
  });

  // The whole point of the per-chunk try/catch: a single bad chunk (a failed
  // embedding call, a malformed row) must not abort the rest of the document's
  // chunks. Losing this would turn one flaky embed into a fully unindexed file.
  it('continues indexing the remaining chunks when ONE chunk fails to embed', async () => {
    const { listener, embeddingGenerationService, embeddingService, vectorService, logger } = makeListener([
      chunk({ id: 'c1', content: 'Good chunk one.' }),
      chunk({ id: 'c2', content: 'Bad chunk.' }),
      chunk({ id: 'c3', content: 'Good chunk three.' }),
    ]);
    embeddingGenerationService.generateEmbedding
      .mockResolvedValueOnce([0.1])
      .mockRejectedValueOnce(new Error('embedding service unavailable'))
      .mockResolvedValueOnce([0.3]);

    await listener.indexChunks({ fileId: 'file-1', chunkIds: ['c1', 'c2', 'c3'] } as never);

    expect(embeddingService.upsert).toHaveBeenCalledTimes(2); // c1 and c3 only
    expect(embeddingService.upsert).toHaveBeenCalledWith(
      { userId: 'user-1' },
      expect.objectContaining({ entityId: 'c1' }),
    );
    expect(embeddingService.upsert).toHaveBeenCalledWith(
      { userId: 'user-1' },
      expect.objectContaining({ entityId: 'c3' }),
    );
    // The failed chunk's vector write is also skipped — it throws before reaching it.
    expect(vectorService.upsert).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to index chunk, continuing',
      expect.objectContaining({ chunkId: 'c2', error: 'embedding service unavailable' }),
    );
  });

  it('is a no-op with no chunks found for the payload ids', async () => {
    const { listener, embeddingService, vectorService } = makeListener([]);

    await listener.indexChunks({ fileId: 'file-1', chunkIds: ['missing'] } as never);

    expect(embeddingService.upsert).not.toHaveBeenCalled();
    expect(vectorService.upsert).not.toHaveBeenCalled();
  });
});
