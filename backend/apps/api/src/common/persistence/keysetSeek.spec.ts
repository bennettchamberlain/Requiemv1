import { keysetOrderOf, keysetSeek } from './keysetSeek';

/**
 * What the predicate MEANS, against real rows in Postgres, is held by
 * `graphql/resolvers/__tests__/SearchResolver.timedOrder.integration.spec.ts`. This file pins what
 * is written and what is bound.
 */
describe('keysetOrderOf', () => {
  it.each([
    ['ASC', 'ASC'],
    ['asc', 'ASC'],
    ['DESC', 'DESC'],
    ['desc', 'DESC'],
    [{ startTime: 'ASC' }, 'ASC'],
    [{ time: 'asc' }, 'ASC'],
    [{ startTime: 'DESC' }, 'DESC'],
    // Nothing asked for: newest first, as every caller that passes no order has always had.
    [undefined, 'DESC'],
    [null, 'DESC'],
    [{}, 'DESC'],
    ['sideways', 'DESC'],
    [1, 'DESC'],
  ])('reads %j as %s', (order, expected) => {
    expect(keysetOrderOf(order)).toBe(expected);
  });

  it('lets the first key of an order object decide, as the primary sort does', () => {
    expect(keysetOrderOf({ startTime: 'ASC', endTime: 'DESC' })).toBe('ASC');
    expect(keysetOrderOf({ startTime: 'DESC', endTime: 'ASC' })).toBe('DESC');
  });
});

describe('keysetSeek', () => {
  const afterTime = new Date('2026-05-01T00:00:00.123Z');
  const afterId = '018f0000-0000-7000-8000-00000000abcd';

  it('binds the cursor, and the first instant of the millisecond after it', () => {
    const [, params] = keysetSeek('note.updated_at', 'note.id', 'ASC', afterTime, afterId);

    expect(params).toEqual({
      afterTime,
      afterTimeEnd: new Date('2026-05-01T00:00:00.124Z'),
      afterId,
    });

    // The cursor itself is handed through untouched, not rewritten.
    expect(params.afterTime).toBe(afterTime);
  });

  it('carries the end of the bucket across a second, a day and a month boundary', () => {
    const [, params] = keysetSeek(
      'note.updated_at',
      'note.id',
      'DESC',
      new Date('2026-04-30T23:59:59.999Z'),
      afterId,
    );

    expect(params.afterTimeEnd.toISOString()).toBe('2026-05-01T00:00:00.000Z');
  });

  it('seeks upwards for ASC: later buckets, or this bucket past the id', () => {
    const [sql] = keysetSeek('note.updated_at', 'note.id', 'ASC', afterTime, afterId);

    expect(sql).toBe(
      '(note.updated_at >= :afterTime AND (note.updated_at >= :afterTimeEnd OR ' +
        '(note.updated_at >= :afterTime AND note.updated_at < :afterTimeEnd AND note.id > :afterId)))',
    );
  });

  it('seeks downwards for DESC: earlier buckets, or this bucket before the id', () => {
    const [sql] = keysetSeek('note.updated_at', 'note.id', 'DESC', afterTime, afterId);

    expect(sql).toBe(
      '(note.updated_at < :afterTimeEnd AND (note.updated_at < :afterTime OR ' +
        '(note.updated_at >= :afterTime AND note.updated_at < :afterTimeEnd AND note.id < :afterId)))',
    );
  });

  it('never compares the time for equality, which no microsecond value could satisfy', () => {
    for (const order of ['ASC', 'DESC'] as const) {
      const [sql] = keysetSeek('note.updated_at', 'note.id', order, afterTime, afterId);

      expect(sql).not.toMatch(/updated_at\s*=/);
    }
  });

  it('writes the expressions it is given, so a computed ordering key seeks on the same expression', () => {
    const key = 'COALESCE(receipt.purchased_at, receipt.updated_at)';
    const [sql] = keysetSeek(key, 'receipt.receipt_id', 'ASC', afterTime, afterId);

    expect(sql.split(key)).toHaveLength(5);
    expect(sql).toContain('receipt.receipt_id > :afterId');
  });
});
