import { describe, expect, it } from 'vitest';

import type { HistoryBucketLike } from '@/components/PredictionHeatmap';

import { baselineProbability, buildNextUp, type HistoryDay, type NextUpForecastBucket } from './nextUpModel';

function localIso(y: number, month: number, day: number, hour: number, minute = 0): string {
  return new Date(y, month - 1, day, hour, minute).toISOString();
}

function probs(...entries: [string, number][]) {
  return entries.map(([label, probability]) => ({ label, probability }));
}

function historyDay(date: string, bucketIndex: number, workProb: number): HistoryDay {
  const bucket: HistoryBucketLike = {
    bucketIndex,
    startTime: '',
    predictedL0: probs(['WORK', workProb], ['LEISURE', 1 - workProb]),
    actualL0: null,
  };

  return { date, buckets: [bucket] };
}

describe('baselineProbability', () => {
  it('averages the class probability across days at the same bucket', () => {
    const days = [historyDay('2026-07-10', 20, 0.6), historyDay('2026-07-11', 20, 0.8)];

    expect(baselineProbability(days, 20, 'WORK', null)).toBeCloseTo(0.7);
  });

  it('treats a day that never mentions the class as probability 0', () => {
    const days = [
      historyDay('2026-07-10', 20, 0.6),
      {
        date: '2026-07-11',
        buckets: [{ bucketIndex: 20, startTime: '', predictedL0: probs(['SLEEP', 1]), actualL0: null }],
      },
    ];

    expect(baselineProbability(days, 20, 'WORK', null)).toBeCloseTo(0.3);
  });

  it('returns null with fewer than two samples', () => {
    expect(baselineProbability([historyDay('2026-07-10', 20, 0.6)], 20, 'WORK', null)).toBeNull();
    expect(baselineProbability([], 20, 'WORK', null)).toBeNull();
  });

  it('ignores days missing the bucket', () => {
    const days = [historyDay('2026-07-10', 20, 0.6), historyDay('2026-07-11', 99, 0.9)];

    expect(baselineProbability(days, 20, 'WORK', null)).toBeNull();
  });

  it('prefers same-weekday days when enough of them exist', () => {
    // 2026-07-07 and 2026-07-14 are both Tuesdays; 2026-07-10 is a Friday.
    const days = [
      historyDay('2026-07-07', 20, 0.2),
      historyDay('2026-07-14', 20, 0.4),
      historyDay('2026-07-10', 20, 1.0),
    ];
    const tuesday = 2;

    expect(baselineProbability(days, 20, 'WORK', tuesday)).toBeCloseTo(0.3);
  });
});

describe('buildNextUp', () => {
  const forecastBucket = (
    bucketIndex: number,
    startTime: string,
    workProb: number,
  ): NextUpForecastBucket => ({
    bucketIndex,
    startTime,
    l0Probs: probs(['WORK', workProb], ['LEISURE', 1 - workProb]),
    l1Probs: probs(['deep-focus', 0.5]),
  });

  it('returns only upcoming buckets, sorted and capped', () => {
    const now = new Date(2026, 6, 14, 12, 0);
    const buckets = [
      forecastBucket(30, localIso(2026, 7, 14, 15, 0), 0.5),
      forecastBucket(28, localIso(2026, 7, 14, 14, 0), 0.6),
      forecastBucket(10, localIso(2026, 7, 14, 5, 0), 0.9), // already elapsed
    ];

    const rows = buildNextUp(buckets, [], now, 2);

    expect(rows.map((row) => row.startTime)).toEqual([
      localIso(2026, 7, 14, 14, 0),
      localIso(2026, 7, 14, 15, 0),
    ]);
    expect(rows[0]).toMatchObject({
      label: 'WORK',
      probability: 0.6,
      topL1: { label: 'deep-focus', probability: 0.5 },
    });
  });

  it('computes the delta in percentage points against the baseline', () => {
    const now = new Date(2026, 6, 14, 12, 0);
    const buckets = [forecastBucket(28, localIso(2026, 7, 14, 14, 0), 0.9)];
    const history = [historyDay('2026-07-10', 28, 0.6), historyDay('2026-07-11', 28, 0.8)];

    const rows = buildNextUp(buckets, history, now);

    expect(rows[0].deltaPp).toBe(20); // 0.9 - avg(0.6, 0.8) = +0.20
  });

  it('hides the delta instead of faking it when history is too thin', () => {
    const now = new Date(2026, 6, 14, 12, 0);
    const buckets = [forecastBucket(28, localIso(2026, 7, 14, 14, 0), 0.9)];

    const rows = buildNextUp(buckets, [historyDay('2026-07-10', 28, 0.6)], now);

    expect(rows[0].deltaPp).toBeNull();
  });

  it('skips buckets with empty distributions', () => {
    const now = new Date(2026, 6, 14, 12, 0);
    const buckets: NextUpForecastBucket[] = [
      { bucketIndex: 28, startTime: localIso(2026, 7, 14, 14, 0), l0Probs: [], l1Probs: [] },
    ];

    expect(buildNextUp(buckets, [], now)).toEqual([]);
  });
});
