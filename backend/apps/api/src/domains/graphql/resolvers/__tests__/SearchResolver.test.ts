import { type RequestContext } from '@ci/common/context';

import { type SearchInput } from '../../types/SearchInput';
import { SearchResolver } from '../SearchResolver';

const ctx = { userId: 'user-1' } as unknown as RequestContext;

type Identifier = { type: string; id: string };
type Entry = { type: string; id: string; entity: Record<string, unknown> };

function makeResolver() {
  const searchService = { search: jest.fn().mockResolvedValue([] as Identifier[]) };
  const tagService = {
    getEntitiesForTags: jest.fn().mockResolvedValue([] as Identifier[]),
    searchByLabel: jest.fn().mockResolvedValue([]),
  };
  const eventService = { getEntitiesForEvents: jest.fn().mockResolvedValue([] as Identifier[]) };
  const browserActivityService = {
    getEntitiesForBrowserActivities: jest.fn().mockResolvedValue([] as Identifier[]),
  };
  const communicationService = {
    getEntitiesForCommunications: jest.fn().mockResolvedValue([] as Identifier[]),
  };
  const conceptService = { getEntitiesForConcepts: jest.fn().mockResolvedValue([] as Identifier[]) };
  const contentService = { getEntitiesForContents: jest.fn().mockResolvedValue([] as Identifier[]) };
  const itemService = { getEntitiesForItems: jest.fn().mockResolvedValue([] as Identifier[]) };
  const noteService = { getEntitiesForNotes: jest.fn().mockResolvedValue([] as Identifier[]) };
  const personService = { getEntitiesForPeople: jest.fn().mockResolvedValue([] as Identifier[]) };
  const placeService = { getEntitiesForPlaces: jest.fn().mockResolvedValue([] as Identifier[]) };
  const answerService = { getEntitiesForAnswers: jest.fn().mockResolvedValue([] as Identifier[]) };
  const entityResolutionService = { resolve: jest.fn().mockResolvedValue(new Map<string, Entry>()) };
  const savedSearchService = { findByShareToken: jest.fn().mockResolvedValue(null) };

  const fileService = { getEntitiesForFiles: jest.fn().mockResolvedValue([]) };
  const fileChunkService = { getEntitiesForFileChunks: jest.fn().mockResolvedValue([]) };
  const resolver = new SearchResolver(
    browserActivityService as never,
    communicationService as never,
    conceptService as never,
    contentService as never,
    entityResolutionService as never,
    eventService as never,
    fileService as never,
    fileChunkService as never,
    itemService as never,
    noteService as never,
    personService as never,
    placeService as never,
    answerService as never,
    savedSearchService as never,
    searchService as never,
    tagService as never,
    { isFeatureEnabled: jest.fn().mockResolvedValue(true) } as never,
  );

  // Bypass the real GraphQL type mappers; the unit under test is the filter/sort composition.
  jest
    .spyOn(resolver as unknown as { toSearchResult: (entry: Entry) => unknown }, 'toSearchResult')
    .mockImplementation((entry: Entry) => ({ id: `${entry.type}:${entry.id}`, type: entry.type }));

  return {
    resolver,
    searchService,
    tagService,
    eventService,
    browserActivityService,
    communicationService,
    entityResolutionService,
    fileService,
    fileChunkService,
  };
}

function resolveMap(entries: Entry[]): Map<string, Entry> {
  const map = new Map<string, Entry>();
  for (const entry of entries) {
    map.set(`${entry.type}:${entry.id}`, entry);
  }

  return map;
}

const idsResolvedTo = (mock: jest.Mock): Identifier[] => mock.mock.calls[0][1] as Identifier[];
const nodeIds = (connection: { edges: { node: { id: string } }[] }) =>
  connection.edges.map((edge) => edge.node.id);

describe('SearchResolver.search — combinable filters', () => {
  beforeEach(() => jest.clearAllMocks());

  it('ANDs query and tags (intersect candidates by raw type:id before resolving)', async () => {
    const { resolver, searchService, tagService, entityResolutionService } = makeResolver();
    searchService.search.mockResolvedValue([
      { type: 'content', id: 'c1' },
      { type: 'event', id: 'e1' },
      { type: 'note', id: 'n1' },
    ]);
    tagService.getEntitiesForTags.mockResolvedValue([
      { type: 'event', id: 'e1' },
      { type: 'person', id: 'p9' },
    ]);

    await resolver.search(ctx, { query: 'hi', tags: ['t'] } as SearchInput);

    expect(idsResolvedTo(entityResolutionService.resolve)).toEqual([{ type: 'event', id: 'e1' }]);
  });

  it('ANDs tags and entity types', async () => {
    const { resolver, tagService, entityResolutionService } = makeResolver();
    tagService.getEntitiesForTags.mockResolvedValue([
      { type: 'event', id: 'e1' },
      { type: 'note', id: 'n1' },
      { type: 'person', id: 'p1' },
    ]);

    await resolver.search(ctx, { tags: ['t'], includeTypes: ['note', 'person'] } as SearchInput);

    expect(idsResolvedTo(entityResolutionService.resolve)).toEqual([
      { type: 'note', id: 'n1' },
      { type: 'person', id: 'p1' },
    ]);
  });

  it('ANDs a date range onto a query, dropping out-of-range and timestamp-less entities', async () => {
    const { resolver, searchService, entityResolutionService } = makeResolver();
    searchService.search.mockResolvedValue([
      { type: 'event', id: 'e1' },
      { type: 'note', id: 'n2' },
      { type: 'event', id: 'e3' },
    ]);
    entityResolutionService.resolve.mockResolvedValue(
      resolveMap([
        { type: 'event', id: 'e1', entity: { startTime: new Date('2026-01-15') } },
        { type: 'note', id: 'n2', entity: {} },
        { type: 'event', id: 'e3', entity: { startTime: new Date('2026-03-20') } },
      ]),
    );

    const result = await resolver.search(ctx, {
      query: 'hi',
      startTime: '2026-02-01',
      endTime: '2026-04-01',
    } as SearchInput);

    expect(nodeIds(result)).toEqual(['event:e3']);
    expect(result.totalCount).toBe(1);
  });

  it('sorts by time ascending and descending', async () => {
    const entries: Entry[] = [
      { type: 'event', id: 'old', entity: { startTime: new Date('2026-01-01') } },
      { type: 'event', id: 'new', entity: { startTime: new Date('2026-05-01') } },
    ];

    const asc = makeResolver();
    asc.searchService.search.mockResolvedValue(entries.map(({ type, id }) => ({ type, id })));
    asc.entityResolutionService.resolve.mockResolvedValue(resolveMap(entries));
    const ascResult = await asc.resolver.search(ctx, {
      query: 'hi',
      sortBy: 'time',
      sortOrder: 'asc',
    } as SearchInput);
    expect(nodeIds(ascResult)).toEqual(['event:old', 'event:new']);

    const desc = makeResolver();
    desc.searchService.search.mockResolvedValue(entries.map(({ type, id }) => ({ type, id })));
    desc.entityResolutionService.resolve.mockResolvedValue(resolveMap(entries));
    const descResult = await desc.resolver.search(ctx, {
      query: 'hi',
      sortBy: 'time',
      sortOrder: 'desc',
    } as SearchInput);
    expect(nodeIds(descResult)).toEqual(['event:new', 'event:old']);
  });

  it('falls back to recent timed entities when no filter signal is provided', async () => {
    const { resolver, eventService, browserActivityService, communicationService, fileService } =
      makeResolver();

    await resolver.search(ctx, {} as SearchInput);

    expect(eventService.getEntitiesForEvents).toHaveBeenCalledTimes(1);
    expect(browserActivityService.getEntitiesForBrowserActivities).toHaveBeenCalledTimes(1);
    expect(communicationService.getEntitiesForCommunications).toHaveBeenCalledTimes(1);
    // Files stay out of the default browse (documents/screenshots would bury it).
    expect(fileService.getEntitiesForFiles).not.toHaveBeenCalled();
    // No filters -> end bound to "now" so recent items are returned, not all history.
    const eventOptions = eventService.getEntitiesForEvents.mock.calls[0][1] as { endTime?: Date };
    expect(eventOptions.endTime).toBeInstanceOf(Date);
  });

  // Regression: the gallery showed no images because standalone media files
  // (e.g. Capture screenshots with no linked event) were opted out of the
  // query-less browse and the gallery had no way to pull them in without
  // narrowing the whole result to files (includeTypes: ['file']).
  describe('includeFiles (gallery browse)', () => {
    it('interleaves files with the other timed types instead of replacing them', async () => {
      const { resolver, eventService, fileService, fileChunkService, entityResolutionService } =
        makeResolver();
      eventService.getEntitiesForEvents.mockResolvedValue([{ type: 'event', id: 'e1' }]);
      fileService.getEntitiesForFiles.mockResolvedValue([{ type: 'file', id: 'f1' }]);

      await resolver.search(ctx, { includeFiles: true } as SearchInput);

      expect(eventService.getEntitiesForEvents).toHaveBeenCalledTimes(1);
      expect(fileService.getEntitiesForFiles).toHaveBeenCalledTimes(1);
      // File chunks stay includeTypes-only — a document's many same-timestamp
      // chunks would still bury the browse.
      expect(fileChunkService.getEntitiesForFileChunks).not.toHaveBeenCalled();
      expect(idsResolvedTo(entityResolutionService.resolve)).toEqual([
        { type: 'event', id: 'e1' },
        { type: 'file', id: 'f1' },
      ]);
    });

    it('still honours an explicit type filter that excludes files', async () => {
      const { resolver, fileService } = makeResolver();

      await resolver.search(ctx, { includeFiles: true, excludeTypes: ['file'] } as SearchInput);

      expect(fileService.getEntitiesForFiles).not.toHaveBeenCalled();
    });
  });
});
