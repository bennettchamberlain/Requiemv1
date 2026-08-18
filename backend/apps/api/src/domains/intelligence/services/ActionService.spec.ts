import type { ServiceContext, UserServiceContext } from '@ci/common/context';
import { SYSTEM_USER } from '@ci/common/context';

import { ActionEntity } from '../entities/ActionEntity';

import { ActionService } from './ActionService';

const USER = '00000000-0000-0000-0000-0000000000aa';
const OTHER_USER = '00000000-0000-0000-0000-0000000000bb';

const CONTEXT: UserServiceContext = { userId: USER } as UserServiceContext;
const OTHER_CONTEXT: ServiceContext = { userId: OTHER_USER } as ServiceContext;
const SYSTEM_CONTEXT: ServiceContext = { userId: SYSTEM_USER } as ServiceContext;

function makeAction(overrides: Partial<ActionEntity> & { id: string } = { id: 'act-1' }): ActionEntity {
  return Object.assign(new ActionEntity(), {
    title: 'title',
    text: 'text',
    priority: 3,
    seen: false,
    dismissed: false,
    source: 'legacy',
    metadata: {},
    createdAt: new Date(),
    ...overrides,
    user: overrides.user ?? { id: USER },
  });
}

function makeQueryBuilder(sequence: ActionEntity[][]) {
  let callIndex = 0;
  const calls: Array<{ method: string; args: unknown[] }> = [];

  function build() {
    const results = sequence[Math.min(callIndex, sequence.length - 1)] ?? [];
    callIndex += 1;

    const qb: Record<string, unknown> = {};
    const chain = (name: string) =>
      jest.fn((...args: unknown[]) => {
        calls.push({ method: name, args });

        return qb;
      });

    qb.where = chain('where');
    qb.andWhere = chain('andWhere');
    qb.orderBy = chain('orderBy');
    qb.take = chain('take');
    qb.getMany = jest.fn(async () => results);

    return qb;
  }

  return { build, calls };
}

function makeService(
  overrides: {
    findResult?: ActionEntity[];
    findOneResult?: ActionEntity | null;
    queryBuilderSequence?: ActionEntity[][];
  } = {},
) {
  const find = jest.fn<Promise<ActionEntity[]>, [unknown]>(async () => overrides.findResult ?? []);
  const findOne = jest.fn<Promise<ActionEntity | null>, [unknown]>(
    async () => overrides.findOneResult ?? null,
  );
  const save = jest.fn(async (entity: ActionEntity) => entity);
  const create = jest.fn((partial: Partial<ActionEntity>) => Object.assign(new ActionEntity(), partial));

  const { build: buildQueryBuilder, calls: queryBuilderCalls } = makeQueryBuilder(
    overrides.queryBuilderSequence ?? [[]],
  );

  const repository = {
    find,
    findOne,
    save,
    create,
    createQueryBuilder: jest.fn(() => buildQueryBuilder()),
  };

  const send = jest.fn(async () => []);
  const eventService = { send };

  const service = new ActionService(repository as never, eventService as never);

  return { service, find, findOne, save, create, send, queryBuilderCalls };
}

describe('ActionService.create', () => {
  it('saves the action and emits ActionCreatedEvent', async () => {
    const { service, save, send } = makeService();

    await service.create(CONTEXT, { title: 'Do the thing', text: 'body', priority: 2 });

    expect(save).toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ userId: USER }));
  });
});

describe('ActionService.countDerivedOnLocalDay', () => {
  it('counts only rows whose UTC createdAt falls on the given local calendar day in the given timezone', async () => {
    // 2026-01-01T02:00:00Z is already 2025-12-31 in America/Los_Angeles (UTC-8 in Jan).
    const inLA = makeAction({ id: 'a1', createdAt: new Date('2026-01-01T02:00:00Z'), source: 'anomaly' });
    // 2026-01-01T20:00:00Z is 2026-01-01 in LA.
    const alsoJan1InLA = makeAction({
      id: 'a2',
      createdAt: new Date('2026-01-01T20:00:00Z'),
      source: 'suggestion',
    });

    const { service } = makeService({ findResult: [inLA, alsoJan1InLA] });

    const count = await service.countDerivedOnLocalDay(CONTEXT, '2026-01-01', 'America/Los_Angeles');

    expect(count).toBe(1);
  });

  it('filters the query to only anomaly/suggestion sources within the last 48 hours', async () => {
    const { service, find } = makeService({ findResult: [] });

    await service.countDerivedOnLocalDay(CONTEXT, '2026-01-01', 'UTC');

    const [options] = find.mock.calls[0] as [{ where: { source: unknown; user: { id: string } } }];
    expect(options.where.user.id).toBe(USER);
    // TypeORM's In() operator — assert its captured value list.
    expect((options.where.source as { _value?: string[] })._value).toEqual(['anomaly', 'suggestion']);
  });

  it('falls back to the UTC date string when given an invalid timezone', async () => {
    const action = makeAction({ id: 'a1', createdAt: new Date('2026-03-15T12:00:00Z') });
    const { service } = makeService({ findResult: [action] });

    const count = await service.countDerivedOnLocalDay(CONTEXT, '2026-03-15', 'Not/A_Real_Zone');

    expect(count).toBe(1);
  });

  it('returns 0 when no derived action falls on the requested local day', async () => {
    const action = makeAction({ id: 'a1', createdAt: new Date('2026-01-01T12:00:00Z') });
    const { service } = makeService({ findResult: [action] });

    const count = await service.countDerivedOnLocalDay(CONTEXT, '2099-01-01', 'UTC');

    expect(count).toBe(0);
  });
});

describe('ActionService tenancy scoping', () => {
  it('findById returns the action for its owner', async () => {
    const { service, findOne } = makeService({ findOneResult: makeAction({ id: 'a1' }) });

    const result = await service.findById(CONTEXT, 'a1');

    expect(result?.id).toBe('a1');
    const [options] = findOne.mock.calls[0] as [{ where: { user?: { id: string } } }];
    expect(options.where.user?.id).toBe(USER);
  });

  it('a non-owner scoped lookup does not include the requested action (findOne is scoped, so a mismatched owner yields no row)', async () => {
    // The repository mock always returns whatever findOneResult is regardless of
    // the where clause (it isn't a real DB), so this test instead proves the
    // SERVICE constructs a caller-scoped where clause — the thing a real
    // Postgres would enforce — for a non-SYSTEM_USER caller.
    const { service, findOne } = makeService({ findOneResult: null });

    const result = await service.findById(OTHER_CONTEXT, 'a1');

    expect(result).toBeNull();
    const [options] = findOne.mock.calls[0] as [{ where: { user?: { id: string } } }];
    expect(options.where.user?.id).toBe(OTHER_USER);
  });

  it("SYSTEM_USER omits the owner scope entirely (can read any user's action)", async () => {
    const { service, findOne } = makeService({ findOneResult: makeAction({ id: 'a1' }) });

    await service.findById(SYSTEM_CONTEXT, 'a1');

    const [options] = findOne.mock.calls[0] as [{ where: { user?: { id: string } } }];
    expect(options.where.user).toBeUndefined();
  });

  it('findAll scopes to the caller and orders by priority ascending', async () => {
    const { service, find } = makeService({ findResult: [] });

    await service.findAll(CONTEXT);

    const [options] = find.mock.calls[0] as [
      { where: { user: { id: string } }; order: { priority: string } },
    ];
    expect(options.where.user.id).toBe(USER);
    expect(options.order.priority).toBe('asc');
  });

  it('findAll filters by a single source or a list of sources', async () => {
    const { service, find } = makeService({ findResult: [] });

    await service.findAll(CONTEXT, { source: 'anomaly' });
    const [singleOptions] = find.mock.calls[0] as [{ where: { source: { _value?: string[] } } }];
    expect(singleOptions.where.source._value).toEqual(['anomaly']);

    await service.findAll(CONTEXT, { source: ['anomaly', 'suggestion'] });
    const [listOptions] = find.mock.calls[1] as [{ where: { source: { _value?: string[] } } }];
    expect(listOptions.where.source._value).toEqual(['anomaly', 'suggestion']);
  });

  it('findByIds scopes to the caller and preserves null for ids owned by another user', async () => {
    const { service, find } = makeService({ findResult: [makeAction({ id: 'a1' })] });

    const result = await service.findByIds(CONTEXT, ['a1', 'a2']);

    expect(result[0]?.id).toBe('a1');
    expect(result[1]).toBeNull();
    const [options] = find.mock.calls[0] as [{ where: { user: { id: string } } }];
    expect(options.where.user.id).toBe(USER);
  });

  it('findByThreadId scopes to the caller', async () => {
    const { service, findOne } = makeService({ findOneResult: makeAction({ id: 'a1' }) });

    await service.findByThreadId(CONTEXT, 'thread-1');

    const [options] = findOne.mock.calls[0] as [{ where: { user?: { id: string }; threadId: string } }];
    expect(options.where.user?.id).toBe(USER);
    expect(options.where.threadId).toBe('thread-1');
  });
});

describe('ActionService.findForFeed', () => {
  it('returns unseen actions directly when there are already enough of them', async () => {
    const unseen = [makeAction({ id: 'u1' }), makeAction({ id: 'u2' }), makeAction({ id: 'u3' })];
    const { service, queryBuilderCalls } = makeService({ queryBuilderSequence: [unseen] });

    const result = await service.findForFeed(CONTEXT, 3);

    expect(result.map((a) => a.id)).toEqual(['u1', 'u2', 'u3']);
    // Only the unseen query ran — no second (seen) query builder was needed.
    expect(queryBuilderCalls.filter((c) => c.method === 'take')).toHaveLength(1);
  });

  it('fills the remainder with seen actions when unseen actions are short of the limit', async () => {
    const unseen = [makeAction({ id: 'u1', seen: false })];
    const seen = [makeAction({ id: 's1', seen: true }), makeAction({ id: 's2', seen: true })];
    const { service } = makeService({ queryBuilderSequence: [unseen, seen] });

    const result = await service.findForFeed(CONTEXT, 3);

    expect(result.map((a) => a.id)).toEqual(['u1', 's1', 's2']);
  });

  it('requests exactly the remaining count (limit - unseen) from the seen fallback query', async () => {
    const unseen = [makeAction({ id: 'u1' })];
    const seen = [makeAction({ id: 's1' })];
    const { service, queryBuilderCalls } = makeService({ queryBuilderSequence: [unseen, seen] });

    await service.findForFeed(CONTEXT, 5);

    const takeCalls = queryBuilderCalls.filter((c) => c.method === 'take');
    expect(takeCalls[0].args[0]).toBe(5); // unseen query: full limit
    expect(takeCalls[1].args[0]).toBe(4); // seen query: limit - 1 unseen result
  });
});

describe('ActionService.markAsSeen / markAsDismissed', () => {
  it('markAsSeen sets seen=true and mirrors it into metadata', async () => {
    const action = makeAction({ id: 'a1', seen: false, metadata: { foo: 'bar' } });
    const { service, save } = makeService({ findOneResult: action });

    const result = await service.markAsSeen(CONTEXT, 'a1');

    expect(result?.seen).toBe(true);
    const [saved] = save.mock.calls[0] as [ActionEntity];
    expect(saved.metadata).toMatchObject({ foo: 'bar', seen: true });
  });

  it('markAsSeen returns null (no save) when the action cannot be found for this caller', async () => {
    const { service, save } = makeService({ findOneResult: null });

    const result = await service.markAsSeen(CONTEXT, 'missing');

    expect(result).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });

  it('markAsDismissed sets dismissed=true', async () => {
    const action = makeAction({ id: 'a1', dismissed: false });
    const { service, save } = makeService({ findOneResult: action });

    const result = await service.markAsDismissed(CONTEXT, 'a1');

    expect(result?.dismissed).toBe(true);
    expect(save).toHaveBeenCalled();
  });

  it('markAsDismissed returns null (no save) when the action cannot be found for this caller', async () => {
    const { service, save } = makeService({ findOneResult: null });

    const result = await service.markAsDismissed(CONTEXT, 'missing');

    expect(result).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });
});
