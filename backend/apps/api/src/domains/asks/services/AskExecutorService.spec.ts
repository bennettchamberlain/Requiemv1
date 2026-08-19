import { type Ask } from '../entities/AskEntity';

import { AskExecutorService } from './AskExecutorService';

function fakeAsk(overrides: Partial<Ask> = {}): Ask {
  return {
    id: 'ask-1',
    askerUserId: 'asker-1',
    responderUserId: 'responder-1',
    query: { queryType: 'photos', prompt: 'beach photos?' },
    status: 'answering',
    consentBasis: null,
    createdAt: new Date('2026-07-15T00:00:00Z'),
    updatedAt: new Date('2026-07-15T00:00:00Z'),
    expiresAt: null,
    ...overrides,
  } as Ask;
}

function makeService() {
  const searchService = { search: jest.fn().mockResolvedValue([{ id: 'e1', type: 'file' }]) };
  const logger = { setContext: jest.fn() };
  const service = new AskExecutorService(searchService as never, logger as never);

  return { service, searchService };
}

describe('AskExecutorService.execute', () => {
  it('runs the query in the RESPONDER scope in keyword mode', async () => {
    const { service, searchService } = makeService();

    const result = await service.execute(fakeAsk({ query: { queryType: 'x', prompt: 'ramen place' } }));

    expect(searchService.search).toHaveBeenCalledWith(
      { userId: 'responder-1' }, // run-as-owner: the responder, never the asker
      { query: 'ramen place', mode: 'keyword', maxResults: 50 },
    );
    expect(result).toEqual([{ id: 'e1', type: 'file' }]);
  });

  it('maps a known data class to entity-type filters', async () => {
    const { service, searchService } = makeService();

    await service.execute(fakeAsk({ query: { queryType: 'x', dataClass: 'photos', prompt: 'lake' } }));

    expect(searchService.search).toHaveBeenCalledWith(
      { userId: 'responder-1' },
      { query: 'lake', mode: 'keyword', maxResults: 50, includeTypes: ['file'] },
    );
  });

  it('leaves an unknown data class unfiltered (still responder-scoped)', async () => {
    const { service, searchService } = makeService();

    await service.execute(fakeAsk({ query: { queryType: 'x', dataClass: 'nonsense', prompt: 'q' } }));

    expect(searchService.search).toHaveBeenCalledWith(
      { userId: 'responder-1' },
      { query: 'q', mode: 'keyword', maxResults: 50 },
    );
  });
});
