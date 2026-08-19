import type { DataSource } from 'typeorm';

import { type UserServiceContext } from '@ci/common/context';
import type { EmbeddingGenerationService } from '@ci/common/embeddings';

import { SearchService } from '../SearchService';

/**
 * `search()` is the actual public entry point every caller goes through —
 * SearchResolver, MCP tools, RecallService. It has zero direct coverage: the
 * only existing spec (SearchService.searchMessages.test.ts) exercises the
 * separate naive-RAG message channel, not this dispatcher. These pin the
 * mode-selection contract (`autoSearch`'s word-count/special-char heuristic)
 * and the default type-exclusion behind it, using a stubbed DataSource so no
 * Postgres is required — the SQL/tenancy half of SearchService lives in
 * SearchService.scoping.integration.spec.ts against a real one.
 */
const CONTEXT = { userId: 'user-1' } as unknown as UserServiceContext;

function makeService() {
  const query = jest.fn().mockResolvedValue([]);
  const dataSource = { query } as unknown as DataSource;
  const embeddingGenerationService = {
    generateEmbeddingString: jest.fn().mockResolvedValue('[0.1,0.2]'),
  } as unknown as EmbeddingGenerationService;

  const service = new SearchService(dataSource, embeddingGenerationService);

  return { service, query, embeddingGenerationService };
}

describe('SearchService.search — mode dispatch', () => {
  it('an explicit mode is honored verbatim, bypassing auto-detection', async () => {
    const { service, embeddingGenerationService } = makeService();

    // 'urgent' is a single word — autoSearch would route this to keyword
    // (no embedding call). An explicit 'semantic' must still call the
    // embedding service; the mode argument overrides the heuristic entirely.
    await service.search(CONTEXT, { query: 'urgent', mode: 'semantic' });

    expect(embeddingGenerationService.generateEmbeddingString).toHaveBeenCalledTimes(1);
  });

  it('auto: a short query (<=3 words) routes to keyword — no embedding call', async () => {
    const { service, embeddingGenerationService } = makeService();

    await service.search(CONTEXT, { query: 'dog breed info' });

    expect(embeddingGenerationService.generateEmbeddingString).not.toHaveBeenCalled();
  });

  it('auto: special characters route to keyword regardless of word count', async () => {
    const { service, embeddingGenerationService } = makeService();

    // An email-shaped query is exactly the case the heuristic calls out
    // (IDs/emails) — must stay fast (keyword-only), not spend an embedding
    // call, even though the surrounding sentence has 4+ words.
    await service.search(CONTEXT, { query: 'notes about jane.smith@example.com account' });

    expect(embeddingGenerationService.generateEmbeddingString).not.toHaveBeenCalled();
  });

  it('auto: a medium query (4-7 words, no special chars) routes to boosted keyword', async () => {
    const { service, query, embeddingGenerationService } = makeService();

    await service.search(CONTEXT, { query: 'where does Jordan currently live' });

    expect(embeddingGenerationService.generateEmbeddingString).toHaveBeenCalledTimes(1);
    // boostedKeywordSearch's distinguishing shape: it joins ci_search.vectors
    // AND ci_search.embeddings (semanticSearch touches only embeddings).
    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/ci_search\.vectors/);
    expect(sql).toMatch(/ci_search\.embeddings/);
  });

  it('auto: a long natural-language query (>=8 words) routes to semantic only', async () => {
    const { service, query, embeddingGenerationService } = makeService();

    await service.search(CONTEXT, {
      query: 'can you tell me approximately where I was living around this time last year',
    });

    expect(embeddingGenerationService.generateEmbeddingString).toHaveBeenCalledTimes(1);
    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/ci_search\.embeddings/);
    expect(sql).not.toMatch(/ci_search\.vectors/);
  });

  it('defaults exclude message and position types when the caller specifies neither', async () => {
    const { service, query } = makeService();

    await service.search(CONTEXT, { query: 'short query' }); // keyword path

    const [, params] = query.mock.calls[0] as [string, unknown[]];
    // buildTypeFilter's exclude-list param is appended last for keywordSearch.
    expect(params[params.length - 1]).toEqual(['message', 'position']);
  });

  it('an explicit includeTypes is never overridden by the default exclusion', async () => {
    const { service, query } = makeService();

    await service.search(CONTEXT, { query: 'short query', includeTypes: ['person'] });

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/entity_type = ANY/);
    expect(params[params.length - 1]).toEqual(['person']);
  });

  it('search() strips scores off the result before returning to callers', async () => {
    const { service, query } = makeService();
    query.mockResolvedValue([{ entity_id: 'e1', entity_type: 'person', score: '0.9' }]);

    const results = await service.search(CONTEXT, { query: 'short query' });

    expect(results).toEqual([{ id: 'e1', type: 'person' }]);
    expect(results[0]).not.toHaveProperty('score');
  });
});
