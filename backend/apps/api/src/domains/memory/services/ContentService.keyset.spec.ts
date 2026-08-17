import type { UserServiceContext } from '@ci/common/context';

import { ContentService } from './ContentService';

const USER = '00000000-0000-0000-0000-0000000000aa';
const CONTEXT: UserServiceContext = { userId: USER } as UserServiceContext;

interface RecordedQuery {
  wheres: Array<{ sql: string; params?: Record<string, unknown> }>;
  orderBy: Array<[string, string]>;
  limit?: number;
}

/**
 * Minimal SelectQueryBuilder stand-in that records the SQL fragments
 * getEntitiesForContents assembles, so the keyset predicate and the tiebreak
 * ordering can be asserted without a database.
 */
function makeService(rows: Array<{ id: string }> = []) {
  const recorded: RecordedQuery = { wheres: [], orderBy: [] };

  const qb: Record<string, unknown> = {};
  qb.select = jest.fn(() => qb);
  qb.where = jest.fn((sql: string, params?: Record<string, unknown>) => {
    recorded.wheres.push({ sql, params });

    return qb;
  });
  qb.andWhere = jest.fn((sql: string, params?: Record<string, unknown>) => {
    recorded.wheres.push({ sql, params });

    return qb;
  });
  qb.orderBy = jest.fn((column: string, direction: string) => {
    recorded.orderBy.push([column, direction]);

    return qb;
  });
  qb.addOrderBy = jest.fn((column: string, direction: string) => {
    recorded.orderBy.push([column, direction]);

    return qb;
  });
  qb.limit = jest.fn((value: number) => {
    recorded.limit = value;

    return qb;
  });
  qb.getRawMany = jest.fn(async () => rows);

  const contentRepository = { createQueryBuilder: jest.fn(() => qb) };

  const service = new ContentService(
    contentRepository as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  return { service, recorded };
}

describe('ContentService.getEntitiesForContents keyset paging', () => {
  const afterTime = new Date('2026-08-16T07:56:56.949Z');
  const afterId = '018f0000-0000-7000-8000-00000000abcd';

  it('pages strictly past (afterTime, afterId) when both are supplied', async () => {
    const { service, recorded } = makeService();

    await service.getEntitiesForContents(CONTEXT, { limit: 20, afterTime, afterId });

    const keyset = recorded.wheres.find((where) => where.sql.includes(':afterTime'));

    expect(keyset).toBeDefined();
    expect(keyset!.sql).toBe(
      '(content.created_at < :afterTime OR (content.created_at = :afterTime AND content.id < :afterId))',
    );
    expect(keyset!.params).toEqual({ afterTime, afterId });
  });

  it('orders by created_at then id so same-timestamp rows page deterministically', async () => {
    const { service, recorded } = makeService();

    await service.getEntitiesForContents(CONTEXT, { limit: 20, afterTime, afterId });

    expect(recorded.orderBy).toEqual([
      ['content.created_at', 'DESC'],
      ['content.id', 'DESC'],
    ]);
  });

  it('omits the keyset predicate when only one half of the cursor is present', async () => {
    for (const options of [{ afterTime }, { afterId }]) {
      const { service, recorded } = makeService();

      await service.getEntitiesForContents(CONTEXT, { limit: 20, ...options });

      expect(recorded.wheres.some((where) => where.sql.includes(':afterTime'))).toBe(false);
    }
  });

  it('keeps the start/end window independent of the cursor', async () => {
    const { service, recorded } = makeService();
    const startTime = new Date('2026-01-01T00:00:00.000Z');
    const endTime = new Date('2026-12-31T00:00:00.000Z');

    await service.getEntitiesForContents(CONTEXT, { limit: 20, startTime, endTime, afterTime, afterId });

    expect(recorded.wheres.map((where) => where.sql)).toEqual([
      'content.user_id = :userId',
      'content.created_at >= :startTime',
      'content.created_at <= :endTime',
      '(content.created_at < :afterTime OR (content.created_at = :afterTime AND content.id < :afterId))',
    ]);
  });
});
