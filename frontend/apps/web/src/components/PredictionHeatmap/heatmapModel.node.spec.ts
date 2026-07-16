import { describe, expect, it } from 'vitest';

import {
  buildForecastRows,
  buildHistoryCells,
  dominantEntry,
  formatRowLabel,
  localColumn,
  localDateKey,
  pastDateKeys,
  HEATMAP_COLUMNS,
  type ForecastBucketLike,
  type HistoryBucketLike,
} from './heatmapModel';

/** ISO instant for a LOCAL wall-clock time, keeping tests timezone-independent. */
function localIso(y: number, month: number, day: number, hour: number, minute = 0): string {
  return new Date(y, month - 1, day, hour, minute).toISOString();
}

function probs(...entries: [string, number][]) {
  return entries.map(([label, probability]) => ({ label, probability }));
}

describe('dominantEntry', () => {
  it('returns the highest-probability entry', () => {
    expect(dominantEntry(probs(['WORK', 0.2], ['SLEEP', 0.7], ['SOCIAL', 0.1]))).toEqual({
      label: 'SLEEP',
      probability: 0.7,
    });
  });

  it('returns null for an empty distribution', () => {
    expect(dominantEntry([])).toBeNull();
  });
});

describe('localColumn', () => {
  it('maps a local instant to its half-hour column', () => {
    expect(localColumn(localIso(2026, 7, 14, 0, 0))).toBe(0);
    expect(localColumn(localIso(2026, 7, 14, 9, 30))).toBe(19);
    expect(localColumn(localIso(2026, 7, 14, 23, 59))).toBe(47);
  });

  it('returns null for unparseable input', () => {
    expect(localColumn('')).toBeNull();
    expect(localColumn('not-a-date')).toBeNull();
  });
});

describe('buildHistoryCells', () => {
  const bucket = (over: Partial<HistoryBucketLike>): HistoryBucketLike => ({
    bucketIndex: 0,
    startTime: localIso(2026, 7, 14, 9, 0),
    predictedL0: probs(['WORK', 0.8], ['LEISURE', 0.2]),
    actualL0: 'WORK',
    ...over,
  });

  it('always returns 48 slots', () => {
    expect(buildHistoryCells([])).toHaveLength(HEATMAP_COLUMNS);
  });

  it('renders a matching actual at full opacity without divergence', () => {
    const cells = buildHistoryCells([bucket({})]);
    const cell = cells[18];

    expect(cell).toMatchObject({
      kind: 'actual',
      colorLabel: 'WORK',
      opacity: 1,
      divergent: false,
      predictedDominant: 'WORK',
    });
  });

  it('flags divergence when the actual disagrees with the predicted dominant', () => {
    const cells = buildHistoryCells([bucket({ actualL0: 'LEISURE' })]);

    expect(cells[18]).toMatchObject({
      kind: 'actual',
      colorLabel: 'LEISURE',
      divergent: true,
      predictedDominant: 'WORK',
    });
  });

  it('falls back to the prediction at confidence opacity when the actual is missing', () => {
    const cells = buildHistoryCells([bucket({ actualL0: null })]);

    expect(cells[18]).toMatchObject({
      kind: 'predicted',
      colorLabel: 'WORK',
      opacity: 0.8,
      divergent: false,
    });
  });

  it('leaves slots without predictions empty', () => {
    const cells = buildHistoryCells([bucket({ actualL0: null, predictedL0: [] })]);

    expect(cells[18]).toBeNull();
  });
});

describe('buildForecastRows', () => {
  it('splits buckets between today and tomorrow by local date', () => {
    const now = new Date(2026, 6, 14, 12, 0);
    const buckets: ForecastBucketLike[] = [
      { bucketIndex: 1, startTime: localIso(2026, 7, 14, 15, 0), l0Probs: probs(['WORK', 0.6]) },
      { bucketIndex: 2, startTime: localIso(2026, 7, 15, 8, 30), l0Probs: probs(['SLEEP', 0.9]) },
      // Outside the two-day window → dropped.
      { bucketIndex: 3, startTime: localIso(2026, 7, 16, 8, 30), l0Probs: probs(['SLEEP', 0.9]) },
    ];

    const { todayKey, tomorrowKey, today, tomorrow } = buildForecastRows(buckets, now);

    expect(todayKey).toBe('2026-07-14');
    expect(tomorrowKey).toBe('2026-07-15');
    expect(today[30]).toMatchObject({ colorLabel: 'WORK', opacity: 0.6, kind: 'predicted' });
    expect(tomorrow[17]).toMatchObject({ colorLabel: 'SLEEP', opacity: 0.9 });
    expect(tomorrow.filter(Boolean)).toHaveLength(1);
  });

  it('clamps opacity into the visible range', () => {
    const now = new Date(2026, 6, 14, 0, 0);
    const buckets: ForecastBucketLike[] = [
      { bucketIndex: 1, startTime: localIso(2026, 7, 14, 1, 0), l0Probs: probs(['ERRAND', 0.05]) },
    ];

    const { today } = buildForecastRows(buckets, now);

    expect(today[2]?.opacity).toBe(0.2);
  });
});

describe('date helpers', () => {
  it('formats a row label like "Tue 7/14"', () => {
    expect(formatRowLabel('2026-07-14')).toBe('Tue 7/14');
  });

  it('produces the past N local dates oldest-first', () => {
    const keys = pastDateKeys(3, new Date(2026, 6, 14));

    expect(keys).toEqual(['2026-07-11', '2026-07-12', '2026-07-13']);
  });

  it('derives the local date key from an instant', () => {
    expect(localDateKey(new Date(2026, 6, 14, 23, 59))).toBe('2026-07-14');
  });
});
