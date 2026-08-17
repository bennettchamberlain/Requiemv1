import {
  METRIC_KEYS,
  type DailyMetrics,
  type MetricCoverage,
  type MetricKey,
  type MetricValues,
} from '../types';

import { pickMetricSurprise } from './metricSurprises';

const USER = '00000000-0000-0000-0000-0000000000aa';

function nullMetrics(): MetricValues {
  return Object.fromEntries(METRIC_KEYS.map((key) => [key, null])) as MetricValues;
}

function day(date: string, values: Partial<Record<MetricKey, number>>, coverage = 1): DailyMetrics {
  const metrics = nullMetrics();
  const cov = Object.fromEntries(METRIC_KEYS.map((key) => [key, 0])) as MetricCoverage;
  for (const [key, value] of Object.entries(values) as Array<[MetricKey, number]>) {
    metrics[key] = value;
    cov[key] = coverage;
  }

  return { userId: USER, date, timezone: 'UTC', metrics, coverage: cov, computedAt: new Date() };
}

function weekOf(metric: MetricKey, value: number): DailyMetrics[] {
  return ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14'].map((date) =>
    day(date, { [metric]: value }),
  );
}

describe('pickMetricSurprise', () => {
  it('flags conversations well below the week average and injects both numbers', () => {
    const surprise = pickMetricSurprise(
      day('2026-08-16', { n_conversations: 2 }),
      weekOf('n_conversations', 11),
    );

    expect(surprise?.id).toBe('conversations_low');
    expect(surprise?.label).toContain('2 conversations');
    expect(surprise?.label).toContain('11 most days');
  });

  it('flags a single-place day', () => {
    const surprise = pickMetricSurprise(day('2026-08-16', { n_places: 1 }), weekOf('n_places', 4));

    expect(surprise?.id).toBe('one_place');
    expect(surprise?.label).toContain('one place');
  });

  it('flags a sentiment dip', () => {
    const surprise = pickMetricSurprise(
      day('2026-08-16', { avg_sentiment: -0.4 }),
      weekOf('avg_sentiment', 0.2),
    );

    expect(surprise?.id).toBe('sentiment_dip');
    expect(surprise?.label).toContain('-0.4');
    expect(surprise?.label).toContain('0.2');
  });

  it('flags a screen-time spike', () => {
    const surprise = pickMetricSurprise(
      day('2026-08-16', { screen_minutes: 240 }),
      weekOf('screen_minutes', 80),
    );

    expect(surprise?.id).toBe('screen_spike');
    expect(surprise?.label).toContain('240 minutes');
    expect(surprise?.label).toContain('80 most days');
  });

  it('skips low-coverage yesterday even when the number looks surprising', () => {
    expect(
      pickMetricSurprise(day('2026-08-16', { n_conversations: 1 }, 0.2), weekOf('n_conversations', 11)),
    ).toBeNull();
  });

  it('skips when the week does not have enough covered days', () => {
    expect(
      pickMetricSurprise(day('2026-08-16', { n_conversations: 1 }), [
        day('2026-08-14', { n_conversations: 10 }),
        day('2026-08-15', { n_conversations: 12 }),
      ]),
    ).toBeNull();
  });

  it('returns at most one surprise, preferring conversations', () => {
    const yesterday = day('2026-08-16', { n_conversations: 2, n_places: 1, screen_minutes: 240 });
    const week = [
      ...weekOf('n_conversations', 11),
      ...weekOf('n_places', 4),
      ...weekOf('screen_minutes', 80),
    ];

    expect(pickMetricSurprise(yesterday, week)?.id).toBe('conversations_low');
  });
});
