import { SYSTEM_USER, type ServiceContext } from '@ci/common/context';

import { QuestionEntity } from '../entities/QuestionEntity';

import { QuestionService, FEED_QUESTION_STALE_MS } from './QuestionService';

const USER = '00000000-0000-0000-0000-0000000000aa';
const OTHER_USER = '00000000-0000-0000-0000-0000000000bb';

const CONTEXT: ServiceContext = { userId: USER } as ServiceContext;
const SYSTEM_CONTEXT: ServiceContext = { userId: SYSTEM_USER } as ServiceContext;

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

/**
 * A minimal in-memory fake that HONORS the `where` clause it is given — including
 * TypeORM's array-of-clauses OR semantics and the In()/IsNull() FindOperators —
 * the way Postgres row filtering would. This lets the privacy tests below prove
 * the is_private_to scoping by observing actual returned rows: a dropped or
 * inverted `context.userId !== SYSTEM_USER` predicate, or a missing isPrivateTo
 * clause, would make these tests fail rather than just assert on mock call args.
 */
type FindOperatorLike = { _type: string; _value?: unknown };

function isFindOperator(value: unknown): value is FindOperatorLike {
  return typeof value === 'object' && value !== null && '_type' in value;
}

function matchesClause(row: QuestionEntity, clause: Record<string, unknown>): boolean {
  return Object.entries(clause).every(([key, expected]) => {
    const actual = (row as unknown as Record<string, unknown>)[key];

    if (isFindOperator(expected)) {
      if (expected._type === 'in') {
        return Array.isArray(expected._value) && expected._value.includes(actual);
      }

      if (expected._type === 'isNull') {
        return actual === null || actual === undefined;
      }

      return false;
    }

    return actual === expected;
  });
}

function matchesWhere(
  row: QuestionEntity,
  where: Record<string, unknown> | Record<string, unknown>[],
): boolean {
  const clauses = Array.isArray(where) ? where : [where];

  return clauses.some((clause) => matchesClause(row, clause));
}

function makeQuestion(
  id: string,
  opts: { isPrivateTo?: string | null; isActive?: boolean } = {},
): QuestionEntity {
  return Object.assign(new QuestionEntity(), {
    id,
    text: `question-${id}`,
    category: 'general',
    isActive: opts.isActive ?? true,
    isPrivateTo: opts.isPrivateTo ?? null,
  });
}

function makeScopedService(rows: QuestionEntity[]) {
  const find = jest.fn(async (options: { where: Record<string, unknown> | Record<string, unknown>[] }) => {
    return rows.filter((row) => matchesWhere(row, options.where));
  });
  const findOne = jest.fn(async (options: { where: Record<string, unknown> | Record<string, unknown>[] }) => {
    return rows.find((row) => matchesWhere(row, options.where)) ?? null;
  });
  const save = jest.fn(async (entity: QuestionEntity) => entity);
  const deleteFn = jest.fn(async () => ({ affected: 1 }));

  const repository = { find, findOne, save, delete: deleteFn };
  const send = jest.fn(async () => []);
  const dataSource = { query: jest.fn(async () => []) };

  const service = new QuestionService(dataSource as never, repository as never, { send } as never);

  return { service, find, findOne, save, delete: deleteFn, send };
}

describe('QuestionService privacy scoping (is_private_to)', () => {
  describe('findAll', () => {
    it("returns public questions plus the caller's own private questions, never another user's private ones", async () => {
      const { service } = makeScopedService([
        makeQuestion('public-1'),
        makeQuestion('mine-1', { isPrivateTo: USER }),
        makeQuestion('theirs-1', { isPrivateTo: OTHER_USER }),
      ]);

      const result = await service.findAll(CONTEXT);
      const ids = result.map((q) => q.id).sort();

      expect(ids).toEqual(['mine-1', 'public-1']);
      expect(ids).not.toContain('theirs-1');
    });

    it('SYSTEM_USER only sees public questions (no user id to match private ones against)', async () => {
      const { service } = makeScopedService([
        makeQuestion('public-1'),
        makeQuestion('mine-1', { isPrivateTo: USER }),
      ]);

      const result = await service.findAll(SYSTEM_CONTEXT);

      expect(result.map((q) => q.id)).toEqual(['public-1']);
    });
  });

  describe('findById', () => {
    it('returns a public question to any caller', async () => {
      const { service } = makeScopedService([makeQuestion('public-1')]);

      await expect(service.findById(CONTEXT, 'public-1')).resolves.toMatchObject({ id: 'public-1' });
    });

    it("returns the caller's own private question", async () => {
      const { service } = makeScopedService([makeQuestion('mine-1', { isPrivateTo: USER })]);

      await expect(service.findById(CONTEXT, 'mine-1')).resolves.toMatchObject({ id: 'mine-1' });
    });

    it("rejects (returns null for) another user's private question — the tenancy leak case", async () => {
      const { service } = makeScopedService([makeQuestion('theirs-1', { isPrivateTo: OTHER_USER })]);

      await expect(service.findById(CONTEXT, 'theirs-1')).resolves.toBeNull();
    });
  });

  describe('findByIds', () => {
    it('filters out ids private to another user while keeping public and own-private ids, deduped', async () => {
      const { service } = makeScopedService([
        makeQuestion('public-1'),
        makeQuestion('mine-1', { isPrivateTo: USER }),
        makeQuestion('theirs-1', { isPrivateTo: OTHER_USER }),
      ]);

      const result = await service.findByIds(CONTEXT, ['public-1', 'mine-1', 'theirs-1']);
      const ids = result.map((q) => q.id).sort();

      expect(ids).toEqual(['mine-1', 'public-1']);
    });
  });

  describe('update', () => {
    it('lets the owner update their own private question', async () => {
      const { service, save } = makeScopedService([makeQuestion('mine-1', { isPrivateTo: USER })]);

      const result = await service.update(CONTEXT, 'mine-1', { text: 'updated' });

      expect(result?.id).toBe('mine-1');
      expect(save).toHaveBeenCalled();
    });

    it('rejects a non-owner update of a private question (returns null, no save)', async () => {
      const { service, save } = makeScopedService([makeQuestion('theirs-1', { isPrivateTo: OTHER_USER })]);

      const result = await service.update(CONTEXT, 'theirs-1', { text: 'hijacked' });

      expect(result).toBeNull();
      expect(save).not.toHaveBeenCalled();
    });

    it('a non-system caller cannot update a public (non-private) question either', async () => {
      const { service, save } = makeScopedService([makeQuestion('public-1')]);

      const result = await service.update(CONTEXT, 'public-1', { text: 'edited' });

      expect(result).toBeNull();
      expect(save).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('lets the owner remove their own private question', async () => {
      const { service, delete: deleteFn } = makeScopedService([
        makeQuestion('mine-1', { isPrivateTo: USER }),
      ]);

      await expect(service.remove(CONTEXT, 'mine-1')).resolves.toBe(true);
      expect(deleteFn).toHaveBeenCalled();
    });

    it('rejects a non-owner remove of a private question (returns false, no delete)', async () => {
      const { service, delete: deleteFn } = makeScopedService([
        makeQuestion('theirs-1', { isPrivateTo: OTHER_USER }),
      ]);

      await expect(service.remove(CONTEXT, 'theirs-1')).resolves.toBe(false);
      expect(deleteFn).not.toHaveBeenCalled();
    });
  });
});

describe('QuestionService.enqueueNextFeedQueueQuestion', () => {
  function makeQueueService(overrides: {
    queueCount?: string;
    candidate?: { id: string } | undefined;
    insertedRows?: Array<{ question_id: string }>;
  }) {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const dataSource = {
      query: jest.fn(async (sql: string, params?: unknown[]) => {
        queries.push({ sql, params });

        if (sql.includes('DELETE FROM ci.feed_queue')) {
          return [];
        }

        if (sql.includes('COUNT(*)')) {
          return [{ count: overrides.queueCount ?? '0' }];
        }

        if (sql.includes('category_coverage')) {
          return overrides.candidate ? [overrides.candidate] : [];
        }

        if (sql.includes('INSERT INTO ci.feed_queue')) {
          return overrides.insertedRows ?? [];
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

  it('returns false without querying for a candidate when the queue is already full', async () => {
    const { service, queries } = makeQueueService({ queueCount: '3' });

    const result = await service.enqueueNextFeedQueueQuestion('user-1', 3);

    expect(result).toBe(false);
    expect(queries.some((q) => q.sql.includes('category_coverage'))).toBe(false);
  });

  it('returns false when the queue has room but there is no gap-aware candidate', async () => {
    const { service } = makeQueueService({ queueCount: '0', candidate: undefined });

    const result = await service.enqueueNextFeedQueueQuestion('user-1', 3);

    expect(result).toBe(false);
  });

  it('inserts the candidate and returns true when the queue has room and a candidate exists', async () => {
    const { service } = makeQueueService({
      queueCount: '0',
      candidate: { id: 'q-new' },
      insertedRows: [{ question_id: 'q-new' }],
    });

    const result = await service.enqueueNextFeedQueueQuestion('user-1', 3);

    expect(result).toBe(true);
  });

  it('returns false when the INSERT ON CONFLICT DO NOTHING no-ops (race with another enqueue)', async () => {
    const { service } = makeQueueService({
      queueCount: '0',
      candidate: { id: 'q-new' },
      insertedRows: [],
    });

    const result = await service.enqueueNextFeedQueueQuestion('user-1', 3);

    expect(result).toBe(false);
  });
});

describe('QuestionService.findUnansweredByUserId', () => {
  it('groups unanswered question ids by user id', async () => {
    const dataSource = {
      query: jest.fn(async () => [
        { id: 'q-1', user_id: 'user-1' },
        { id: 'q-2', user_id: 'user-1' },
        { id: 'q-3', user_id: 'user-2' },
      ]),
    };

    const service = new QuestionService(
      dataSource as never,
      { create: jest.fn(), save: jest.fn(), find: jest.fn(), metadata: { columns: { length: 14 } } } as never,
      { send: jest.fn() } as never,
    );

    const result = await service.findUnansweredByUserId();

    expect(result.get('user-1')).toEqual(['q-1', 'q-2']);
    expect(result.get('user-2')).toEqual(['q-3']);
  });

  it('returns an empty map when there are no unanswered questions', async () => {
    const dataSource = { query: jest.fn(async () => []) };

    const service = new QuestionService(
      dataSource as never,
      { create: jest.fn(), save: jest.fn(), find: jest.fn(), metadata: { columns: { length: 14 } } } as never,
      { send: jest.fn() } as never,
    );

    const result = await service.findUnansweredByUserId();

    expect(result.size).toBe(0);
  });
});
