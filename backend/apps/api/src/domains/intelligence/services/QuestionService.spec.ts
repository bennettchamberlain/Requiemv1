import { SYSTEM_USER, type ServiceContext } from '@ci/common/context';

import { QuestionEntity } from '../entities/QuestionEntity';

import { QuestionService, FEED_QUESTION_STALE_MS } from './QuestionService';

const USER = '00000000-0000-0000-0000-0000000000aa';

const CONTEXT: ServiceContext = { userId: USER } as ServiceContext;

function makeInsertBuilder(record: { values?: unknown[]; inserted: boolean }) {
  const qb: Record<string, unknown> = {};
  qb.insert = jest.fn(() => qb);
  qb.into = jest.fn(() => qb);
  qb.values = jest.fn((v: unknown[]) => {
    record.values = v;

    return qb;
  });
  qb.execute = jest.fn(async () => {
    record.inserted = true;

    return { raw: [] };
  });

  return qb;
}

function makeService() {
  const insertRecord = { inserted: false } as { values?: unknown[]; inserted: boolean };
  const created: QuestionEntity[] = [];

  const create = jest.fn((partial: Partial<QuestionEntity>) => {
    const entity = Object.assign(new QuestionEntity(), partial);
    created.push(entity);

    return entity;
  });

  const save = jest.fn(async (entity: QuestionEntity) => entity);
  const find = jest.fn(async () => created);

  const repository = {
    create,
    save,
    find,
    // 14 persisted columns, matching repository.metadata.columns.length; drives
    // computeChunkSize in createMany.
    metadata: { target: QuestionEntity, columns: { length: 14 } },
    createQueryBuilder: jest.fn(() => makeInsertBuilder(insertRecord)),
  };

  const send = jest.fn<Promise<string[]>, [string, Record<string, unknown>]>(async () => []);
  const dataSource = { query: jest.fn(async () => []) };

  const service = new QuestionService(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dataSource as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    repository as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { send } as any,
  );

  return { service, send, insert: insertRecord, save };
}

describe('QuestionService bulk createMany', () => {
  it('inserts set-based (one INSERT, no per-row save) and does NOT emit a per-row QuestionCreatedEvent', async () => {
    const { service, send, insert, save } = makeService();

    const result = await service.createMany(CONTEXT, [
      { id: 'q1', text: 'How are you?', category: 'wellbeing' },
      { id: 'q2', text: 'Where are you?', category: 'location' },
    ]);

    expect(insert.inserted).toBe(true);
    expect(insert.values).toHaveLength(2);
    expect(save).not.toHaveBeenCalled();
    expect(result.map((q) => q.id)).toEqual(['q1', 'q2']);
    expect(send).not.toHaveBeenCalled();
  });

  it('resolves is_private_to per row (real caller privatizes to self)', async () => {
    const { service, insert } = makeService();

    await service.createMany(CONTEXT, [{ id: 'q1', text: 'Private?', category: 'x' }]);

    const values = insert.values as Array<{ isPrivateTo?: string | null }>;
    expect(values[0].isPrivateTo).toBe(USER);
  });

  it('leaves is_private_to null for a system caller', async () => {
    const { service, insert } = makeService();

    await service.createMany({ userId: SYSTEM_USER } as ServiceContext, [
      { id: 'q1', text: 'Public?', category: 'x' },
    ]);

    const values = insert.values as Array<{ isPrivateTo?: string | null }>;
    expect(values[0].isPrivateTo).toBeNull();
  });

  it('returns an empty array (and issues no INSERT) for empty input', async () => {
    const { service, send, insert } = makeService();

    const result = await service.createMany(CONTEXT, []);

    expect(result).toEqual([]);
    expect(insert.inserted).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('QuestionService feed rotation', () => {
  function makeRotationService() {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const dataSource = {
      query: jest.fn(async (sql: string, params?: unknown[]) => {
        queries.push({ sql, params });

        if (sql.includes('SELECT') && sql.includes('feed_queue_id') && sql.includes('LIMIT 1')) {
          return [
            {
              feed_queue_id: 'fq-1',
              question_id: 'q-1',
              metadata: {
                lastPresentedAt: new Date(Date.now() - FEED_QUESTION_STALE_MS - 1000).toISOString(),
              },
            },
          ];
        }

        if (sql.includes('UPDATE ci.feed_queue') && sql.includes('rotatedAt')) {
          return [];
        }

        if (sql.includes('GAP_AWARE') || sql.includes('category_coverage')) {
          return [{ id: 'q-2' }];
        }

        if (sql.includes('INSERT INTO ci.feed_queue')) {
          return [{ question_id: 'q-2' }];
        }

        if (sql.includes('COUNT(*)')) {
          return [{ count: '1' }];
        }

        return [];
      }),
    };

    const service = new QuestionService(
      dataSource as never,
      { create: jest.fn(), save: jest.fn(), find: jest.fn(), metadata: { columns: { length: 14 } } } as never,
      { send: jest.fn() } as never,
    );

    return { service, dataSource, queries };
  }

  it('rotates a stale front-of-queue question and enqueues a replacement', async () => {
    const { service, dataSource } = makeRotationService();

    const rotated = await service.rotateStaleFeedQuestions(USER);

    expect(rotated).toBe(true);
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('rotatedAt'),
      expect.arrayContaining(['fq-1']),
    );
  });
});

describe('QuestionService single create still emits', () => {
  it('emits QuestionCreatedEvent on a single interactive create', async () => {
    const { service, send } = makeService();

    await service.create(CONTEXT, { id: 'q1', text: 'How are you?', category: 'wellbeing' });

    expect(send).toHaveBeenCalledTimes(1);
    const [, payload] = send.mock.calls[0];
    expect(payload).toEqual({ questionId: 'q1' });
  });

  it('suppresses the event when emitCreated: false is passed', async () => {
    const { service, send } = makeService();

    await service.create(
      CONTEXT,
      { id: 'q1', text: 'How are you?', category: 'wellbeing' },
      { emitCreated: false },
    );

    expect(send).not.toHaveBeenCalled();
  });
});
