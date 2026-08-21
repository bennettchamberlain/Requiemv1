import type { LoggerService } from '@ci/common/logging';
import type { OllamaService } from '@ci/domains/llm/services/OllamaService';
import type { CommunicationEntity } from '@ci/domains/memory';
import type { PersonalizationService } from '@ci/domains/personalization';

import { InboxScanService } from '../InboxScanService';
import type { PlannedBlockService } from '../PlannedBlockService';
import type { TaskService } from '../TaskService';

const USER_ID = 'user-1';

function makeMessage(overrides: Partial<CommunicationEntity> = {}): CommunicationEntity {
  return {
    id: 'comm-1',
    communicationType: 'email',
    time: new Date('2026-08-19T10:00:00.000Z'),
    subject: 'Invoice due',
    preview: 'Please pay the attached invoice by Friday.',
    summary: null,
    content: null,
    ...overrides,
  } as unknown as CommunicationEntity;
}

function makeCommunicationRepository(rows: CommunicationEntity[]) {
  const qb = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    getMany: jest.fn(async () => rows),
  };

  return { createQueryBuilder: jest.fn(() => qb) };
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

describe('InboxScanService per-item error isolation', () => {
  it("one item's failure does not abort the rest of the batch", async () => {
    // Same failure mode as TodoScanService: a mid-batch throw must not
    // propagate out of runForUser() and force pg-boss to redeliver (and
    // re-walk) the whole job.
    const items = [
      { title: 'Pay the invoice', confidence: 0.9 },
      { title: 'Explodes', confidence: 0.9 },
      { title: 'Reply to Sam', confidence: 0.9 },
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

    const service = new InboxScanService(
      makeCommunicationRepository([makeMessage()]) as never,
      taskService,
      makeOllamaService(items),
      personalizationService,
      plannedBlockService,
      logger,
    );

    const result = await service.runForUser(USER_ID);

    expect(created).toEqual(new Set(['Pay the invoice', 'Reply to Sam']));
    expect(result.created).toBe(2);
    expect(logger.warn).toHaveBeenCalledWith(
      'Inbox scan item failed; continuing with remaining items',
      expect.objectContaining({ title: 'Explodes' }),
    );
  });
});
