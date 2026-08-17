import { METRIC_KEYS, type DailyMetrics, type MetricCoverage, type MetricKey, type MetricValues } from '../types';

import { aggregateMetric, applyScale, formatValue, meanCoverage } from './answerMath';

function nullMetrics(): MetricValues {
  return Object.fromEntries(METRIC_KEYS.map((key) => [key, null])) as MetricValues;
}

function day(date: string, metric: MetricKey, value: number | null, coverage = 1): DailyMetrics {
  const metrics = nullMetrics();
  metrics[metric] = value;
  const cov = Object.fromEntries(METRIC_KEYS.map((key) => [key, 0])) as MetricCoverage;
  if (value !== null) {
    cov[metric] = coverage;
  }

  return { userId: 'u', date, timezone: 'UTC', metrics, coverage: cov, computedAt: new Date() };
}

describe('aggregateMetric', () => {
  const rows = [
    day('2026-07-05', 'n_messages', 2, 0.5),
    day('2026-07-07', 'n_messages', 5, 1),
    day('2026-07-06', 'n_messages', 3, 0.5),
  ];

  it('returns null for an empty window (no fabricated zero)', () => {
    expect(aggregateMetric([], 'n_messages', 'sum')).toBeNull();
    expect(aggregateMetric([day('2026-07-05', 'n_places', 1)], 'n_messages', 'sum')).toBeNull();
  });

  it('sums non-null values', () => {
    expect(aggregateMetric(rows, 'n_messages', 'sum')).toEqual({ value: 10, daysWithData: 3 });
  });

  it('averages non-null values', () => {
    const result = aggregateMetric(rows, 'n_messages', 'avg');

    expect(result?.daysWithData).toBe(3);
    expect(result?.value).toBeCloseTo(10 / 3, 5);
  });

  it('takes the max of non-null values', () => {
    expect(aggregateMetric(rows, 'n_messages', 'max')).toEqual({ value: 5, daysWithData: 3 });
  });

  it('picks the latest day by date', () => {
    expect(aggregateMetric(rows, 'n_messages', 'latest')).toEqual({ value: 5, daysWithData: 3 });
  });

  it('counts active days where the metric is non-null and > 0', () => {
    const withZero = [
      day('2026-07-05', 'km_traveled', 0),
      day('2026-07-06', 'km_traveled', 4),
      day('2026-07-07', 'km_traveled', 1),
      day('2026-07-08', 'km_traveled', null),
    ];

    expect(aggregateMetric(withZero, 'km_traveled', 'active_days')).toEqual({
      value: 2,
      daysWithData: 3,
    });
  });
});

describe('meanCoverage', () => {
  it('averages coverage over days that have a value', () => {
    const rows = [
      day('2026-07-05', 'n_messages', 2, 0.5),
      day('2026-07-07', 'n_messages', 5, 1),
      day('2026-07-06', 'n_messages', 3, 0.5),
    ];

    expect(meanCoverage(rows, 'n_messages')).toBeCloseTo((0.5 + 1 + 0.5) / 3, 5);
    expect(meanCoverage([], 'n_messages')).toBe(0);
  });
});

describe('applyScale', () => {
  it('is identity without a scale and multiplies with one', () => {
    expect(applyScale(50)).toBe(50);
    expect(applyScale(0.5, 100)).toBe(50);
    expect(applyScale(120, 1 / 60)).toBeCloseTo(2, 5);
  });
});

describe('formatValue', () => {
  it('formats each display format', () => {
    expect(formatValue(3.6, 'int')).toBe('4');
    expect(formatValue(1.25, 'float1')).toBe('1.3');
    expect(formatValue(1.5, 'float2')).toBe('1.50');
    expect(formatValue(9.9, 'money')).toBe('9.90');
    expect(formatValue(0.3, 'signed2')).toBe('+0.30');
    expect(formatValue(-0.3, 'signed2')).toBe('-0.30');
  });
});
