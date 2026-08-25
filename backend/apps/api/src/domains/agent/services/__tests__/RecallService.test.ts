import type { UserServiceContext } from '@ci/common/context';
import type { LoggerService } from '@ci/common/logging';
import type { EntityResolutionService } from '@ci/domains/entity-resolution';
import type { GraphExpansionService } from '@ci/domains/graph';
import type { SearchService } from '@ci/domains/search-next';

import type { AgentMemoryService } from '../AgentMemoryService';
import { RecallService } from '../RecallService';
import type { SerializerService } from '../SerializerService';

const CONTEXT = { userId: 'user-1' } as unknown as UserServiceContext;

type Hit = { type: string; id: string };

function build(
  overrides: {
    search?: jest.Mock;
    searchAnchored?: jest.Mock;
    serialize?: jest.Mock;
  } = {},
) {
  const search = overrides.search ?? jest.fn().mockResolvedValue([]);
  const searchAnchored = overrides.searchAnchored ?? jest.fn().mockResolvedValue([]);
  const searchMessages = jest.fn().mockResolvedValue([]);

  const searchService = { search, searchAnchored, searchMessages } as unknown as SearchService;

  // Resolution is identity here: every hit resolves, and the serializer prints
  // the id, so the assertions are about WHICH rows reached the block and in what
  // order — the only thing this service decides.
  const entityResolution = {
    resolve: jest
      .fn()
      .mockImplementation((_ctx: unknown, hits: Hit[]) =>
        Promise.resolve(new Map(hits.map((hit) => [`${hit.type}:${hit.id}`, hit]))),
      ),
  } as unknown as EntityResolutionService;

  const serializer = {
    serialize: overrides.serialize ?? jest.fn().mockImplementation((hit: Hit) => hit.id),
  } as unknown as SerializerService;

  const graphExpansion = { expand: jest.fn().mockResolvedValue([]) } as unknown as GraphExpansionService;
  const agentMemory = { findByIds: jest.fn().mockResolvedValue([]) } as unknown as AgentMemoryService;
  const logger = { setContext() {}, warn() {}, log() {} } as unknown as LoggerService;

  const service = new RecallService(
    searchService,
    entityResolution,
    serializer,
    graphExpansion,
    agentMemory,
    logger,
  );

  return { service, search, searchAnchored };
}

describe('RecallService.recall — default strategy is untouched', () => {
  it('still seeds with the boosted mode and never calls the anchored channel', async () => {
    // PersonaContextPackService, TaskBreakdownService and BranchialForecastService
    // all pass no options. Their retrieval must be byte-for-byte what it was.
    const search = jest.fn().mockResolvedValue([{ type: 'person', id: 'p1' }]);
    const { service, searchAnchored } = build({ search });

    await service.recall(CONTEXT, { query: 'where does Jordan live', maxResults: 5 });

    expect(search).toHaveBeenCalledWith(
      CONTEXT,
      expect.objectContaining({ mode: 'boosted', excludeTypes: ['message'] }),
    );
    expect(searchAnchored).not.toHaveBeenCalled();
  });

  it('still falls back to semantic only when the boosted seed is empty', async () => {
    const search = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ type: 'person', id: 'p1' }]);
    const { service } = build({ search });

    await service.recall(CONTEXT, { query: 'where does Jordan live', maxResults: 5 });

    expect(search).toHaveBeenCalledTimes(2);
    expect(search.mock.calls[1][1]).toEqual(expect.objectContaining({ mode: 'semantic' }));
  });

  it('keeps duplicate lines, which is what its callers’ prompts were sized against', async () => {
    const search = jest.fn().mockResolvedValue([
      { type: 'communication', id: 'c-1' },
      { type: 'communication', id: 'c-2' },
    ]);
    const { service } = build({ search, serialize: jest.fn().mockReturnValue('Where do you live?') });

    const result = await service.recall(CONTEXT, { query: 'where do I live', maxResults: 5 });

    expect(result.resultCount).toBe(2);
  });
});

describe('RecallService.recall — the grounded strategy', () => {
  const GROUNDED = { strategy: 'grounded' as const };

  it('runs both channels and never runs the boosted seed', async () => {
    const { service, search, searchAnchored } = build();

    await service.recall(CONTEXT, { query: 'What sports do you follow?', maxResults: 8 }, GROUNDED);

    expect(searchAnchored).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledTimes(1);
    expect(search.mock.calls[0][1]).toEqual(expect.objectContaining({ mode: 'semantic' }));
  });

  it('holds the semantic channel to a tighter similarity bar than plain search', async () => {
    // 0.5 similarity — search's default — is what let "Much more to follow."
    // answer "What sports do you follow?".
    const { service, search } = build();

    await service.recall(CONTEXT, { query: 'What sports do you follow?', maxResults: 8 }, GROUNDED);

    const options = search.mock.calls[0][1] as { distanceThreshold: number };
    expect(options.distanceThreshold).toBeCloseTo(0.3);
  });

  it('cuts the anchored channel deeper than the semantic one', async () => {
    const { service, search, searchAnchored } = build();

    await service.recall(CONTEXT, { query: 'What is your favorite cuisine?', maxResults: 8 }, GROUNDED);

    const anchoredMax = (searchAnchored.mock.calls[0][2] as { maxResults: number }).maxResults;
    const semanticMax = (search.mock.calls[0][1] as { maxResults: number }).maxResults;

    expect(semanticMax).toBe(8);
    expect(anchoredMax).toBeGreaterThan(semanticMax);
  });

  it('sends the RAW question to both channels, not the punctuation-stripped one', async () => {
    // The anchored channel picks lexemes from the sentence AND embeds it; the
    // semantic channel embeds it. Natural language embeds better than a bag of
    // lower-cased words.
    const { service, search, searchAnchored } = build();

    await service.recall(CONTEXT, { query: 'What is your favorite cuisine?', maxResults: 8 }, GROUNDED);

    expect(searchAnchored.mock.calls[0][1]).toBe('What is your favorite cuisine?');
    expect(search.mock.calls[0][1]).toEqual(
      expect.objectContaining({ query: 'What is your favorite cuisine?' }),
    );
  });

  it('puts the anchored (behavioural) lines ahead of the semantic ones', async () => {
    const { service } = build({
      searchAnchored: jest.fn().mockResolvedValue([{ type: 'browser-activity', id: 'choya' }]),
      search: jest.fn().mockResolvedValue([{ type: 'communication', id: 'favourite-food' }]),
    });

    const result = await service.recall(
      CONTEXT,
      { query: 'What is your favorite cuisine?', maxResults: 8 },
      GROUNDED,
    );

    expect(result.block).toContain('choya\nfavourite-food');
  });

  it('unions the two channels without repeating a row they both returned', async () => {
    const shared = { type: 'communication', id: 'shared' };
    const { service } = build({
      searchAnchored: jest.fn().mockResolvedValue([shared, { type: 'communication', id: 'a-only' }]),
      search: jest.fn().mockResolvedValue([shared, { type: 'communication', id: 's-only' }]),
    });

    const result = await service.recall(CONTEXT, { query: 'q', maxResults: 8 }, GROUNDED);

    expect(result.resultCount).toBe(3);
  });

  it('collapses identical text from DISTINCT rows — six plays of one song are one line', async () => {
    // Distinct ids, so the id-level union cannot be what collapses them. Six
    // rows that serialise the same way are one piece of evidence, and left
    // alone they spend the whole block saying it.
    const { service } = build({
      searchAnchored: jest.fn().mockResolvedValue([
        { type: 'event', id: 'play-1' },
        { type: 'event', id: 'play-2' },
        { type: 'event', id: 'play-3' },
      ]),
      serialize: jest.fn().mockReturnValue('I Follow Rivers — Lykke Li'),
    });

    const result = await service.recall(CONTEXT, { query: 'q', maxResults: 8 }, GROUNDED);

    expect(result.resultCount).toBe(1);
  });

  it('returns nothing rather than retrying loose when both channels come back empty', async () => {
    // The floors ARE the answer. A question this corpus cannot support has to
    // read as unsupported, not get a second, looser pass that finds noise.
    const { service, search, searchAnchored } = build();

    const result = await service.recall(CONTEXT, { query: 'What city do you live in?' }, GROUNDED);

    expect(result).toEqual({ block: '', resultCount: 0 });
    expect(searchAnchored).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('passes the caller’s extra type exclusions through alongside message', async () => {
    const { service, search, searchAnchored } = build();

    await service.recall(
      CONTEXT,
      { query: 'q', maxResults: 8 },
      { strategy: 'grounded', excludeTypes: ['answer'] },
    );

    expect(searchAnchored.mock.calls[0][2]).toEqual(
      expect.objectContaining({ excludeTypes: ['message', 'answer'] }),
    );
    expect(search.mock.calls[0][1]).toEqual(expect.objectContaining({ excludeTypes: ['message', 'answer'] }));
  });
});
