import { shiftIso } from '../dateUtil';
import { METRIC_KEYS, type DailyMetrics, type MetricCoverage, type MetricKey, type MetricValues } from '../types';

import { baselineMean, detectArmTriggers, updateArm } from './suggestionMath';

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

function windowOf(metric: MetricKey, value: number, days = 14): DailyMetrics[] {
  return Array.from({ length: days }, (_, index) => day(shiftIso('2026-08-15', -days + index), { [metric]: value }));
}

describe('detectArmTriggers', () => {
  it('fires conversations_low against a 14-day baseline', () => {
    const triggers = detectArmTriggers(day('2026-08-16', { n_conversations: 2 }), windowOf('n_conversations', 11));

    expect(triggers.map((trigger) => trigger.key)).toContain('rel.conversations_low');
    expect(triggers[0].text).toContain('2 conversations');
    expect(triggers[0].text.toLowerCase()).not.toContain('cause');
  });

  it('does not emit Body/Mind health arms', () => {
    const triggers = detectArmTriggers(
      day('2026-08-16', { avg_sentiment: -0.8, km_traveled: 0.2 }),
      [...windowOf('avg_sentiment', 0.4), ...windowOf('km_traveled', 8)],
    );

    expect(triggers.every((trigger) => trigger.metric !== 'avg_sentiment')).toBe(true);
    expect(triggers.every((trigger) => trigger.metric !== 'km_traveled')).toBe(true);
  });

  it('refuses to fire with a thin baseline', () => {
    expect(
      detectArmTriggers(day('2026-08-16', { n_conversations: 1 }), windowOf('n_conversations', 11, 5)),
    ).toEqual([]);
  });
});

describe('updateArm', () => {
  it('increments alpha on accept and beta on dismiss', () => {
    expect(updateArm(1, 1, true)).toEqual({ alpha: 2, beta: 1 });
    expect(updateArm(1, 1, false)).toEqual({ alpha: 1, beta: 2 });
  });
});

describe('baselineMean', () => {
  it('returns null below the min n', () => {
    expect(baselineMean(windowOf('n_conversations', 5, 3), 'n_conversations', 14)).toBeNull();
  });
});
