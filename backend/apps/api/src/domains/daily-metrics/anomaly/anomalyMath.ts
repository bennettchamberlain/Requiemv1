/**
 * Pure anomaly math over a single daily_metrics series: robust z-score and
 * two-sided CUSUM changepoint. HBPE L0 divergence is a third detector but
 * lives in AnomalyEngine (it reads prediction_log). Database-free.
 */

export const MIN_ANOMALY_N = 14;
export const MIN_ANOMALY_COVERAGE = 0.5;
export const ROBUST_Z_WINDOW = 28;
export const ROBUST_Z_THRESHOLD = 3.5;
export const CUSUM_WINDOW = 90;
export const CUSUM_K_SIGMA = 0.5;
export const CUSUM_H_SIGMA = 5;
/** Days after a CUSUM crossing that must stay shifted before we call it a changepoint. */
export const CUSUM_CONFIRM_DAYS = 5;
export const MAD_TO_SIGMA = 1.4826;

export type AnomalyDetector = 'robust_z' | 'cusum' | 'hbpe_l0';
export type AnomalyDirection = 'high' | 'low' | 'change' | 'divergence';

export interface SeriesPoint {
  date: string;
  value: number;
  coverage: number;
}

export interface AnomalyFinding {
  date: string;
  detector: AnomalyDetector;
  value: number | null;
  baseline: number | null;
  score: number;
  direction: AnomalyDirection;
  coverage: number;
  metadata: Record<string, unknown>;
}

function covered(point: SeriesPoint): boolean {
  return point.coverage >= MIN_ANOMALY_COVERAGE;
}

export function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function mad(values: number[], center = median(values)): number {
  if (values.length === 0) {
    return 0;
  }

  return median(values.map((value) => Math.abs(value - center)));
}

/**
 * Robust z vs the trailing `ROBUST_Z_WINDOW` covered points *before* `date`
 * (no look-ahead). MAD = 0 → no flag.
 */
export function robustZAt(series: SeriesPoint[], date: string): AnomalyFinding | null {
  const index = series.findIndex((point) => point.date === date);
  if (index < 0) {
    return null;
  }

  const point = series[index];
  if (!covered(point)) {
    return null;
  }

  const prior = series.filter((candidate, candidateIndex) => candidateIndex < index && covered(candidate));
  const window = prior.slice(-ROBUST_Z_WINDOW);
  if (window.length < MIN_ANOMALY_N) {
    return null;
  }

  const values = window.map((candidate) => candidate.value);
  const center = median(values);
  const scale = mad(values, center) * MAD_TO_SIGMA;
  if (scale === 0) {
    return null;
  }

  const z = (point.value - center) / scale;
  if (Math.abs(z) < ROBUST_Z_THRESHOLD) {
    return null;
  }

  return {
    date: point.date,
    detector: 'robust_z',
    value: point.value,
    baseline: center,
    score: Math.abs(z),
    direction: z > 0 ? 'high' : 'low',
    coverage: point.coverage,
    metadata: { z, window: window.length },
  };
}

/** Robust-z flags for every covered day that has a long enough prior. */
export function robustZSeries(series: SeriesPoint[]): AnomalyFinding[] {
  const findings: AnomalyFinding[] = [];
  for (const point of series) {
    const finding = robustZAt(series, point.date);
    if (finding) {
      findings.push(finding);
    }
  }

  return findings;
}

/**
 * Two-sided CUSUM on residuals from a trailing 28-day median. Emits one
 * `'change'` at the first threshold crossing, then resets. Threshold is
 * `CUSUM_H_SIGMA` × σ of residuals (σ from MAD).
 */
export function cusumChangepoints(series: SeriesPoint[]): AnomalyFinding[] {
  const coveredPoints = series.filter(covered);
  if (coveredPoints.length < MIN_ANOMALY_N) {
    return [];
  }

  const residuals: number[] = [];
  const residualDates: string[] = [];
  for (let i = 0; i < coveredPoints.length; i++) {
    const prior = coveredPoints.slice(Math.max(0, i - ROBUST_Z_WINDOW), i);
    if (prior.length < MIN_ANOMALY_N) {
      continue;
    }

    const center = median(prior.map((point) => point.value));
    residuals.push(coveredPoints[i].value - center);
    residualDates.push(coveredPoints[i].date);
  }

  if (residuals.length < MIN_ANOMALY_N) {
    return [];
  }

  const scale = mad(residuals) * MAD_TO_SIGMA;
  if (scale === 0) {
    return [];
  }

  const k = CUSUM_K_SIGMA * scale;
  const h = CUSUM_H_SIGMA * scale;
  let sHigh = 0;
  let sLow = 0;
  let runStart = residualDates[0];
  let skipUntil = -1;
  const findings: AnomalyFinding[] = [];

  for (let i = 0; i < residuals.length; i++) {
    if (i < skipUntil) {
      sHigh = 0;
      sLow = 0;
      continue;
    }

    const residual = residuals[i];
    if (sHigh === 0 && sLow === 0) {
      runStart = residualDates[i];
    }

    sHigh = Math.max(0, sHigh + residual - k);
    sLow = Math.max(0, sLow - residual - k);

    if (sHigh >= h || sLow >= h) {
      const directionHigh = sHigh >= h;
      if (!sustainedShift(coveredPoints, residualDates[i], directionHigh)) {
        sHigh = 0;
        sLow = 0;
        continue;
      }

      findings.push({
        date: residualDates[i],
        detector: 'cusum',
        value: coveredPoints.find((point) => point.date === residualDates[i])?.value ?? null,
        baseline: null,
        score: (directionHigh ? sHigh : sLow) / scale,
        direction: 'change',
        coverage: coveredPoints.find((point) => point.date === residualDates[i])?.coverage ?? 1,
        metadata: {
          runStart,
          runEnd: residualDates[i],
          side: directionHigh ? 'high' : 'low',
        },
      });
      sHigh = 0;
      sLow = 0;
      // Hold off until the rolling median can include the new regime, otherwise
      // a single level shift re-fires on every later day.
      skipUntil = i + ROBUST_Z_WINDOW;
    }
  }

  return findings;
}

function sustainedShift(points: SeriesPoint[], date: string, high: boolean): boolean {
  const index = points.findIndex((point) => point.date === date);
  if (index < 0) {
    return false;
  }

  const after = points.slice(index, index + CUSUM_CONFIRM_DAYS).filter(covered);
  if (after.length < CUSUM_CONFIRM_DAYS) {
    return false;
  }

  const prior = points.slice(Math.max(0, index - ROBUST_Z_WINDOW), index).filter(covered);
  if (prior.length < MIN_ANOMALY_N) {
    return false;
  }

  const priorValues = prior.map((point) => point.value);
  const priorScale = mad(priorValues) * MAD_TO_SIGMA;
  if (priorScale === 0) {
    return false;
  }

  const delta = median(after.map((point) => point.value)) - median(priorValues);
  if (Math.abs(delta) < 2 * priorScale) {
    return false;
  }

  return high ? delta > 0 : delta < 0;
}

export interface HbpeBucket {
  actualL0: string;
  l0Probs: Record<string, number>;
}

export const HBPE_MISMATCH_FRACTION = 0.5;
export const HBPE_MEAN_SURPRISE = 0.4;
export const HBPE_MIN_BUCKETS = 12;

/**
 * One local day's predicted-vs-actual L0 buckets. Copy must never say the
 * forecast was "wrong" — this is self-consistency vs Qwen labels.
 */
export function hbpeL0Divergence(date: string, buckets: HbpeBucket[]): AnomalyFinding | null {
  if (buckets.length < HBPE_MIN_BUCKETS) {
    return null;
  }

  let mismatches = 0;
  let surpriseSum = 0;
  const actualCounts: Record<string, number> = {};
  const expectedCounts: Record<string, number> = {};

  for (const bucket of buckets) {
    const predicted = argmax(bucket.l0Probs);
    if (predicted !== bucket.actualL0) {
      mismatches += 1;
    }

    const pActual = bucket.l0Probs[bucket.actualL0] ?? 0;
    surpriseSum += 1 - pActual;
    actualCounts[bucket.actualL0] = (actualCounts[bucket.actualL0] ?? 0) + 1;
    if (predicted) {
      expectedCounts[predicted] = (expectedCounts[predicted] ?? 0) + 1;
    }
  }

  const mismatchFraction = mismatches / buckets.length;
  const meanSurprise = surpriseSum / buckets.length;
  if (mismatchFraction <= HBPE_MISMATCH_FRACTION || meanSurprise <= HBPE_MEAN_SURPRISE) {
    return null;
  }

  return {
    date,
    detector: 'hbpe_l0',
    value: null,
    baseline: null,
    score: meanSurprise,
    direction: 'divergence',
    coverage: 1,
    metadata: {
      expected_l0: argmax(expectedCounts),
      actual_l0: argmax(actualCounts),
      bucket_count: buckets.length,
      mismatch_fraction: mismatchFraction,
      mean_surprise: meanSurprise,
    },
  };
}

function argmax(probs: Record<string, number>): string | null {
  let best: string | null = null;
  let bestValue = -Infinity;
  for (const [label, value] of Object.entries(probs)) {
    if (value > bestValue) {
      best = label;
      bestValue = value;
    }
  }

  return best;
}
