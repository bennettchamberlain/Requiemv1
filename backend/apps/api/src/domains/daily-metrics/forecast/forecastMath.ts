/**
 * Pure metric-forecast math: a seasonal-naive (per-day-of-week) baseline
 * blended with an overall EWMA, banded by the empirical quantiles of recent
 * one-step-ahead residuals. Classical by design at this data scale (see the
 * insight-engine-alpha doc) — deterministic, database-free, unit-testable.
 */

import { shiftIso } from '../dateUtil';

/** One observed day of a metric (nulls are filtered out upstream). */
export interface DailySample {
  /** YYYY-MM-DD. */
  date: string;
  value: number;
}

export interface ForecastPoint {
  /** YYYY-MM-DD. */
  date: string;
  q10: number;
  q50: number;
  q90: number;
}

export const EWMA_ALPHA = 0.3;
/** How many recent same-dow observations feed the seasonal baseline. */
export const DOW_HISTORY = 8;
/** Recency weight ratio between consecutive same-dow observations. */
export const DOW_DECAY = 0.8;
/** How far back one-step-ahead residuals are collected, days. */
export const RESIDUAL_WINDOW_DAYS = 60;
/** Minimum prior samples before a day can contribute a residual. */
export const MIN_RESIDUAL_PRIOR_SAMPLES = 3;
/** Below this fraction of days-with-data the forecast refuses to guess. */
export const MIN_FORECAST_COVERAGE = 0.3;

/** Day of week (0-6, Sunday = 0) of a YYYY-MM-DD calendar date. */
export function dowOfIso(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

/**
 * Empirical quantile with linear interpolation between order statistics.
 * `sorted` must be ascending; returns 0 for an empty array (no band).
 */
export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) {
    return 0;
  }

  const position = (sorted.length - 1) * Math.min(Math.max(q, 0), 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);

  if (lower === upper) {
    return sorted[lower];
  }

  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function ewma(values: number[], alpha: number): number {
  let smoothed = values[0];

  for (let i = 1; i < values.length; i++) {
    smoothed = alpha * values[i] + (1 - alpha) * smoothed;
  }

  return smoothed;
}

/**
 * Recency-weighted mean of the last {@link DOW_HISTORY} same-dow values:
 * the most recent gets weight 1, each older one DOW_DECAY times less.
 */
function dowBaseline(samples: DailySample[], dow: number): { value: number; count: number } | null {
  const sameDow = samples.filter((sample) => dowOfIso(sample.date) === dow).slice(-DOW_HISTORY);

  if (sameDow.length === 0) {
    return null;
  }

  let weightSum = 0;
  let valueSum = 0;

  sameDow.forEach((sample, index) => {
    const weight = DOW_DECAY ** (sameDow.length - 1 - index);
    weightSum += weight;
    valueSum += weight * sample.value;
  });

  return { value: valueSum / weightSum, count: sameDow.length };
}

/**
 * Point forecast for one target date from a chronological sample history:
 * a 50/50 blend of the per-dow baseline and the overall EWMA(alpha 0.3), or
 * pure EWMA while the target dow has fewer than two observations. Null when
 * there is no history at all.
 */
export function pointForecast(samples: DailySample[], targetDate: string): number | null {
  if (samples.length === 0) {
    return null;
  }

  const overall = ewma(
    samples.map((sample) => sample.value),
    EWMA_ALPHA,
  );
  const seasonal = dowBaseline(samples, dowOfIso(targetDate));

  if (seasonal === null || seasonal.count < 2) {
    return overall;
  }

  return 0.5 * seasonal.value + 0.5 * overall;
}

/**
 * One-step-ahead residuals (actual - forecast) over the trailing
 * {@link RESIDUAL_WINDOW_DAYS} days: each observed day is forecast using only
 * the samples strictly before it, exactly how a real next-day forecast would
 * have been made, so the residual distribution is honest.
 */
export function oneStepResiduals(samples: DailySample[], anchorDate: string): number[] {
  const windowStart = shiftIso(anchorDate, -RESIDUAL_WINDOW_DAYS);
  const residuals: number[] = [];

  for (let i = MIN_RESIDUAL_PRIOR_SAMPLES; i < samples.length; i++) {
    const sample = samples[i];
    if (sample.date <= windowStart) {
      continue;
    }

    const predicted = pointForecast(samples.slice(0, i), sample.date);
    if (predicted !== null) {
      residuals.push(sample.value - predicted);
    }
  }

  return residuals;
}

/**
 * The full q10/q50/q90 forecast for horizonDays days after anchorDate. Bands
 * come from the empirical residual quantiles added onto the point forecast
 * (q50 uses the median residual as a bias correction); with no residual
 * history the band collapses onto the point forecast. Returns [] when the
 * history is empty — callers gate on coverage before ever getting here.
 */
export function forecastSeries(
  samples: DailySample[],
  anchorDate: string,
  horizonDays: number,
): ForecastPoint[] {
  if (samples.length === 0) {
    return [];
  }

  const ordered = [...samples].sort((a, b) => a.date.localeCompare(b.date));
  const residuals = oneStepResiduals(ordered, anchorDate).sort((a, b) => a - b);
  const offsets = {
    q10: quantile(residuals, 0.1),
    q50: quantile(residuals, 0.5),
    q90: quantile(residuals, 0.9),
  };
  const points: ForecastPoint[] = [];

  for (let step = 1; step <= horizonDays; step++) {
    const date = shiftIso(anchorDate, step);
    const base = pointForecast(ordered, date);

    if (base === null) {
      continue;
    }

    points.push({
      date,
      q10: base + offsets.q10,
      q50: base + offsets.q50,
      q90: base + offsets.q90,
    });
  }

  return points;
}
