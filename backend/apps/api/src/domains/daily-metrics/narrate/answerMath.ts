import type { DailyMetrics, MetricKey } from '../types';

import type { Aggregate, ValueFormat } from './questionCatalog';

export interface AggregateResult {
  value: number;
  daysWithData: number;
}

interface DaySample {
  date: string;
  value: number;
  coverage: number;
}

/** Days that actually have a value for this metric (null = dropped). */
function toSamples(rows: DailyMetrics[], metric: MetricKey): DaySample[] {
  const samples: DaySample[] = [];
  for (const row of rows) {
    const value = row.metrics[metric];
    if (value === null || value === undefined) {
      continue;
    }

    samples.push({ date: row.date, value, coverage: row.coverage?.[metric] ?? 0 });
  }

  return samples;
}

/**
 * Collapse a metric's daily series over a window. Null metric days are dropped,
 * so an empty series means "no data" and yields `null` — never a fake 0.
 *
 * `active_days` counts days whose value is non-null and > 0. `daysWithData`
 * is always the count of non-null days (including real zeros).
 */
export function aggregateMetric(
  rows: DailyMetrics[],
  metric: MetricKey,
  mode: Aggregate,
): AggregateResult | null {
  const samples = toSamples(rows, metric);
  if (samples.length === 0) {
    return null;
  }

  let value: number;
  switch (mode) {
    case 'latest': {
      const latest = samples.reduce((a, b) => (a.date >= b.date ? a : b));
      value = latest.value;
      break;
    }

    case 'sum':
      value = samples.reduce((acc, sample) => acc + sample.value, 0);
      break;
    case 'avg':
      value = samples.reduce((acc, sample) => acc + sample.value, 0) / samples.length;
      break;
    case 'max':
      value = samples.reduce((max, sample) => Math.max(max, sample.value), Number.NEGATIVE_INFINITY);
      break;
    case 'active_days':
      value = samples.filter((sample) => sample.value > 0).length;
      break;
  }

  return { value, daysWithData: samples.length };
}

/** Mean per-day coverage (0..1) of days that have a value for `metric`. */
export function meanCoverage(rows: DailyMetrics[], metric: MetricKey): number {
  const samples = toSamples(rows, metric);
  if (samples.length === 0) {
    return 0;
  }

  return samples.reduce((acc, sample) => acc + sample.coverage, 0) / samples.length;
}

/** Optional unit conversion applied before display formatting. */
export function applyScale(value: number, scale?: number): number {
  return scale === undefined ? value : value * scale;
}

/** Format a numeric value for narration according to a question's format. */
export function formatValue(value: number, format: ValueFormat): string {
  switch (format) {
    case 'int':
      return String(Math.round(value));
    case 'float1':
      return value.toFixed(1);
    case 'float2':
      return value.toFixed(2);
    case 'money':
      return value.toFixed(2);
    case 'signed2':
      return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
  }
}
