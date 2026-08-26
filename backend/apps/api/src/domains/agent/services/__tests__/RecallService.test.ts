import type { UserServiceContext } from '@ci/common/context';
import type { LoggerService } from '@ci/common/logging';
import type { EntityResolutionService } from '@ci/domains/entity-resolution';
import type { GraphExpansionService } from '@ci/domains/graph';
import type { SearchService } from '@ci/domains/search-next';

import type { AgentMemoryService } from '../AgentMemoryService';
import { RecallService } from '../RecallService';
import type { SerializerService } from '../SerializerService';

const CONTEXT = { userId: 'user-1' } as unknown as UserServiceContext;

type Hit = { type: string; id: string; direction?: 'inbound' | 'outbound' };

function build(
  overrides: {
    search?: jest.Mock;
    searchAnchored?: jest.Mock;
    serialize?: jest.Mock;
    searchMessages?: jest.Mock;
    expand?: jest.Mock;
    findByIds?: jest.Mock;
  } = {},
) {
  const search = overrides.search ?? jest.fn().mockResolvedValue([]);
  const searchAnchored = overrides.searchAnchored ?? jest.fn().mockResolvedValue([]);
  const searchMessages = overrides.searchMessages ?? jest.fn().mockResolvedValue([]);

  const searchService = { search, searchAnchored, searchMessages } as unknown as SearchService;

  // Resolution is identity here: every hit resolves, and the serializer prints
  // the id, so the assertions are about WHICH rows reached the block and in what
  // order — the only thing this service decides.
  // `entity` is carried because RecallService reads `direction` off it to tag
  // each line's speaker; a hit that names no direction is an outbound message,
  // which is the pre-existing "the owner wrote it" default these tests assume.
  const entityResolution = {
    resolve: jest
      .fn()
      .mockImplementation((_ctx: unknown, hits: Hit[]) =>
        Promise.resolve(
          new Map(
            hits.map((hit) => [
              `${hit.type}:${hit.id}`,
              { ...hit, entity: { direction: hit.direction ?? 'outbound' } },
            ]),
          ),
        ),
      ),
  } as unknown as EntityResolutionService;

  const serializer = {
    serialize: overrides.serialize ?? jest.fn().mockImplementation((hit: Hit) => hit.id),
    // Identity here too: the real one reads the resolved entity's own timestamp
    // column per type, which is SerializerService's business, not this service's.
    // What RecallService is responsible for is CARRYING the reference onto every
    // line it emits, which is what the assertions below check.
    reference: jest.fn().mockImplementation((hit: Hit) => ({ type: hit.type, id: hit.id, at: null })),
  } as unknown as SerializerService;

  const graphExpansion = {
    expand: overrides.expand ?? jest.fn().mockResolvedValue([]),
  } as unknown as GraphExpansionService;
  const agentMemory = {
    findByIds: overrides.findByIds ?? jest.fn().mockResolvedValue([]),
  } as unknown as AgentMemoryService;
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

    expect(result).toEqual({ block: '', resultCount: 0, lines: [] });
    expect(searchAnchored).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('tags each line with WHO produced it — an inbound message is not the owner speaking', async () => {
    // `ci_search.vectors` carries no direction, so this is the only point in the
    // pipeline where the speaker is knowable. AnswerInferenceListener's speaker
    // gate is built entirely on these tags.
    const { service } = build({
      searchAnchored: jest.fn().mockResolvedValue([
        { type: 'communication', id: 'i-said-it', direction: 'outbound' },
        { type: 'communication', id: 'they-said-it', direction: 'inbound' },
        { type: 'browser-activity', id: 'a-page-i-opened' },
      ]),
    });

    const result = await service.recall(CONTEXT, { query: 'q', maxResults: 8 }, GROUNDED);

    expect(result.lines).toEqual([
      { text: 'i-said-it', voice: 'own', ref: { type: 'communication', id: 'i-said-it', at: null } },
      { text: 'they-said-it', voice: 'other', ref: { type: 'communication', id: 'they-said-it', at: null } },
      {
        text: 'a-page-i-opened',
        voice: 'own',
        ref: { type: 'browser-activity', id: 'a-page-i-opened', at: null },
      },
    ]);
  });

  it('names the row every line came out of, so a caller can cite it', async () => {
    // The point of the whole reference lane: a caller putting these lines in
    // front of a model as EVIDENCE has to be able to record WHICH ROW each one
    // was read out of, or the provenance it shows the owner is unfalsifiable.
    // The id has always been known here — it was thrown away one statement after
    // serialization.
    const { service } = build({
      searchAnchored: jest
        .fn()
        .mockResolvedValue([{ type: 'communication', id: 'comm-1', direction: 'outbound' }]),
    });

    const result = await service.recall(CONTEXT, { query: 'q', maxResults: 8 }, GROUNDED);

    // `{type, id}` is exactly EntityResolutionService.resolve's input shape, which
    // is what makes a stored citation resolvable back to the real row.
    expect(result.lines[0].ref).toEqual({ type: 'communication', id: 'comm-1', at: null });
  });

  it('leaves the prompt block byte-identical — the reference rides alongside it', async () => {
    // Every caller's prompt is built from `block`, and the answer-inference
    // prompt in particular has been tuned line by line. Adding provenance must
    // not move a single character of it.
    const { service } = build({
      searchAnchored: jest.fn().mockResolvedValue([
        { type: 'communication', id: 'one', direction: 'outbound' },
        { type: 'communication', id: 'two', direction: 'inbound' },
      ]),
    });

    const result = await service.recall(CONTEXT, { query: 'q', maxResults: 8 }, GROUNDED);

    expect(result.block).toBe('## Relevant context\none\ntwo');
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

describe('RecallService.recall — the two channels that bypass entity resolution', () => {
  const GROUNDED = { strategy: 'grounded' as const };

  // Neither of these goes through EntityResolutionService, so neither can name a
  // resolver type. They name their TABLE instead, which is where a click would
  // have to land anyway — and getting that wrong is invisible until somebody
  // opens a drawer on a citation and finds nothing behind it.

  it('names ci.entities for a graph-expansion neighbour', async () => {
    const { service } = build({
      searchAnchored: jest.fn().mockResolvedValue([{ type: 'person', id: 'seed-1', direction: 'outbound' }]),
      expand: jest
        .fn()
        .mockResolvedValue([{ entityId: 'entity-77', line: 'Priya Sharma — lives in Phoenix', score: 0.9 }]),
    });

    const result = await service.recall(CONTEXT, { query: 'where does Priya live', maxResults: 8 }, GROUNDED);

    expect(result.lines[1]).toEqual({
      text: 'Priya Sharma — lives in Phoenix',
      voice: 'own',
      // No timestamp: a graph node is a standing fact, not something that
      // happened at a moment, and stamping it with its import time would be a
      // date the drawer shows and the owner cannot account for.
      ref: { type: 'graph-node', id: 'entity-77', at: null },
    });
  });

  it('names ci.agent_memory for a raw message-channel fragment, with its own timestamp', async () => {
    const written = new Date('2024-05-01T10:00:00.000Z');
    const { service } = build({
      searchAnchored: jest.fn().mockResolvedValue([{ type: 'person', id: 'seed-1', direction: 'outbound' }]),
      searchMessages: jest.fn().mockResolvedValue([{ id: 'mem-3' }]),
      findByIds: jest.fn().mockResolvedValue([{ id: 'mem-3', content: 'a raw turn', createdAt: written }]),
    });

    const result = await service.recall(CONTEXT, { query: 'q', maxResults: 8 }, GROUNDED);

    expect(result.lines[1]).toEqual({
      text: 'a raw turn',
      voice: 'other',
      ref: { type: 'agent-memory', id: 'mem-3', at: '2024-05-01T10:00:00.000Z' },
    });
  });
});
