import type { UserServiceContext } from '@ci/common/context';

import { shiftIso } from '../dateUtil';
import type { DailyMetricsService } from '../services/DailyMetricsService';
import { METRIC_KEYS, type DailyMetrics, type MetricCoverage, type MetricValues } from '../types';

import { MetricForecastService } from './MetricForecastService';

const USER = '00000000-0000-0000-0000-0000000000aa';
const CONTEXT: UserServiceContext = { userId: USER };
const ANCHOR = '2026-07-06';

const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() };

function makeMetrics() {
  return { getRange: jest.fn<Promise<DailyMetrics[]>, [UserServiceContext, string, string]>(async () => []) };
}

function makeService(metrics: ReturnType<typeof makeMetrics>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new MetricForecastService(metrics as unknown as DailyMetricsService, logger as any);
}

/** A stored day where only n_messages has a value. */
function dayWith(date: string, nMessages: number | null): DailyMetrics {
  const metrics = Object.fromEntries(METRIC_KEYS.map((key) => [key, null])) as MetricValues;
  const coverage = Object.fromEntries(METRIC_KEYS.map((key) => [key, 0])) as MetricCoverage;
  metrics.n_messages = nMessages;
  coverage.n_messages = nMessages === null ? 0 : 1;

  return {
    userId: USER,
    date,
    timezone: 'UTC',
    metrics,
    coverage,
    computedAt: new Date('2026-07-07T00:00:00Z'),
  };
}

/** The most recent `daysWithData` days (ending at ANCHOR) carry a value. */
function history(daysWithData: number, value = 10): DailyMetrics[] {
  return Array.from({ length: daysWithData }, (_, index) =>
    dayWith(shiftIso(ANCHOR, -(daysWithData - 1 - index)), value),
  );
}

describe('MetricForecastService coverage gate', () => {
  it('returns NOT_ENOUGH_SIGNAL (never fake zeros) below 30% coverage', async () => {
    const metrics = makeMetrics();
    metrics.getRange.mockResolvedValueOnce(history(20)); // 20 / 90 ≈ 0.22

    const forecast = await makeService(metrics).forecast(CONTEXT, 'n_messages', 3, { date: ANCHOR });

    expect(forecast.status).toBe('NOT_ENOUGH_SIGNAL');
    expect(forecast.coverage).toBeCloseTo(20 / 90, 4);
    expect(forecast.points).toEqual([]);
  });

  it('forecasts once coverage clears the gate', async () => {
    const metrics = makeMetrics();
    metrics.getRange.mockResolvedValueOnce(history(40)); // 40 / 90 ≈ 0.44

    const forecast = await makeService(metrics).forecast(CONTEXT, 'n_messages', 3, { date: ANCHOR });

    expect(forecast.status).toBe('OK');
    expect(forecast.coverage).toBeCloseTo(40 / 90, 4);
    expect(forecast.points).toHaveLength(3);
    expect(forecast.points[0].date).toBe(shiftIso(ANCHOR, 1));
    expect(forecast.points[0].q50).toBeCloseTo(10, 6);
  });

  it('queries a 90-day history window ending at the anchor', async () => {
    const metrics = makeMetrics();
    metrics.getRange.mockResolvedValueOnce([]);

    await makeService(metrics).forecast(CONTEXT, 'n_messages', 3, { date: ANCHOR });

    expect(metrics.getRange).toHaveBeenCalledWith(CONTEXT, shiftIso(ANCHOR, -89), ANCHOR);
  });

  it('days with a null value do not count toward coverage', async () => {
    const metrics = makeMetrics();
    const rows = [
      ...history(20),
      ...Array.from({ length: 40 }, (_, i) => dayWith(shiftIso(ANCHOR, -(30 + i)), null)),
    ];
    metrics.getRange.mockResolvedValueOnce(rows);

    const forecast = await makeService(metrics).forecast(CONTEXT, 'n_messages', 3, { date: ANCHOR });

    expect(forecast.status).toBe('NOT_ENOUGH_SIGNAL');
    expect(forecast.coverage).toBeCloseTo(20 / 90, 4);
  });

  it('rejects unknown metric keys without touching the store', async () => {
    const metrics = makeMetrics();

    const forecast = await makeService(metrics).forecast(CONTEXT, 'not_a_metric', 3);

    expect(forecast.status).toBe('UNKNOWN_METRIC');
    expect(forecast.points).toEqual([]);
    expect(metrics.getRange).not.toHaveBeenCalled();
  });

  it('clamps the horizon to 1..7 days and floors count-like bands at zero', async () => {
    const metrics = makeMetrics();
    metrics.getRange.mockResolvedValue(history(60, 0.5));

    const long = await makeService(metrics).forecast(CONTEXT, 'n_messages', 99, { date: ANCHOR });
    const short = await makeService(metrics).forecast(CONTEXT, 'n_messages', 0, { date: ANCHOR });

    expect(long.horizonDays).toBe(7);
    expect(long.points).toHaveLength(7);
    expect(short.horizonDays).toBe(1);

    for (const point of long.points) {
      expect(point.q10).toBeGreaterThanOrEqual(0);
    }
  });
});
