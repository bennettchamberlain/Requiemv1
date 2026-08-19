/**
 * Pure transition-model math for the next-place engine: recency-decayed
 * transition buckets, the (from, hour, dow) backoff chain, and the coarse
 * heat grid. No database, fully deterministic, unit-tested with known counts.
 */

/** One cluster-assigned stay, produced by PlaceClusterService.buildClusters. */
export interface ClusterVisit {
  clusterId: string;
  start: Date;
  end: Date;
}

/** An aggregated (from, to, hour, dow) transition bucket. */
export interface TransitionBucket {
  fromCluster: string;
  toCluster: string;
  hourBucket: number;
  dow: number;
  decayedCount: number;
}

/** ~30-day half-life: a month-old transition counts half a fresh one. */
export const TRANSITION_HALF_LIFE_DAYS = 30;

const MS_PER_DAY = 86_400_000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Exponential recency decay: 0.5^(age_days / half_life). */
export function decayWeight(ageMs: number, halfLifeDays = TRANSITION_HALF_LIFE_DAYS): number {
  const ageDays = Math.max(0, ageMs) / MS_PER_DAY;

  return 2 ** (-ageDays / halfLifeDays);
}

/** Hour (0-23) and day-of-week (0-6, Sunday = 0) of a timestamp in a timezone. */
export function hourDowInTz(date: Date, timezone = 'UTC'): { hour: number; dow: number } {
  if (timezone === 'UTC') {
    return { hour: date.getUTCHours(), dow: date.getUTCDay() };
  }

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    weekday: 'short',
    hour: '2-digit',
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? date.getUTCHours());
  const weekday = parts.find((part) => part.type === 'weekday')?.value ?? 'Sun';

  return { hour, dow: Math.max(0, WEEKDAYS.indexOf(weekday)) };
}

export interface BuildTransitionOptions {
  /** Reference time the decay is measured against (defaults handled by caller). */
  now: Date;
  timezone?: string;
  halfLifeDays?: number;
}

/**
 * Fold a chronological visit sequence into aggregated transition buckets.
 * Each consecutive pair (a -> b) with different clusters contributes
 * decayWeight(now - b.start) to the bucket keyed by b's arrival hour/dow;
 * self-pairs (same cluster twice in a row) are skipped — dwelling is not a
 * transition. Output is sorted by key so rebuilds are byte-deterministic.
 */
export function buildTransitionBuckets(
  visits: ClusterVisit[],
  options: BuildTransitionOptions,
): TransitionBucket[] {
  const timezone = options.timezone ?? 'UTC';
  const halfLifeDays = options.halfLifeDays ?? TRANSITION_HALF_LIFE_DAYS;
  const buckets = new Map<string, TransitionBucket>();

  for (let i = 1; i < visits.length; i++) {
    const from = visits[i - 1];
    const to = visits[i];
    if (from.clusterId === to.clusterId) {
      continue;
    }

    const { hour, dow } = hourDowInTz(to.start, timezone);
    const key = `${from.clusterId}|${to.clusterId}|${hour}|${dow}`;
    const weight = decayWeight(options.now.getTime() - to.start.getTime(), halfLifeDays);
    const existing = buckets.get(key);

    if (existing) {
      existing.decayedCount += weight;
    } else {
      buckets.set(key, {
        fromCluster: from.clusterId,
        toCluster: to.clusterId,
        hourBucket: hour,
        dow,
        decayedCount: weight,
      });
    }
  }

  return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, bucket]) => bucket);
}

/** Distance between two hours on the 24-hour circle (0..12). */
export function circularHourDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 24;

  return Math.min(d, 24 - d);
}

export type BackoffLevel = 'FROM_HOUR_DOW' | 'FROM_HOUR_ADJACENT' | 'FROM_ANY' | 'GLOBAL_PRIOR';

export interface RankedPlace {
  clusterId: string;
  probability: number;
}

function rankBuckets(rows: TransitionBucket[], k: number): RankedPlace[] {
  const totals = new Map<string, number>();
  let sum = 0;

  for (const row of rows) {
    if (row.decayedCount <= 0) {
      continue;
    }

    totals.set(row.toCluster, (totals.get(row.toCluster) ?? 0) + row.decayedCount);
    sum += row.decayedCount;
  }

  if (sum <= 0) {
    return [];
  }

  return [...totals.entries()]
    .map(([clusterId, mass]) => ({ clusterId, probability: mass / sum }))
    .sort((a, b) => b.probability - a.probability || a.clusterId.localeCompare(b.clusterId))
    .slice(0, k);
}

/**
 * Backoff chain over the transitions out of the current cluster:
 *   1. FROM_HOUR_DOW      — exact (hour, dow) bucket
 *   2. FROM_HOUR_ADJACENT — hour within +/-1 (circular), any dow
 *   3. FROM_ANY           — every transition out of the cluster
 * The first level with probability mass wins; probabilities are the bucket's
 * normalized decayed counts. Returns null when the cluster has no outgoing
 * transitions at all — the caller then falls back to the global visit prior.
 */
export function backoffNextPlace(
  rows: TransitionBucket[],
  hour: number,
  dow: number,
  k: number,
): { level: BackoffLevel; ranked: RankedPlace[] } | null {
  const levels: Array<{ level: BackoffLevel; rows: TransitionBucket[] }> = [
    {
      level: 'FROM_HOUR_DOW',
      rows: rows.filter((row) => row.hourBucket === hour && row.dow === dow),
    },
    {
      level: 'FROM_HOUR_ADJACENT',
      rows: rows.filter((row) => circularHourDistance(row.hourBucket, hour) <= 1),
    },
    { level: 'FROM_ANY', rows },
  ];

  for (const { level, rows: levelRows } of levels) {
    const ranked = rankBuckets(levelRows, k);
    if (ranked.length > 0) {
      return { level, ranked };
    }
  }

  return null;
}

/**
 * Global visit prior — the terminal backoff level: clusters ranked by their
 * (window) visit counts, excluding the place the user is already at.
 */
export function globalVisitPrior(
  clusters: Array<{ id: string; visitCount: number }>,
  excludeClusterId: string | null,
  k: number,
): RankedPlace[] {
  const eligible = clusters.filter((cluster) => cluster.id !== excludeClusterId && cluster.visitCount > 0);
  const total = eligible.reduce((sum, cluster) => sum + cluster.visitCount, 0);

  if (total <= 0) {
    return [];
  }

  return eligible
    .map((cluster) => ({ clusterId: cluster.id, probability: cluster.visitCount / total }))
    .sort((a, b) => b.probability - a.probability || a.clusterId.localeCompare(b.clusterId))
    .slice(0, k);
}

export interface HeatCell {
  lat: number;
  lng: number;
  weight: number;
}

/** Cell size of the coarse heat grid, degrees (~1.1 km of latitude). */
export const HEAT_GRID_CELL_DEG = 0.01;

/**
 * Coarse probability heat grid: snap each weighted point to a lat/lng grid
 * cell and sum the weights per cell. Sorted by weight (then cell) descending
 * so consumers can draw the hottest cells first.
 */
export function buildHeatGrid(
  points: Array<{ lat: number; lng: number; weight: number }>,
  cellDeg = HEAT_GRID_CELL_DEG,
): HeatCell[] {
  const cells = new Map<string, HeatCell>();

  for (const point of points) {
    if (point.weight <= 0) {
      continue;
    }

    const lat = Number((Math.round(point.lat / cellDeg) * cellDeg).toFixed(6));
    const lng = Number((Math.round(point.lng / cellDeg) * cellDeg).toFixed(6));
    const key = `${lat}|${lng}`;
    const cell = cells.get(key);

    if (cell) {
      cell.weight += point.weight;
    } else {
      cells.set(key, { lat, lng, weight: point.weight });
    }
  }

  return [...cells.values()].sort((a, b) => b.weight - a.weight || a.lat - b.lat || a.lng - b.lng);
}
