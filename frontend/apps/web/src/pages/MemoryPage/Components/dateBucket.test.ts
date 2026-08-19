import { describe, expect, it } from 'vitest';

import type { EntityItem } from '../useEntityService';

import {
  formatLoadedCount,
  getDateBucket,
  getEntityTimestamp,
  groupEntitiesByBucket,
  isChronologicalSort,
  orderDatedFirst,
} from './utils';

const entity = (shape: Record<string, unknown>) => shape as unknown as EntityItem;

// Thursday, 15 Jan 2026 — fixed reference so day/week/month boundaries are
// deterministic. The guard below fails loudly if that weekday assumption breaks.
const NOW = new Date(2026, 0, 15, 12, 0, 0);

describe('getDateBucket', () => {
  it('uses Thursday as the reference weekday (guards the fixtures below)', () => {
    expect(NOW.getDay()).toBe(4);
  });

  it('labels the same day as Today', () => {
    expect(getDateBucket(new Date(2026, 0, 15, 8, 0, 0), NOW).label).toBe('Today');
  });

  it('labels the prior day as Yesterday', () => {
    expect(getDateBucket(new Date(2026, 0, 14), NOW).label).toBe('Yesterday');
  });

  it('labels earlier-this-week days as This Week', () => {
    // Week starts Sunday Jan 11; Monday Jan 12 is before yesterday but in-week.
    expect(getDateBucket(new Date(2026, 0, 12), NOW).label).toBe('This Week');
  });

  it('labels earlier-this-month days as This Month', () => {
    // Month starts Jan 1; Jan 5 is before this week's Sunday.
    expect(getDateBucket(new Date(2026, 0, 5), NOW).label).toBe('This Month');
  });

  it('labels older dates as "Month Year" with a year-month key', () => {
    const bucket = getDateBucket(new Date(2025, 11, 20), NOW);
    expect(bucket.label).toBe('December 2025');
    expect(bucket.key).toBe('2025-11');
  });
});

describe('getEntityTimestamp', () => {
  it('reads bucketStartTime for events (Date instance)', () => {
    const date = new Date('2026-01-10T10:00:00Z');
    expect(getEntityTimestamp(entity({ __typename: 'EventType', bucketStartTime: date }))).toEqual(date);
  });

  it('reads bucketTime for communications (string)', () => {
    expect(
      getEntityTimestamp(entity({ __typename: 'CommunicationType', bucketTime: '2026-01-10T10:00:00Z' })),
    ).toEqual(new Date('2026-01-10T10:00:00Z'));
  });

  it('returns null for an unparseable timestamp', () => {
    expect(getEntityTimestamp(entity({ __typename: 'EventType', bucketStartTime: 'not-a-date' }))).toBeNull();
  });

  it('returns null for entity types with no domain timestamp', () => {
    expect(getEntityTimestamp(entity({ __typename: 'PersonType' }))).toBeNull();
  });
});

describe('groupEntitiesByBucket', () => {
  const event = (iso: string) => entity({ __typename: 'EventType', bucketStartTime: iso });

  it('merges contiguous entities sharing a bucket', () => {
    const groups = groupEntitiesByBucket([event('2026-01-15T09:00:00'), event('2026-01-15T11:00:00')], NOW);

    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('Today');
    expect(groups[0].entities).toHaveLength(2);
  });

  it('starts a new group when the bucket changes, with unique keys', () => {
    const groups = groupEntitiesByBucket(
      [event('2026-01-15T09:00:00'), event('2025-06-01T09:00:00'), event('2026-01-15T13:00:00')],
      NOW,
    );

    expect(groups.map((g) => g.label)).toEqual(['Today', 'June 2025', 'Today']);
    // Same bucket recurs non-contiguously, but the React keys stay distinct.
    expect(new Set(groups.map((g) => g.key)).size).toBe(3);
  });

  it('places entities without a timestamp in the "No date" bucket', () => {
    const groups = groupEntitiesByBucket([entity({ __typename: 'PersonType' })], NOW);

    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('No date');
    expect(groups[0].bucket).toBe('undated');
  });

  // The server orders undated types by row-write time, so a bulk import
  // interleaves them through the dated run. Emitting a header per contiguous
  // run gave alternating "No date" / "Today" sections; there is now exactly
  // one, at the end.
  it('collects interleaved undated entities into a single trailing group', () => {
    const person = () => entity({ __typename: 'PersonType' });
    const groups = groupEntitiesByBucket(
      [person(), event('2026-01-15T09:00:00'), person(), event('2025-06-01T09:00:00'), person()],
      NOW,
    );

    expect(groups.map((g) => g.label)).toEqual(['Today', 'June 2025', 'No date']);
    expect(groups[groups.length - 1].entities).toHaveLength(3);
    expect(new Set(groups.map((g) => g.key)).size).toBe(3);
  });

  it('emits no "No date" group when every entity is dated', () => {
    const groups = groupEntitiesByBucket([event('2026-01-15T09:00:00')], NOW);

    expect(groups.map((g) => g.bucket)).toEqual(['today']);
  });
});

describe('orderDatedFirst', () => {
  const event = (iso: string) => entity({ __typename: 'EventType', bucketStartTime: iso });
  const person = (id: string) => entity({ __typename: 'PersonType', id });

  it('moves undated entities to the end, preserving order within each half', () => {
    const a = person('a');
    const e1 = event('2026-01-15T09:00:00');
    const b = person('b');
    const e2 = event('2025-06-01T09:00:00');

    expect(orderDatedFirst([a, e1, b, e2])).toEqual([e1, e2, a, b]);
  });

  it('returns the input untouched when everything is dated', () => {
    const input = [event('2026-01-15T09:00:00'), event('2025-06-01T09:00:00')];

    expect(orderDatedFirst(input)).toBe(input);
  });

  it('keeps an all-undated page in server order', () => {
    const input = [person('a'), person('b')];

    expect(orderDatedFirst(input)).toEqual(input);
  });
});

describe('formatLoadedCount', () => {
  it('shows the total as a denominator, thousands-separated', () => {
    expect(formatLoadedCount({ loaded: 30, totalCount: 141639, loadingMore: false, hasNextPage: true })).toBe(
      '30 of 141,639 loaded',
    );
  });

  it('marks the end of the result set', () => {
    expect(formatLoadedCount({ loaded: 12, totalCount: 12, loadingMore: false, hasNextPage: false })).toBe(
      '12 of 12 loaded · end',
    );
  });

  it('marks an in-flight page', () => {
    expect(formatLoadedCount({ loaded: 30, totalCount: 900, loadingMore: true, hasNextPage: true })).toBe(
      '30 of 900 loaded · loading…',
    );
  });

  // totalCount is 0 until the first page resolves, and a stale/undercounted
  // total must never read as fewer results than are already on screen.
  it('omits the denominator when the server supplied none or it lags the page', () => {
    expect(formatLoadedCount({ loaded: 0, totalCount: 0, loadingMore: true, hasNextPage: false })).toBe(
      '0 loaded · loading…',
    );
    expect(formatLoadedCount({ loaded: 30, totalCount: 10, loadingMore: false, hasNextPage: true })).toBe(
      '30 loaded',
    );
  });
});

describe('isChronologicalSort', () => {
  it('is true for an explicit time sort', () => {
    expect(isChronologicalSort('time')).toBe(true);
  });

  it('is false for relevance and name sorts', () => {
    expect(isChronologicalSort('relevance')).toBe(false);
    expect(isChronologicalSort('name')).toBe(false);
  });

  it('defaults to time order only when there is no free-text query', () => {
    expect(isChronologicalSort(undefined, false)).toBe(true);
    expect(isChronologicalSort(undefined, true)).toBe(false);
    expect(isChronologicalSort(null)).toBe(true);
  });
});
