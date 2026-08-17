import {
  backoffNextPlace,
  buildHeatGrid,
  buildTransitionBuckets,
  circularHourDistance,
  decayWeight,
  globalVisitPrior,
  hourDowInTz,
  type TransitionBucket,
} from './transitionMath';

const DAY_MS = 86_400_000;

describe('decayWeight', () => {
  it('halves every half-life', () => {
    expect(decayWeight(0)).toBe(1);
    expect(decayWeight(30 * DAY_MS)).toBeCloseTo(0.5, 10);
    expect(decayWeight(60 * DAY_MS)).toBeCloseTo(0.25, 10);
  });

  it('clamps negative ages (future timestamps) to weight 1', () => {
    expect(decayWeight(-5 * DAY_MS)).toBe(1);
  });
});

describe('hourDowInTz', () => {
  it('uses UTC fields for the UTC timezone', () => {
    // 2026-07-08 is a Wednesday.
    expect(hourDowInTz(new Date('2026-07-08T00:30:00Z'), 'UTC')).toEqual({ hour: 0, dow: 3 });
  });

  it('converts into the requested timezone', () => {
    // 00:30 UTC on Wed Jul 8 is 20:30 EDT on Tue Jul 7.
    expect(hourDowInTz(new Date('2026-07-08T00:30:00Z'), 'America/New_York')).toEqual({
      hour: 20,
      dow: 2,
    });
  });
});

describe('buildTransitionBuckets', () => {
  const now = new Date('2026-07-08T12:00:00Z');

  const visit = (clusterId: string, startIso: string) => ({
    clusterId,
    start: new Date(startIso),
    end: new Date(new Date(startIso).getTime() + 30 * 60_000),
  });

  it('buckets consecutive-pair transitions by arrival hour/dow with decayed weights', () => {
    const visits = [
      visit('A', '2026-07-08T08:00:00Z'), // Wed
      visit('B', '2026-07-08T09:00:00Z'), // A -> B at Wed 09
    ];

    const buckets = buildTransitionBuckets(visits, { now });

    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toMatchObject({ fromCluster: 'A', toCluster: 'B', hourBucket: 9, dow: 3 });
    // 3 hours old at a 30-day half-life: 2^(-(3/24)/30).
    expect(buckets[0].decayedCount).toBeCloseTo(2 ** (-3 / 24 / 30), 10);
  });

  it('aggregates repeats of the same bucket and skips self-transitions', () => {
    const visits = [
      visit('A', '2026-07-01T08:00:00Z'), // Wed
      visit('A', '2026-07-01T08:40:00Z'), // self-pair — not a transition
      visit('B', '2026-07-01T09:00:00Z'), // A -> B, Wed 09
      visit('A', '2026-07-01T11:00:00Z'), // B -> A, Wed 11
      visit('B', '2026-07-08T09:00:00Z'), // A -> B, Wed 09 again (a week later)
    ];

    const buckets = buildTransitionBuckets(visits, { now });
    const aToB = buckets.find((b) => b.fromCluster === 'A' && b.toCluster === 'B');

    expect(buckets).toHaveLength(2);
    expect(aToB).toMatchObject({ hourBucket: 9, dow: 3 });
    const weekOld = 2 ** (-(7 * DAY_MS + 3 * 3_600_000) / DAY_MS / 30);
    const threeHoursOld = 2 ** (-3 / 24 / 30);
    expect(aToB!.decayedCount).toBeCloseTo(weekOld + threeHoursOld, 10);
  });
});

describe('circularHourDistance', () => {
  it('wraps around midnight', () => {
    expect(circularHourDistance(23, 0)).toBe(1);
    expect(circularHourDistance(9, 10)).toBe(1);
    expect(circularHourDistance(9, 21)).toBe(12);
  });
});

describe('backoffNextPlace', () => {
  const bucket = (
    toCluster: string,
    hourBucket: number,
    dow: number,
    decayedCount: number,
  ): TransitionBucket => ({ fromCluster: 'A', toCluster, hourBucket, dow, decayedCount });

  const rows = [
    bucket('B', 9, 1, 3),
    bucket('C', 9, 1, 1),
    bucket('D', 10, 4, 4), // adjacent hour, other dow
    bucket('E', 15, 4, 2), // far hour
  ];

  it('level 1: exact (hour, dow) counts normalize to known probabilities', () => {
    const result = backoffNextPlace(rows, 9, 1, 5);

    expect(result?.level).toBe('FROM_HOUR_DOW');
    expect(result?.ranked).toEqual([
      { clusterId: 'B', probability: 0.75 },
      { clusterId: 'C', probability: 0.25 },
    ]);
  });

  it('level 2: no exact bucket falls back to hour +/- 1 across dows', () => {
    const result = backoffNextPlace(rows, 9, 5, 5);

    expect(result?.level).toBe('FROM_HOUR_ADJACENT');
    // Buckets at hours 9 and 10 qualify: B 3, C 1, D 4 — total 8.
    expect(result?.ranked).toEqual([
      { clusterId: 'D', probability: 0.5 },
      { clusterId: 'B', probability: 0.375 },
      { clusterId: 'C', probability: 0.125 },
    ]);
  });

  it('level 3: a far-off hour uses every transition out of the cluster', () => {
    const result = backoffNextPlace([bucket('E', 15, 4, 2)], 3, 0, 5);

    expect(result?.level).toBe('FROM_ANY');
    expect(result?.ranked).toEqual([{ clusterId: 'E', probability: 1 }]);
  });

  it('respects k and returns null with no transitions at all', () => {
    expect(backoffNextPlace(rows, 9, 5, 1)?.ranked).toHaveLength(1);
    expect(backoffNextPlace([], 9, 1, 5)).toBeNull();
  });
});

describe('globalVisitPrior', () => {
  it('normalizes visit counts and excludes the current cluster', () => {
    const clusters = [
      { id: 'home', visitCount: 6 },
      { id: 'office', visitCount: 3 },
      { id: 'gym', visitCount: 1 },
    ];

    expect(globalVisitPrior(clusters, 'home', 5)).toEqual([
      { clusterId: 'office', probability: 0.75 },
      { clusterId: 'gym', probability: 0.25 },
    ]);
  });

  it('returns [] when nothing has visits', () => {
    expect(globalVisitPrior([{ id: 'a', visitCount: 0 }], null, 5)).toEqual([]);
  });
});

describe('buildHeatGrid', () => {
  it('sums weights of points that share a coarse cell and sorts hottest first', () => {
    const cells = buildHeatGrid([
      { lat: 40.001, lng: -73.001, weight: 0.3 },
      { lat: 40.002, lng: -73.002, weight: 0.2 }, // same 0.01-deg cell
      { lat: 40.052, lng: -73.001, weight: 0.4 },
    ]);

    expect(cells).toEqual([
      { lat: 40, lng: -73, weight: 0.5 },
      { lat: 40.05, lng: -73, weight: 0.4 },
    ]);
  });
});
