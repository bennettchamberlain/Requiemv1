import { type UserServiceContext } from '@ci/common/context';

import { SavedSearchService } from '../SavedSearchService';

/**
 * Renaming a tag has to drag the saved searches along with it: they filter by
 * tag LABEL, not by tag id, so a rename that only touched `ci_search.tags`
 * would leave them quietly matching nothing.
 *
 * The label lives in two places on a saved search — the `tags` array and any
 * `#label` inside `query` — and `assembleTags` re-derives the array from the
 * query on every save, so both have to move together or the stale label comes
 * back on the user's next edit.
 *
 * Repository is an in-memory jest mock, same pattern as SavedSearchService.test.ts.
 */

type Row = { id: string; tags: string[] | null; query: string | null };

function makeService(rows: Row[]) {
  const repo = {
    find: jest.fn(async () => rows),
    save: jest.fn(async (saved: Row[]) => saved),
  };
  const eventService = { send: jest.fn() };

  return {
    service: new SavedSearchService(repo as never, eventService as never),
    repo,
    eventService,
    rows,
  };
}

const ownerCtx = { userId: 'owner-1' } as UserServiceContext;

describe('SavedSearchService.replaceTagLabel', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rewrites the label in the tags array', async () => {
    const { service, repo, rows } = makeService([{ id: 's1', tags: ['holiday', 'food'], query: '' }]);

    expect(await service.replaceTagLabel(ownerCtx, 'holiday', 'vacation')).toBe(1);
    expect(rows[0].tags).toEqual(['vacation', 'food']);
    expect(repo.save).toHaveBeenCalledWith([rows[0]]);
  });

  it('rewrites the hashtag in the query text too', async () => {
    const { service, rows } = makeService([{ id: 's1', tags: ['holiday'], query: 'beach #holiday' }]);

    await service.replaceTagLabel(ownerCtx, 'holiday', 'vacation');

    expect(rows[0].query).toBe('beach #vacation');
    expect(rows[0].tags).toEqual(['vacation']);
  });

  it('matches a hashtag case-insensitively, since the label itself is lower case', async () => {
    const { service, rows } = makeService([{ id: 's1', tags: [], query: '#Holiday plans' }]);

    await service.replaceTagLabel(ownerCtx, 'holiday', 'vacation');

    expect(rows[0].query).toBe('#vacation plans');
  });

  it('does not rewrite a longer hashtag that merely starts with the label', async () => {
    // TAG_REGEX treats `-` as part of a label, so `#holiday-2024` is its own tag.
    const { service, rows } = makeService([{ id: 's1', tags: [], query: '#holiday-2024 #holidays' }]);

    expect(await service.replaceTagLabel(ownerCtx, 'holiday', 'vacation')).toBe(0);
    expect(rows[0].query).toBe('#holiday-2024 #holidays');
  });

  it('collapses the rename into an existing entry rather than duplicating it', async () => {
    const { service, rows } = makeService([{ id: 's1', tags: ['holiday', 'vacation'], query: '' }]);

    await service.replaceTagLabel(ownerCtx, 'holiday', 'vacation');

    expect(rows[0].tags).toEqual(['vacation']);
  });

  it('leaves unrelated saved searches alone and does not save them', async () => {
    const { service, repo, rows } = makeService([
      { id: 's1', tags: ['holiday'], query: '' },
      { id: 's2', tags: ['work'], query: 'standup' },
    ]);

    expect(await service.replaceTagLabel(ownerCtx, 'holiday', 'vacation')).toBe(1);
    expect(repo.save).toHaveBeenCalledWith([rows[0]]);
  });

  it('touches nothing when no saved search mentions the label', async () => {
    const { service, repo, eventService } = makeService([{ id: 's1', tags: ['work'], query: 'standup' }]);

    expect(await service.replaceTagLabel(ownerCtx, 'holiday', 'vacation')).toBe(0);
    expect(repo.save).not.toHaveBeenCalled();
    expect(eventService.send).not.toHaveBeenCalled();
  });

  it('short-circuits when the label did not actually change', async () => {
    const { service, repo } = makeService([{ id: 's1', tags: ['holiday'], query: '' }]);

    expect(await service.replaceTagLabel(ownerCtx, 'holiday', 'holiday')).toBe(0);
    expect(repo.find).not.toHaveBeenCalled();
  });

  it("reads only the caller's own saved searches", async () => {
    const { service, repo } = makeService([{ id: 's1', tags: ['holiday'], query: '' }]);

    await service.replaceTagLabel(ownerCtx, 'holiday', 'vacation');

    expect(repo.find).toHaveBeenCalledWith({ where: { userId: 'owner-1' } });
  });

  it('announces each changed saved search', async () => {
    const { service, eventService } = makeService([
      { id: 's1', tags: ['holiday'], query: '' },
      { id: 's2', tags: null, query: '#holiday' },
    ]);

    await service.replaceTagLabel(ownerCtx, 'holiday', 'vacation');

    expect(eventService.send).toHaveBeenCalledTimes(2);
    expect(eventService.send.mock.calls.map(([, payload]) => payload)).toEqual([
      { savedSearchId: 's1' },
      { savedSearchId: 's2' },
    ]);
  });
});
