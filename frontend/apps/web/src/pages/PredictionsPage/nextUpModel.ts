/**
 * Pure logic for the "Next Up" differential panel: the next few forecast
 * buckets with a delta badge against a baseline computed from the already
 * fetched past forecast-history days.
 */

import {
  dominantEntry,
  localDateKey,
  localMinutesOfDay,
  type HistoryBucketLike,
  type ProbabilityEntryLike,
} from '@/components/PredictionHeatmap/heatmapModel';

export interface NextUpForecastBucket {
  bucketIndex: number;
  startTime: string;
  l0Probs: ProbabilityEntryLike[];
  l1Probs: ProbabilityEntryLike[];
}

export interface HistoryDay {
  /** YYYY-MM-DD forecast-day key the buckets belong to. */
  date: string;
  buckets: HistoryBucketLike[];
}

export interface NextUpRow {
  startTime: string;
  localMin: number;
  /** Dominant predicted L0 class. */
  label: string;
  probability: number;
  topL1: ProbabilityEntryLike | null;
  /**
   * Percentage-point delta of today's dominant-class probability vs the
   * baseline from past days, or null when history is too thin to be honest.
   */
  deltaPp: number | null;
}

/** Minimum baseline samples before a delta is shown instead of hidden. */
export const MIN_BASELINE_SAMPLES = 2;

function weekdayOfDateKey(dateKey: string): number | null {
  const [y, m, d] = dateKey.split('-').map(Number);
  if (!y || !m || !d) {
    return null;
  }

  return new Date(y, m - 1, d).getDay();
}

/**
 * Baseline probability the past forecasts assigned to `label` at `bucketIndex`:
 * the average over past days, preferring same-weekday days when at least
 * MIN_BASELINE_SAMPLES of them have the bucket, otherwise all fetched days.
 * Returns null when fewer than MIN_BASELINE_SAMPLES samples exist.
 */
export function baselineProbability(
  historyDays: HistoryDay[],
  bucketIndex: number,
  label: string,
  targetWeekday: number | null,
): number | null {
  const samplesFrom = (days: HistoryDay[]): number[] =>
    days.flatMap((day) => {
      const bucket = day.buckets.find((b) => b.bucketIndex === bucketIndex);
      if (!bucket || bucket.predictedL0.length === 0) {
        return [];
      }

      return [bucket.predictedL0.find((p) => p.label === label)?.probability ?? 0];
    });

  if (targetWeekday != null) {
    const sameWeekday = historyDays.filter((day) => weekdayOfDateKey(day.date) === targetWeekday);
    const samples = samplesFrom(sameWeekday);
    if (samples.length >= MIN_BASELINE_SAMPLES) {
      return samples.reduce((sum, p) => sum + p, 0) / samples.length;
    }
  }

  const samples = samplesFrom(historyDays);
  if (samples.length < MIN_BASELINE_SAMPLES) {
    return null;
  }

  return samples.reduce((sum, p) => sum + p, 0) / samples.length;
}

/**
 * The next `count` forecast buckets at/after `now`, each with its dominant L0,
 * top L1 context, and a delta (in percentage points) vs the past-days baseline.
 */
export function buildNextUp(
  buckets: NextUpForecastBucket[],
  historyDays: HistoryDay[],
  now = new Date(),
  count = 8,
): NextUpRow[] {
  const nowMs = now.getTime();

  const upcoming = buckets
    .map((bucket) => ({ bucket, startMs: new Date(bucket.startTime).getTime() }))
    .filter(({ startMs }) => !Number.isNaN(startMs) && startMs >= nowMs)
    .sort((a, b) => a.startMs - b.startMs)
    .slice(0, count);

  return upcoming.flatMap(({ bucket }) => {
    const dominant = dominantEntry(bucket.l0Probs);
    if (!dominant) {
      return [];
    }

    const dateKey = localDateKey(bucket.startTime);
    const targetWeekday = dateKey ? weekdayOfDateKey(dateKey) : null;
    const baseline = baselineProbability(historyDays, bucket.bucketIndex, dominant.label, targetWeekday);

    return [
      {
        startTime: bucket.startTime,
        localMin: localMinutesOfDay(bucket.startTime) ?? 0,
        label: dominant.label,
        probability: dominant.probability,
        topL1: dominantEntry(bucket.l1Probs),
        deltaPp: baseline == null ? null : Math.round((dominant.probability - baseline) * 100),
      },
    ];
  });
}
