import { type Person } from '@ci/domains/memory';

import { PersonSearchIndexListener } from '../PersonSearchIndexListener';

/**
 * Locks in the person skip-marker contract that makes the person backfill sweep
 * converge: an unembeddable person (no search document) records a
 * ci_search.index_skips marker instead of being silently dropped — otherwise
 * every sweep re-enqueues it forever — and a successful embed clears any stale
 * marker. Persons only skip on 'empty': the message-tuned too-short/trivial
 * heuristics must NOT apply, because a bare short name ("Josh") is exactly what
 * a person document looks like.
 */
function makeListener(person: Partial<Person> | null) {
  const personService = { findById: jest.fn(async () => person as Person | null) };
  const embeddingGenerationService = { generateEmbedding: jest.fn(async () => [0.1, 0.2]) };
  const embeddingService = { upsert: jest.fn(async () => undefined), remove: jest.fn(async () => undefined) };
  const indexSkipService = {
    recordSkip: jest.fn(async () => undefined),
    clearSkip: jest.fn(async () => undefined),
  };
  const vectorService = { upsert: jest.fn(async () => undefined), remove: jest.fn(async () => undefined) };
  const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() };

  const listener = new PersonSearchIndexListener(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    personService as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    embeddingGenerationService as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    embeddingService as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    indexSkipService as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vectorService as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    logger as any,
  );

  return { listener, embeddingService, indexSkipService };
}

describe('PersonSearchIndexListener skip markers', () => {
  it('records an index_skips marker when the person has no search document', async () => {
    const { listener, embeddingService, indexSkipService } = makeListener({
      id: 'p1',
      userId: 'u1',
      name: null,
      description: null,
      properties: undefined,
    });

    await listener.indexPerson({ personId: 'p1' });

    expect(embeddingService.upsert).not.toHaveBeenCalled();
    expect(indexSkipService.recordSkip).toHaveBeenCalledWith({
      entityType: 'person',
      entityId: 'p1',
      reason: 'empty',
    });
  });

  it('embeds a person with just a short name (no too-short/trivial skip) and clears any stale marker', async () => {
    const { listener, embeddingService, indexSkipService } = makeListener({
      id: 'p2',
      userId: 'u1',
      name: 'Josh',
      description: null,
      properties: undefined,
    });

    await listener.indexPerson({ personId: 'p2' });

    expect(indexSkipService.recordSkip).not.toHaveBeenCalled();
    expect(embeddingService.upsert).toHaveBeenCalledWith(
      { userId: 'u1' },
      expect.objectContaining({ entityType: 'person', entityId: 'p2' }),
    );
    expect(indexSkipService.clearSkip).toHaveBeenCalledWith({ entityType: 'person', entityId: 'p2' });
  });

  it('does not mark a person that simply was not found (row-level issue, not a content skip)', async () => {
    const { listener, embeddingService, indexSkipService } = makeListener(null);

    await listener.indexPerson({ personId: 'missing' });

    expect(embeddingService.upsert).not.toHaveBeenCalled();
    expect(indexSkipService.recordSkip).not.toHaveBeenCalled();
  });
});
