import type { Repository } from 'typeorm';

import type { UserServiceContext } from '@ci/common/context';
import type { LoggerService } from '@ci/common/logging';

import type { PlaceClusterEntity } from '../../entities/PlaceClusterEntity';
import { PlaceClusterService } from '../PlaceClusterService';

const USER = '00000000-0000-0000-0000-0000000000aa';
const CONTEXT: UserServiceContext = { userId: USER };
// Mirrors the private POSITION_PAGE_SIZE constant in PlaceClusterService.
const PAGE_SIZE = 10_000;

function logger(): LoggerService {
  return {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as LoggerService;
}

function fixRow(isoTime: string, lat = 1, lng = 2) {
  return { time: isoTime, lat, lng };
}

/** Builds `count` rows with distinct, strictly increasing timestamps starting at `startMs`. */
function fullPage(count: number, startMs: number) {
  return Array.from({ length: count }, (_, i) => fixRow(new Date(startMs + i * 1000).toISOString()));
}

function makeService(query: jest.Mock) {
  const repo = { query } as unknown as Repository<PlaceClusterEntity>;

  return new PlaceClusterService(repo, logger());
}

describe('PlaceClusterService.getPositionWindow keyset pagination', () => {
  it('returns everything and stops after one query when the first page is already short', async () => {
    const query = jest
      .fn()
      .mockResolvedValue([fixRow('2026-08-01T00:00:00.000Z'), fixRow('2026-08-01T00:01:00.000Z')]);
    const service = makeService(query);

    const from = new Date('2026-08-01T00:00:00.000Z');
    const to = new Date('2026-08-02T00:00:00.000Z');
    const fixes = await service.getPositionWindow(CONTEXT, from, to);

    expect(fixes).toHaveLength(2);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(expect.any(String), [
      USER,
      from.toISOString(),
      to.toISOString(),
      expect.any(Number),
      PAGE_SIZE,
    ]);
  });

  it('returns an empty array on an empty window without ever looping', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const service = makeService(query);

    const fixes = await service.getPositionWindow(
      CONTEXT,
      new Date('2026-08-01T00:00:00.000Z'),
      new Date('2026-08-02T00:00:00.000Z'),
    );

    expect(fixes).toEqual([]);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('pages past a full first page, advancing the cursor to the last row of the previous page (no gap, no duplicate)', async () => {
    const from = new Date('2026-08-01T00:00:00.000Z');
    const to = new Date('2026-08-10T00:00:00.000Z');
    const page1 = fullPage(PAGE_SIZE, from.getTime());
    const lastOfPage1 = page1[page1.length - 1].time;
    const page2 = [fixRow('2026-08-09T00:00:00.000Z')];

    const query = jest.fn().mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);
    const service = makeService(query);

    const fixes = await service.getPositionWindow(CONTEXT, from, to);

    expect(query).toHaveBeenCalledTimes(2);
    // Second call's cursor ($2) must be exactly the last row's time from page 1 — the SQL uses
    // `pos.time > $2` (strict), so re-querying from that exact value is what makes each fetched
    // row appear exactly once instead of being dropped or duplicated across the page boundary.
    expect(query.mock.calls[1][1][1]).toBe(lastOfPage1);
    // All of page 1 plus page 2 come back, nothing silently truncated.
    expect(fixes).toHaveLength(PAGE_SIZE + 1);
  });

  it('keeps paging across three full pages before a short page ends the loop', async () => {
    const from = new Date('2026-08-01T00:00:00.000Z');
    const to = new Date('2026-08-20T00:00:00.000Z');
    const page1 = fullPage(PAGE_SIZE, from.getTime());
    const page2 = fullPage(PAGE_SIZE, from.getTime() + 100_000_000);
    const page3 = [fixRow('2026-08-19T00:00:00.000Z')];

    const query = jest
      .fn()
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce(page2)
      .mockResolvedValueOnce(page3);
    const service = makeService(query);

    const fixes = await service.getPositionWindow(CONTEXT, from, to);

    expect(query).toHaveBeenCalledTimes(3);
    expect(fixes).toHaveLength(2 * PAGE_SIZE + 1);
    // Every call after the first must be re-anchored on the previous page's own last fix, not
    // stuck replaying the original `from` — otherwise the loop either never terminates or
    // re-fetches (and re-counts) the same page forever.
    expect(query.mock.calls[1][1][1]).toBe(page1[page1.length - 1].time);
    expect(query.mock.calls[2][1][1]).toBe(page2[page2.length - 1].time);
  });
});
