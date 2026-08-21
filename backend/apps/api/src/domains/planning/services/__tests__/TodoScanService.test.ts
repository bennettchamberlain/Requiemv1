import type { LoggerService } from '@ci/common/logging';
import type { OllamaService } from '@ci/domains/llm/services/OllamaService';
import type { PersonalizationService } from '@ci/domains/personalization';
import type { SearchService } from '@ci/domains/search-next';

import type { PlannedBlockService } from '../PlannedBlockService';
import type { TaskService } from '../TaskService';
import { TodoScanService } from '../TodoScanService';

const USER_ID = 'user-1';
const HIT_ID = '11111111-1111-7111-8111-111111111111';

function makeSearchService() {
  return {
    search: jest.fn(async () => [{ id: HIT_ID, type: 'communication' }]),
  } as unknown as SearchService;
}

function makeDataSource() {
  return {
    query: jest.fn(async () => [
      { id: HIT_ID, entity_type: 'communication', name: 'Reminder', snippet: 'Call the vet about Mochi.' },
    ]),
  };
}

function makeOllamaService(items: Array<Record<string, unknown>>) {
  return {
    chat: jest.fn(async () => ({
      message: { role: 'assistant', content: JSON.stringify({ items }) },
    })),
  } as unknown as OllamaService;
}

function makeLogger(): LoggerService {
  return {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  } as unknown as LoggerService;
}

describe('TodoScanService per-item error isolation', () => {
  it("one item's failure does not abort the rest of the batch", async () => {
    // Three surfaced items: the first creates cleanly, the second throws mid-
    // processing (simulating a transient DB error on that one row), the third
    // must still be reached. Before the fix, an uncaught throw here propagated
    // out of runForUser() and pg-boss would redeliver the WHOLE job — including
    // re-walking the already-applied first item.
    const items = [
      { title: 'Call the vet', confidence: 0.9 },
      { title: 'Explodes', confidence: 0.9 },
      { title: 'Pay the invoice', confidence: 0.9 },
    ];

    const created = new Set<string>();
    const taskService = {
      findBySourceRef: jest.fn(async () => null),
      findByTitleMatch: jest.fn(async () => null),
      create: jest.fn(async (_ctx: unknown, dto: { title: string }) => {
        if (dto.title === 'Explodes') {
          throw new Error('simulated transient failure');
        }

        created.add(dto.title);

        return { id: `task-${dto.title}`, title: dto.title, status: 'open' };
      }),
    } as unknown as TaskService;

    const personalizationService = {
      decideAction: jest.fn(async () => 'auto'),
    } as unknown as PersonalizationService;

    const plannedBlockService = {
      tryPlaceAfterOpen: jest.fn(async () => ({ status: 'placed' })),
    } as unknown as PlannedBlockService;

    const logger = makeLogger();

    const service = new TodoScanService(
      taskService,
      makeSearchService(),
      makeOllamaService(items),
      personalizationService,
      plannedBlockService,
      makeDataSource() as never,
      logger,
    );

    const result = await service.runForUser(USER_ID);

    // Both the item before and the item after the throw were still applied.
    expect(created).toEqual(new Set(['Call the vet', 'Pay the invoice']));
    expect(result.created).toBe(2);
    expect(logger.warn).toHaveBeenCalledWith(
      'Todo scan item failed; continuing with remaining items',
      expect.objectContaining({ title: 'Explodes' }),
    );
  });
});
