import type { ServiceContext, UserServiceContext } from '@ci/common/context';
import { SYSTEM_USER } from '@ci/common/context';

import { AnswerEntity } from '../entities/AnswerEntity';

import { AnswerService } from './AnswerService';

const USER = '00000000-0000-0000-0000-0000000000aa';
const OTHER_USER = '00000000-0000-0000-0000-0000000000bb';

const CONTEXT: UserServiceContext = { userId: USER } as UserServiceContext;
const OTHER_CONTEXT: ServiceContext = { userId: OTHER_USER } as ServiceContext;
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
  const created: AnswerEntity[] = [];

  const create = jest.fn((partial: Partial<AnswerEntity>) => {
    const entity = Object.assign(new AnswerEntity(), partial);
    created.push(entity);

    return entity;
  });

  const save = jest.fn(async (entity: AnswerEntity) => entity);
  const find = jest.fn(async () => created);

  const repository = {
    create,
    save,
    find,
    // 16 scalar columns + the user_id and question_id relation-join columns =
    // 18, matching repository.metadata.columns.length; drives computeChunkSize
    // in createMany.
    metadata: { target: AnswerEntity, columns: { length: 18 } },
    createQueryBuilder: jest.fn(() => makeInsertBuilder(insertRecord)),
  };

  const send = jest.fn<Promise<string[]>, [string, Record<string, unknown>]>(async () => []);

  const removeFromFeedQueue = jest.fn<Promise<void>, [string, string]>(async () => {});
  const removeManyFromFeedQueue = jest.fn<Promise<void>, [string, string[]]>(async () => {});
  const questionService = { removeFromFeedQueue, removeManyFromFeedQueue };

  const service = new AnswerService(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    repository as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { send } as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    questionService as any,
  );

  return { service, send, insert: insertRecord, save, removeFromFeedQueue, removeManyFromFeedQueue };
}

describe('AnswerService bulk createMany', () => {
  it('inserts set-based (one INSERT, no per-row save) and does NOT emit a per-row AnswerCreatedEvent', async () => {
    const { service, send, insert, save } = makeService();

    const result = await service.createMany(CONTEXT, [
      { id: 'a1', text: 'yes', question: { id: 'q1' } },
      { id: 'a2', text: 'no', question: { id: 'q2' } },
    ]);

    expect(insert.inserted).toBe(true);
    expect(insert.values).toHaveLength(2);
    expect(save).not.toHaveBeenCalled();
    expect(result.map((a) => a.id)).toEqual(['a1', 'a2']);
    expect(send).not.toHaveBeenCalled();
  });

  it('cleans up the feed queue with ONE batched call (not per-row) on the bulk path', async () => {
    const { service, removeFromFeedQueue, removeManyFromFeedQueue } = makeService();

    await service.createMany(CONTEXT, [
      { id: 'a1', text: 'yes', question: { id: 'q1' } },
      { id: 'a2', text: 'no', question: { id: 'q2' } },
      { id: 'a3', text: 'maybe', question: { id: 'q1' } }, // dup question id
    ]);

    // One batched DELETE, de-duplicated question ids, and NO per-row calls.
    expect(removeFromFeedQueue).not.toHaveBeenCalled();
    expect(removeManyFromFeedQueue).toHaveBeenCalledTimes(1);
    const [userId, ids] = removeManyFromFeedQueue.mock.calls[0];
    expect(userId).toBe(USER);
    expect([...ids].sort()).toEqual(['q1', 'q2']);
  });

  it('returns an empty array (and issues no INSERT) for empty input', async () => {
    const { service, send, insert, removeManyFromFeedQueue } = makeService();

    const result = await service.createMany(CONTEXT, []);

    expect(result).toEqual([]);
    expect(insert.inserted).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(removeManyFromFeedQueue).not.toHaveBeenCalled();
  });
});

describe('AnswerService single create still emits', () => {
  it('emits AnswerCreatedEvent and removes the answered question from the feed', async () => {
    const { service, send, removeFromFeedQueue } = makeService();

    await service.create(CONTEXT, { id: 'a1', text: 'yes', question: { id: 'q1' } });

    expect(send).toHaveBeenCalledTimes(1);
    const [, payload] = send.mock.calls[0];
    expect(payload).toEqual({ answerId: 'a1' });
    expect(removeFromFeedQueue).toHaveBeenCalledWith(USER, 'q1');
  });

  it('suppresses the event when emitCreated: false is passed (but still cleans the feed)', async () => {
    const { service, send, removeFromFeedQueue } = makeService();

    await service.create(CONTEXT, { id: 'a1', text: 'yes', question: { id: 'q1' } }, { emitCreated: false });

    expect(send).not.toHaveBeenCalled();
    expect(removeFromFeedQueue).toHaveBeenCalledWith(USER, 'q1');
  });
});

/**
 * A minimal in-memory fake that actually HONORS the `where` clause it is given
 * (id / user.id / question.id equality), the way Postgres row filtering would.
 * This lets the tenancy tests below prove the service's SYSTEM_USER-conditional
 * scoping idiom by observing the resulting rows, not by inspecting mock call
 * args — a dropped or inverted `context.userId !== SYSTEM_USER` predicate would
 * make these tests fail, not just an assertion on how the mock was called.
 */
function makeStoreRepository(rows: AnswerEntity[]) {
  const matches = (row: AnswerEntity, where: Record<string, unknown>): boolean => {
    if (where.id !== undefined && row.id !== where.id) {return false;}

    if (where.user !== undefined) {
      const userWhere = where.user as { id?: string };
      if (userWhere.id !== undefined && row.user?.id !== userWhere.id) {return false;}
    }

    if (where.question !== undefined) {
      const questionWhere = where.question as { id?: string };
      if (questionWhere.id !== undefined && row.question?.id !== questionWhere.id) {return false;}
    }

    return true;
  };

  const findOne = jest.fn(async (options: { where: Record<string, unknown> }) => {
    return rows.find((row) => matches(row, options.where)) ?? null;
  });

  const find = jest.fn(async (options: { where: Record<string, unknown> }) => {
    const where = options.where;
    const idFilter = where.id as { _value?: string[] } | string[] | undefined;

    // Support both a plain equality id and the In([...]) used by findByIds.
    const idList = Array.isArray(idFilter)
      ? idFilter
      : (idFilter as unknown as { _value?: string[] })?._value;

    return rows.filter((row) => {
      if (idList && !idList.includes(row.id)) {return false;}

      const { id: _id, ...rest } = where;
      void _id;

      return matches(row, rest);
    });
  });

  const deleteFn = jest.fn(async () => ({ affected: 1 }));
  const save = jest.fn(async (entity: AnswerEntity) => entity);

  const repository = { findOne, find, delete: deleteFn, save };

  return { repository, findOne, find, delete: deleteFn, save };
}

function makeServiceWithStore(rows: AnswerEntity[]) {
  const { repository, findOne, find, delete: deleteFn, save } = makeStoreRepository(rows);
  const send = jest.fn(async () => []);
  const questionService = { removeFromFeedQueue: jest.fn(), removeManyFromFeedQueue: jest.fn() };

  const service = new AnswerService(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    repository as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { send } as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    questionService as any,
  );

  return { service, findOne, find, delete: deleteFn, save, send };
}

function makeAnswer(id: string, userId: string, questionId = 'q1'): AnswerEntity {
  return Object.assign(new AnswerEntity(), {
    id,
    answer: `answer-${id}`,
    user: { id: userId },
    question: { id: questionId },
  });
}

describe('AnswerService tenancy scoping (SYSTEM_USER-conditional idiom)', () => {
  describe('findById', () => {
    it('returns the answer for its owner', async () => {
      const { service } = makeServiceWithStore([makeAnswer('a1', USER)]);

      const result = await service.findById(CONTEXT, 'a1');

      expect(result?.id).toBe('a1');
    });

    it('rejects (returns null for) a caller who is not the owner', async () => {
      const { service } = makeServiceWithStore([makeAnswer('a1', USER)]);

      const result = await service.findById(OTHER_CONTEXT, 'a1');

      expect(result).toBeNull();
    });

    it('SYSTEM_USER bypasses the owner scope and can read any answer', async () => {
      const { service } = makeServiceWithStore([makeAnswer('a1', USER)]);

      const result = await service.findById(SYSTEM_CONTEXT, 'a1');

      expect(result?.id).toBe('a1');
    });
  });

  describe('findByIds', () => {
    it('returns null placeholders for ids owned by another user, preserving input order', async () => {
      const { service } = makeServiceWithStore([makeAnswer('a1', USER), makeAnswer('a2', OTHER_USER)]);

      const result = await service.findByIds(CONTEXT, ['a1', 'a2']);

      expect(result[0]?.id).toBe('a1');
      expect(result[1]).toBeNull();
    });

    it('returns [] immediately for an empty id list without querying', async () => {
      const { service, find } = makeServiceWithStore([]);

      const result = await service.findByIds(CONTEXT, []);

      expect(result).toEqual([]);
      expect(find).not.toHaveBeenCalled();
    });
  });

  describe('findByQuestionId', () => {
    it('finds the caller-owned answer to a question', async () => {
      const { service } = makeServiceWithStore([makeAnswer('a1', USER, 'q1')]);

      const result = await service.findByQuestionId(CONTEXT, 'q1');

      expect(result?.id).toBe('a1');
    });

    it("does not leak another user's answer to the same question", async () => {
      const { service } = makeServiceWithStore([makeAnswer('a1', OTHER_USER, 'q1')]);

      const result = await service.findByQuestionId(CONTEXT, 'q1');

      expect(result).toBeNull();
    });
  });

  describe('findAll', () => {
    it("scopes to the caller — never mixes in another user's answers", async () => {
      const { service, find } = makeServiceWithStore([makeAnswer('a1', USER)]);

      await service.findAll(CONTEXT);

      const [options] = find.mock.calls[0] as [{ where: { user: { id: string } } }];
      expect(options.where.user.id).toBe(USER);
    });
  });

  describe('update', () => {
    it('updates and returns the answer when the caller owns it', async () => {
      const { service } = makeServiceWithStore([makeAnswer('a1', USER)]);

      const result = await service.update(CONTEXT, 'a1', { text: 'updated' });

      expect(result?.id).toBe('a1');
    });

    it('returns null without saving when a non-owner attempts the update', async () => {
      const { service, findOne } = makeServiceWithStore([makeAnswer('a1', USER)]);

      const result = await service.update(OTHER_CONTEXT, 'a1', { text: 'hijacked' });

      expect(result).toBeNull();
      // findOne was called scoped to the wrong owner and found nothing — no save happened.
      expect(findOne).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes and returns true when the caller owns the answer', async () => {
      const { service, delete: deleteFn, send } = makeServiceWithStore([makeAnswer('a1', USER)]);

      const result = await service.remove(CONTEXT, 'a1');

      expect(result).toBe(true);
      expect(deleteFn).toHaveBeenCalled();
      expect(send).toHaveBeenCalledWith(expect.anything(), { answerId: 'a1' });
    });

    it('returns false and does NOT delete when a non-owner attempts the removal', async () => {
      const { service, delete: deleteFn } = makeServiceWithStore([makeAnswer('a1', USER)]);

      const result = await service.remove(OTHER_CONTEXT, 'a1');

      expect(result).toBe(false);
      expect(deleteFn).not.toHaveBeenCalled();
    });
  });
});
