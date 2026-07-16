/**
 * Pure derivation logic for the 7×48 prediction heatmap (past actuals + today /
 * tomorrow forecast). Kept free of React so it can be unit-tested in the fast
 * node vitest project.
 */

export const HEATMAP_COLUMNS = 48;
export const MINUTES_PER_SLOT = 30;
const MINUTES_PER_DAY = 24 * 60;

export interface ProbabilityEntryLike {
  label: string;
  probability: number;
}

/** One bucket from the `forecastHistory` query (past day, predicted + actual). */
export interface HistoryBucketLike {
  bucketIndex: number;
  startTime: string;
  predictedL0: ProbabilityEntryLike[];
  actualL0: string | null;
}

/** One bucket from the live `forecast` query (today / tomorrow rows). */
export interface ForecastBucketLike {
  bucketIndex: number;
  startTime: string;
  l0Probs: ProbabilityEntryLike[];
}

export interface HeatmapCell {
  /** Local half-hour column, 0 (midnight) … 47 (23:30). */
  column: number;
  /** Minutes since local midnight for the slot start (column * 30). */
  localMin: number;
  /** L0 class that colours the cell. */
  colorLabel: string;
  /** 0..1 — full for observed actuals, confidence-scaled for predictions. */
  opacity: number;
  /** 'actual' = observed class shown; 'predicted' = model output shown. */
  kind: 'actual' | 'predicted';
  /** Dominant predicted L0 class, when a prediction exists for the slot. */
  predictedDominant: string | null;
  /** Full predicted distribution for the tooltip, highest first. */
  predictedProbs: ProbabilityEntryLike[];
  /** Observed class, when backfilled. */
  actualL0: string | null;
  /** True when an observed actual disagrees with the predicted dominant class. */
  divergent: boolean;
}

export type HeatmapCells = (HeatmapCell | null)[];

/** Highest-probability entry, or null for an empty distribution. */
export function dominantEntry(probs: ProbabilityEntryLike[]): ProbabilityEntryLike | null {
  if (!probs.length) {
    return null;
  }

  return probs.reduce((best, cur) => (cur.probability > best.probability ? cur : best));
}

/** Minutes since local midnight for an ISO instant, or null when unparseable. */
export function localMinutesOfDay(iso: string): number | null {
  if (!iso) {
    return null;
  }

  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return null;
  }

  return d.getHours() * 60 + d.getMinutes();
}

/** Local half-hour column (0..47) for an ISO instant, or null when unparseable. */
export function localColumn(iso: string): number | null {
  const minutes = localMinutesOfDay(iso);
  if (minutes == null) {
    return null;
  }

  return Math.floor((minutes % MINUTES_PER_DAY) / MINUTES_PER_SLOT);
}

/** Local calendar-date key (YYYY-MM-DD) for an ISO instant, or null when unparseable. */
export function localDateKey(instant: string | Date): string | null {
  const d = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(d.getTime())) {
    return null;
  }

  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');

  return `${d.getFullYear()}-${month}-${day}`;
}

/** Format minutes-since-local-midnight as a clock label (e.g. 510 → "8:30 AM"). */
export function formatClock(minutesOfDay: number): string {
  const m = ((minutesOfDay % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;

  return new Date(2000, 0, 1, Math.floor(m / 60), m % 60).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Row label like "Mon 7/14" from a YYYY-MM-DD date key (interpreted as a local date). */
export function formatRowLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  if (!y || !m || !d) {
    return dateKey;
  }

  const weekday = new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short' });

  return `${weekday} ${m}/${d}`;
}

/** The last `count` local calendar dates strictly before `today`, oldest first. */
export function pastDateKeys(count: number, today = new Date()): string[] {
  const keys: string[] = [];

  for (let back = count; back >= 1; back -= 1) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back);
    keys.push(localDateKey(d) as string);
  }

  return keys;
}

function clampOpacity(probability: number): number {
  return Math.max(0.2, Math.min(1, probability));
}

/**
 * Cells for one past-day row. Observed slots render the actual class at full
 * opacity (flagging divergence from the predicted dominant); slots whose actual
 * has not been backfilled yet fall back to the prediction at confidence opacity.
 */
export function buildHistoryCells(buckets: HistoryBucketLike[]): HeatmapCells {
  const cells: HeatmapCells = Array.from({ length: HEATMAP_COLUMNS }, () => null);

  for (const bucket of buckets) {
    const column = localColumn(bucket.startTime);
    if (column == null) {
      continue;
    }

    const dominant = dominantEntry(bucket.predictedL0);

    if (bucket.actualL0) {
      cells[column] = {
        column,
        localMin: column * MINUTES_PER_SLOT,
        colorLabel: bucket.actualL0,
        opacity: 1,
        kind: 'actual',
        predictedDominant: dominant?.label ?? null,
        predictedProbs: bucket.predictedL0,
        actualL0: bucket.actualL0,
        divergent: dominant != null && dominant.label !== bucket.actualL0,
      };
      continue;
    }

    if (dominant) {
      cells[column] = {
        column,
        localMin: column * MINUTES_PER_SLOT,
        colorLabel: dominant.label,
        opacity: clampOpacity(dominant.probability),
        kind: 'predicted',
        predictedDominant: dominant.label,
        predictedProbs: bucket.predictedL0,
        actualL0: null,
        divergent: false,
      };
    }
  }

  return cells;
}

/**
 * Split the live forecast buckets into today / tomorrow rows by the local
 * calendar date of each bucket's real instant. Buckets outside the two dates
 * (or without a valid instant) are dropped.
 */
export function buildForecastRows(
  buckets: ForecastBucketLike[],
  now = new Date(),
): { todayKey: string; tomorrowKey: string; today: HeatmapCells; tomorrow: HeatmapCells } {
  const todayKey = localDateKey(now) as string;
  const tomorrowKey = localDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)) as string;

  const today: HeatmapCells = Array.from({ length: HEATMAP_COLUMNS }, () => null);
  const tomorrow: HeatmapCells = Array.from({ length: HEATMAP_COLUMNS }, () => null);

  for (const bucket of buckets) {
    const column = localColumn(bucket.startTime);
    const dateKey = localDateKey(bucket.startTime);
    const dominant = dominantEntry(bucket.l0Probs);

    if (column == null || dateKey == null || !dominant) {
      continue;
    }

    const row = dateKey === todayKey ? today : dateKey === tomorrowKey ? tomorrow : null;
    if (!row) {
      continue;
    }

    row[column] = {
      column,
      localMin: column * MINUTES_PER_SLOT,
      colorLabel: dominant.label,
      opacity: clampOpacity(dominant.probability),
      kind: 'predicted',
      predictedDominant: dominant.label,
      predictedProbs: bucket.l0Probs,
      actualL0: null,
      divergent: false,
    };
  }

  return { todayKey, tomorrowKey, today, tomorrow };
}
