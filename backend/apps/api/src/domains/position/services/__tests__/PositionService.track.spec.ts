import type { Repository } from 'typeorm';

import type { UserServiceContext } from '@ci/common/context';
import type { LoggerService } from '@ci/common/logging';
import type { DeviceService } from '@ci/domains/devices';
import type { EventService } from '@ci/domains/events';

import type { PositionEntity } from '../../entities/PositionEntity';
import { PositionService, type TrackOptions } from '../PositionService';
import { decodeTrackCursor, encodeTrackCursor } from '../positionTrack';

const ctx = { userId: '00000000-0000-0000-0000-0000000000aa' } as UserServiceContext;
const OTHER_USER = { userId: '00000000-0000-0000-0000-0000000000bb' } as UserServiceContext;

/** The live table's real extent, so the derived bucket is the one production sees. */
const FIRST_FIX = new Date('2013-05-28T21:02:08.000Z');
const LAST_FIX = new Date('2026-08-21T04:56:01.296Z');

type Executed = { sql: string; params: unknown[] };

interface Harness {
  service: PositionService;
  executed: Executed[];
  /** The page read — the one query that is either bucketed or raw. */
  page(): Executed;
  count(): Executed | undefined;
}

/**
 * A PositionService wired to a recording query runner.
 *
 * `manager.query` is dispatched by shape rather than by call order because
 * `findTrack` issues its span read, its page read and its count read on
 * different paths (a continuation skips two of the three), and a positional
 * mock would silently answer the wrong one.
 */
function makeService({ rows = [] as Record<string, unknown>[], total = 0 } = {}): Harness {
  const executed: Executed[] = [];

  const query = jest.fn(async (sql: string, params: unknown[]) => {
    executed.push({ sql, params });

    if (sql.includes('min(time)')) {
      return [{ from_time: FIRST_FIX, to_time: LAST_FIX }];
    }

    if (sql.includes('count(*) AS n')) {
      return [{ n: String(total) }];
    }

    return rows;
  });

  const repository = { manager: { query } } as unknown as Repository<PositionEntity>;
  const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() } as unknown as LoggerService;

  return {
    service: new PositionService(
      repository,
      {} as unknown as DeviceService,
      {} as unknown as EventService,
      logger,
    ),
    executed,
    page: () =>
      executed.find((call) => /FROM ci\.position p/.test(call.sql) && !call.sql.includes('count(*) AS n'))!,
    count: () => executed.find((call) => call.sql.includes('count(*) AS n')),
  };
}

/** One row as the bucketed query hands it back. */
function bucketRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    started_at: new Date('2016-04-07T00:38:54.000Z'),
    ended_at: new Date('2016-04-08T01:00:00.000Z'),
    fix_count: 7,
    latitude: '34.0579389',
    longitude: '-118.3049389',
    activity_type: 'in_vehicle',
    ...over,
  };
}

function run(harness: Harness, options: TrackOptions = {}, context = ctx) {
  return harness.service.findTrack(context, options);
}

describe('PositionService.findTrack — user scoping', () => {
  it('scopes every read to the caller, as the FIRST bound parameter', async () => {
    const harness = makeService({ rows: [bucketRow()], total: 63_044 });

    await run(harness, { bbox: [-122.6, 37.6, -122.2, 37.9] });

    // Span read, page read and count read: all three, no exceptions.
    expect(harness.executed).toHaveLength(3);

    for (const call of harness.executed) {
      expect(call.sql).toMatch(/user_id = \$1/);
      expect(call.params[0]).toBe(ctx.userId);
    }
  });

  it('never emits a filter-free read, whatever the caller passes', async () => {
    const harness = makeService({ rows: [] });

    await run(harness, { first: 5_000, maxPoints: 0, bbox: [-180, -90, 180, 90] });

    // maxPoints:0 is raw and the world bbox is dropped — the two widest inputs
    // available — and the user predicate still stands.
    expect(harness.page().sql).toContain('p.user_id = $1');
  });

  it('answers a different caller with a different scope', async () => {
    const harness = makeService({ rows: [bucketRow()] });

    await run(harness, {}, OTHER_USER);

    expect(harness.page().params[0]).toBe(OTHER_USER.userId);
    expect(harness.page().params).not.toContain(ctx.userId);
  });
});

describe('PositionService.findTrack — downsampling', () => {
  it("buckets a thirteen-year window to the caller's point budget", async () => {
    const harness = makeService({ rows: [bucketRow()] });

    const page = await run(harness, { maxPoints: 2_000 });

    const span = LAST_FIX.getTime() - FIRST_FIX.getTime();
    const expected = Math.ceil(span / 1000 / 2_000);

    expect(page.bucketSeconds).toBe(expected);
    expect(harness.page().sql).toContain('time_bucket(make_interval(secs =>');
    expect(harness.page().params).toContain(expected);
  });

  it('groups and orders by the bucket, which is what makes the time cursor valid', async () => {
    const harness = makeService({ rows: [bucketRow()] });

    await run(harness, {});

    // Chronological group order is load-bearing: `time > cursor` can only
    // continue a page whose rows are in time order.
    expect(harness.page().sql).toContain('GROUP BY bucket_start');
    expect(harness.page().sql).toContain('ORDER BY bucket_start');
  });

  it("takes each bucket's first REAL fix, never an average of it", async () => {
    const harness = makeService({ rows: [bucketRow()] });

    await run(harness, {});

    // A bucket spanning a flight averages to a point in the ocean. The map must
    // only ever draw somewhere the user actually was.
    expect(harness.page().sql).toContain('first(ST_Y(p.location::geometry), p.time)');
    expect(harness.page().sql).toContain('first(ST_X(p.location::geometry), p.time)');
    expect(harness.page().sql).not.toMatch(/avg\(/);
  });

  it('reports the bucket weight so a heat layer is honest about density', async () => {
    const harness = makeService({ rows: [bucketRow({ fix_count: 4_129 })] });

    const page = await run(harness, {});

    expect(harness.page().sql).toContain('count(*)::int AS fix_count');
    expect(page.points[0].fixCount).toBe(4_129);
  });

  it('reads raw fixes when the caller switches downsampling off', async () => {
    const harness = makeService({ rows: [bucketRow({ fix_count: 1 })] });

    const page = await run(harness, { maxPoints: 0 });

    expect(page.bucketSeconds).toBeNull();
    expect(harness.page().sql).not.toContain('time_bucket');
    expect(harness.page().sql).toContain('ORDER BY p.time');
    // Raw mode must not bind a bucket: Postgres rejects a bind supplying a
    // parameter the statement never mentions.
    expect(harness.page().sql).not.toContain('make_interval');
  });

  it('reads raw fixes for a window too narrow to be worth bucketing', async () => {
    const harness = makeService({ rows: [] });

    const page = await run(harness, {
      startTime: new Date('2026-08-20T10:00:00Z'),
      endTime: new Date('2026-08-20T10:05:00Z'),
    });

    expect(page.bucketSeconds).toBeNull();
    // A bounded window is its own span — no min/max round trip needed.
    expect(harness.executed.some((call) => call.sql.includes('min(time)'))).toBe(false);
  });
});

describe('PositionService.findTrack — filters', () => {
  it('pushes the time range down to SQL as a half-open interval', async () => {
    const harness = makeService({ rows: [] });
    const startTime = new Date('2024-01-01T00:00:00Z');
    const endTime = new Date('2024-02-01T00:00:00Z');

    await run(harness, { startTime, endTime });

    expect(harness.page().sql).toMatch(/p\.time >= \$\d+/);
    expect(harness.page().sql).toMatch(/p\.time < \$\d+/);
    expect(harness.page().params).toContain(startTime);
    expect(harness.page().params).toContain(endTime);
  });

  it('pushes the viewport down as an indexed geography overlap', async () => {
    const harness = makeService({ rows: [] });

    await run(harness, { bbox: [-122.6, 37.6, -122.2, 37.9] });

    // `&&` on the geography is what position_location_idx answers; the explicit
    // IS NOT NULL matches that index's own partial predicate.
    expect(harness.page().sql).toContain('p.location && ST_MakeEnvelope(');
    expect(harness.page().sql).toContain('p.location IS NOT NULL');
    expect(harness.page().params).toEqual(expect.arrayContaining([-122.6, 37.6, -122.2, 37.9]));
  });

  it('ORs two envelopes for a viewport straddling the antimeridian', async () => {
    const harness = makeService({ rows: [] });

    await run(harness, { bbox: [170, -20, 190, 20] });

    expect(harness.page().sql).toMatch(/ST_MakeEnvelope\([^)]*\)::geography OR .*ST_MakeEnvelope/s);
    expect(harness.page().params).toEqual(expect.arrayContaining([170, 180, -180, -170]));
  });

  it('drops a viewport wider than a valid geodesic envelope rather than narrowing to its complement', async () => {
    const harness = makeService({ rows: [] });

    await run(harness, { bbox: [-180, -90, 180, 90] });

    expect(harness.page().sql).not.toContain('ST_MakeEnvelope');
  });

  it('counts against the same predicates the page was cut from', async () => {
    const harness = makeService({ rows: [bucketRow()], total: 41_964 });
    const bbox = [-119, 33, -117, 35];

    const page = await run(harness, { bbox, startTime: new Date('2024-01-01T00:00:00Z') });

    expect(page.totalCount).toBe(41_964);
    // A truncated trace and the total it is truncated against must describe the
    // same set of fixes, or the status line lies.
    expect(harness.count()!.sql).toContain('ST_MakeEnvelope');
    expect(harness.count()!.params).toEqual(expect.arrayContaining([...bbox, ctx.userId]));
  });
});

describe('PositionService.findTrack — keyset paging', () => {
  it('over-fetches by one so hasNextPage is a fact, not a guess', async () => {
    const rows = Array.from({ length: 4 }, (_unused, index) =>
      bucketRow({ ended_at: new Date(`2020-01-0${index + 1}T00:00:00.000Z`) }),
    );
    const harness = makeService({ rows });

    const page = await run(harness, { first: 3 });

    expect(harness.page().params).toContain(4);
    expect(page.points).toHaveLength(3);
    expect(page.hasNextPage).toBe(true);
  });

  it('reports the end of the walk when the over-fetch comes back short', async () => {
    const harness = makeService({ rows: [bucketRow(), bucketRow()] });

    const page = await run(harness, { first: 3 });

    expect(page.points).toHaveLength(2);
    expect(page.hasNextPage).toBe(false);
  });

  it('cuts the cursor at the LAST instant the point consumed', async () => {
    const endedAt = new Date('2016-04-08T01:00:00.000Z');
    const harness = makeService({ rows: [bucketRow({ ended_at: endedAt })] });

    const page = await run(harness, { maxPoints: 2_000 });

    // A bucket's max(time) is strictly past every row the page consumed and
    // strictly before every row it did not — so `time > cursor` can neither
    // re-emit nor skip a fix.
    expect(decodeTrackCursor(page.endCursor)!.time).toEqual(endedAt);
    expect(page.endCursor).toBe(page.points[0].cursor);
  });

  it('continues with a keyset predicate, never an OFFSET', async () => {
    const after = encodeTrackCursor(new Date('2016-04-08T01:00:00.000Z'), 207_360);
    const harness = makeService({ rows: [bucketRow()] });

    await run(harness, { after });

    expect(harness.page().sql).toMatch(/p\.time > \$\d+/);
    expect(harness.page().sql).not.toMatch(/OFFSET/i);
    expect(harness.page().params).toContainEqual(new Date('2016-04-08T01:00:00.000Z'));
  });

  it('inherits the bucket from the cursor rather than re-deriving it mid-walk', async () => {
    const after = encodeTrackCursor(new Date('2016-04-08T01:00:00.000Z'), 3_600);
    const harness = makeService({ rows: [bucketRow()] });

    const page = await run(harness, { after, maxPoints: 2_000 });

    // maxPoints:2000 over the live span would derive ~207,360s. The cursor's
    // 3,600 wins, or the continuation would cut its groups on different
    // boundaries than the page before it.
    expect(page.bucketSeconds).toBe(3_600);
    expect(harness.page().params).toContain(3_600);
    expect(harness.executed.some((call) => call.sql.includes('min(time)'))).toBe(false);
  });

  it('counts once per walk, on the first page only', async () => {
    const first = makeService({ rows: [bucketRow()], total: 63_044 });
    const next = makeService({ rows: [bucketRow()], total: 63_044 });

    expect((await run(first, {})).totalCount).toBe(63_044);
    expect(first.count()).toBeDefined();

    const continuation = await run(next, {
      after: encodeTrackCursor(new Date('2020-01-01T00:00:00Z'), 207_360),
    });

    // A COUNT(*) is a second scan of the same rows and its answer cannot change
    // between pages of one walk.
    expect(continuation.totalCount).toBeNull();
    expect(next.count()).toBeUndefined();
  });

  it('has no cursor to hand back for an empty page', async () => {
    const harness = makeService({ rows: [] });

    const page = await run(harness, {});

    expect(page.points).toEqual([]);
    expect(page.endCursor).toBeNull();
    expect(page.hasNextPage).toBe(false);
  });
});

describe('PositionService.findTrack — projection', () => {
  it('projects a row to a drawable point', async () => {
    const harness = makeService({ rows: [bucketRow()] });

    const page = await run(harness, {});

    expect(page.points[0]).toEqual({
      startTime: new Date('2016-04-07T00:38:54.000Z'),
      endTime: new Date('2016-04-08T01:00:00.000Z'),
      latitude: 34.0579389,
      longitude: -118.3049389,
      fixCount: 7,
      activityType: 'in_vehicle',
      cursor: expect.any(String),
    });
  });

  it('coerces the numeric strings node-postgres hands back for ST_X/ST_Y', async () => {
    const harness = makeService({ rows: [bucketRow({ latitude: '34.0', longitude: '-118.3' })] });

    const page = await run(harness, {});

    expect(typeof page.points[0].latitude).toBe('number');
    expect(typeof page.points[0].longitude).toBe('number');
  });
});
