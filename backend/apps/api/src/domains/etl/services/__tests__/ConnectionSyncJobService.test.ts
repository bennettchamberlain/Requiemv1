import type { ServiceContext } from '@ci/common/context';
import { SYSTEM_USER } from '@ci/common/context';

import { ConnectionSyncJobService } from '../ConnectionSyncJobService';

const USER = '00000000-0000-0000-0000-0000000000aa';
const OTHER_USER = '00000000-0000-0000-0000-0000000000bb';

const CONTEXT: ServiceContext = { userId: USER } as ServiceContext;
const SYSTEM_CONTEXT: ServiceContext = { userId: SYSTEM_USER } as ServiceContext;

/**
 * A spy query builder that records every where()/andWhere()/orderBy() call
 * (SQL fragment + bound params) instead of executing SQL. This is the
 * convention this file's sibling tests use for TypeORM query-builder chains
 * (see ActionService.spec.ts's findForFeed tests) — it proves the SERVICE
 * asks for the right filters, which is exactly what SyncNowService.spec.ts's
 * blanket `search` mock could never catch.
 */
function makeQueryBuilderSpy(results: unknown[] = []) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const qb: Record<string, unknown> = {};
  const chain = (name: string) =>
    jest.fn((...args: unknown[]) => {
      calls.push({ method: name, args });

      return qb;
    });

  qb.where = chain('where');
  qb.andWhere = chain('andWhere');
  qb.orderBy = chain('orderBy');
  qb.getMany = jest.fn(async () => results);

  return { qb, calls };
}

function makeService(overrides: { queryBuilderResults?: unknown[] } = {}) {
  const { qb, calls } = makeQueryBuilderSpy(overrides.queryBuilderResults);

  const find = jest.fn<Promise<unknown[]>, [unknown]>(async () => []);
  const findOne = jest.fn<Promise<unknown>, [unknown]>(async () => null);
  const save = jest.fn(async (entity: unknown) => entity);
  const deleteFn = jest.fn(async () => ({ affected: 1 }));
  const create = jest.fn((partial: unknown) => partial);

  const repository = {
    find,
    findOne,
    save,
    delete: deleteFn,
    create,
    createQueryBuilder: jest.fn(() => qb),
  };

  const logger = { setContext() {}, log() {}, warn: jest.fn(), error() {} };

  const service = new ConnectionSyncJobService(repository as never, logger as never);

  return { service, find, findOne, save, delete: deleteFn, queryBuilderCalls: calls, logger };
}

function whereFragments(calls: Array<{ method: string; args: unknown[] }>) {
  return calls.filter((c) => c.method === 'where' || c.method === 'andWhere').map((c) => c.args[0] as string);
}

describe('ConnectionSyncJobService.search — query construction', () => {
  it('scopes to the caller by user_id, ANDed with every other filter that is set', async () => {
    const { service, queryBuilderCalls } = makeService();

    await service.search(CONTEXT, {
      connectionId: 'conn-1',
      endpointName: 'messages',
      status: 'pending',
      type: 'incremental',
    });

    const fragments = whereFragments(queryBuilderCalls);
    expect(fragments[0]).toBe('user_id = :userId');
    expect(fragments).toEqual(
      expect.arrayContaining([
        'connection_id = :connectionId',
        'endpoint_name = :endpointName',
        'status = :status',
        'type = :type',
      ]),
    );
    // where() (not andWhere()) is used exactly once, for the tenancy scope.
    expect(queryBuilderCalls.filter((c) => c.method === 'where')).toHaveLength(1);
  });

  it('omits the user_id scope entirely for SYSTEM_USER (the orchestrator polls across all users)', async () => {
    const { service, queryBuilderCalls } = makeService();

    await service.search(SYSTEM_CONTEXT, { status: 'pending' });

    const fragments = whereFragments(queryBuilderCalls);
    expect(fragments).not.toContain('user_id = :userId');
    expect(fragments).toContain('status = :status');
  });

  it('binds the actual filter values as query parameters', async () => {
    const { service, queryBuilderCalls } = makeService();

    await service.search(CONTEXT, { connectionId: 'conn-42', status: 'success' });

    const statusCall = queryBuilderCalls.find((c) => c.args[0] === 'status = :status');
    expect(statusCall?.args[1]).toEqual({ status: 'success' });
    const connectionCall = queryBuilderCalls.find((c) => c.args[0] === 'connection_id = :connectionId');
    expect(connectionCall?.args[1]).toEqual({ connectionId: 'conn-42' });
  });

  it('filters lastTransformed IS NULL (the awaiting-transform guard) when explicitly given null', async () => {
    const { service, queryBuilderCalls } = makeService();

    await service.search(CONTEXT, { status: 'success', lastTransformed: null });

    const fragments = whereFragments(queryBuilderCalls);
    expect(fragments).toContain('last_transformed IS NULL');
  });

  it('filters lastTransformed >= value when given a concrete date, not IS NULL', async () => {
    const cutoff = new Date('2026-01-01T00:00:00Z');
    const { service, queryBuilderCalls } = makeService();

    await service.search(CONTEXT, { lastTransformed: cutoff });

    const fragments = whereFragments(queryBuilderCalls);
    expect(fragments).not.toContain('last_transformed IS NULL');
    expect(fragments).toContain('last_transformed >= :lastTransformed');
    const call = queryBuilderCalls.find((c) => c.args[0] === 'last_transformed >= :lastTransformed');
    expect(call?.args[1]).toEqual({ lastTransformed: cutoff });
  });

  it('adds neither lastTransformed clause when the field is left undefined', async () => {
    const { service, queryBuilderCalls } = makeService();

    await service.search(CONTEXT, { status: 'pending' });

    const fragments = whereFragments(queryBuilderCalls);
    expect(fragments).not.toContain('last_transformed IS NULL');
    expect(fragments).not.toContain('last_transformed >= :lastTransformed');
  });

  it('parses "field:DIRECTION" orderBy into an orderBy() call', async () => {
    const { service, queryBuilderCalls } = makeService();

    await service.search(CONTEXT, { orderBy: 'updated_at:DESC' });

    const orderByCall = queryBuilderCalls.find((c) => c.method === 'orderBy');
    expect(orderByCall?.args).toEqual(['updated_at', 'DESC']);
  });

  it('warns and skips ordering on an invalid direction instead of passing it through to SQL', async () => {
    const { service, queryBuilderCalls, logger } = makeService();

    await service.search(CONTEXT, { orderBy: 'updated_at:SIDEWAYS' as never });

    expect(logger.warn).toHaveBeenCalled();
    expect(queryBuilderCalls.some((c) => c.method === 'orderBy')).toBe(false);
  });

  it('builds a bare (unscoped-by-anything-but-tenancy) query when no filters are given', async () => {
    const { service, queryBuilderCalls } = makeService();

    await service.search(CONTEXT, {});

    expect(queryBuilderCalls).toHaveLength(1); // just the user_id where()
    expect(queryBuilderCalls[0].args[0]).toBe('user_id = :userId');
  });
});

describe('ConnectionSyncJobService tenancy scoping (SYSTEM_USER-conditional idiom)', () => {
  it('findById scopes the lookup to the caller for a non-system user', async () => {
    const { service, findOne } = makeService();

    await service.findById(CONTEXT, 'job-1');

    const [options] = findOne.mock.calls[0] as [{ where: { userId?: string } }];
    expect(options.where.userId).toBe(USER);
  });

  it('findById omits the owner scope for SYSTEM_USER', async () => {
    const { service, findOne } = makeService();

    await service.findById(SYSTEM_CONTEXT, 'job-1');

    const [options] = findOne.mock.calls[0] as [{ where: { userId?: string } }];
    expect(options.where.userId).toBeUndefined();
  });

  it("update returns null (no save) when the job is not found under the caller's scope", async () => {
    const { service, save } = makeService();

    const result = await service.update(CONTEXT, 'job-1', { status: 'success' });

    expect(result).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });

  it('delete scopes both the existence check and the DELETE itself to the caller', async () => {
    const { service, findOne, delete: deleteFn } = makeService({});
    (findOne as jest.Mock).mockResolvedValueOnce({ id: 'job-1', userId: USER });

    const result = await service.delete(CONTEXT, 'job-1');

    expect(result).toBe(true);
    expect(deleteFn).toHaveBeenCalledWith(expect.objectContaining({ id: 'job-1', userId: USER }));
  });

  it("delete returns false without deleting when the job cannot be found under the caller's scope", async () => {
    const { service, delete: deleteFn } = makeService();

    const result = await service.delete({ userId: OTHER_USER } as ServiceContext, 'job-1');

    expect(result).toBe(false);
    expect(deleteFn).not.toHaveBeenCalled();
  });
});

describe('ConnectionSyncJobService.markAsCompleted', () => {
  it('stamps completedAt and forwards status/error through update()', async () => {
    const { service, findOne, save } = makeService();
    (findOne as jest.Mock)
      .mockResolvedValueOnce({ id: 'job-1', userId: USER })
      .mockResolvedValueOnce({ id: 'job-1', userId: USER, status: 'failed' });

    await service.markAsCompleted(CONTEXT, 'job-1', 'failed', { error: 'boom' });

    const [saved] = save.mock.calls[0] as [{ status: string; completedAt: Date; error?: unknown }];
    expect(saved.status).toBe('failed');
    expect(saved.completedAt).toBeInstanceOf(Date);
    expect(saved.error).toEqual({ error: 'boom' });
  });

  it('omits the error field entirely when none is given', async () => {
    const { service, findOne, save } = makeService();
    (findOne as jest.Mock)
      .mockResolvedValueOnce({ id: 'job-1', userId: USER })
      .mockResolvedValueOnce({ id: 'job-1', userId: USER, status: 'success' });

    await service.markAsCompleted(CONTEXT, 'job-1', 'success');

    const [saved] = save.mock.calls[0] as [{ error?: unknown }];
    expect('error' in saved).toBe(false);
  });
});
