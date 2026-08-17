import { shiftIso } from '../dateUtil';

import {
  dowOfIso,
  forecastSeries,
  oneStepResiduals,
  pointForecast,
  quantile,
  type DailySample,
} from './forecastMath';

/** `count` consecutive days ENDING at `anchor`, values supplied per index. */
function series(anchor: string, count: number, valueAt: (index: number) => number): DailySample[] {
  return Array.from({ length: count }, (_, index) => ({
    date: shiftIso(anchor, -(count - 1 - index)),
    value: valueAt(index),
  }));
}

const ANCHOR = '2026-07-06';

describe('quantile', () => {
  it('interpolates linearly between order statistics', () => {
    const sorted = [1, 2, 3, 4, 5];

    expect(quantile(sorted, 0.1)).toBeCloseTo(1.4, 10);
    expect(quantile(sorted, 0.5)).toBe(3);
    expect(quantile(sorted, 0.9)).toBeCloseTo(4.6, 10);
    expect(quantile(sorted, 0)).toBe(1);
    expect(quantile(sorted, 1)).toBe(5);
  });

  it('returns 0 for an empty array (no band)', () => {
    expect(quantile([], 0.5)).toBe(0);
  });
});

describe('pointForecast', () => {
  it('returns null with no history', () => {
    expect(pointForecast([], ANCHOR)).toBeNull();
  });

  it('forecasts a constant series as the constant', () => {
    const samples = series(ANCHOR, 30, () => 10);

    expect(pointForecast(samples, shiftIso(ANCHOR, 1))).toBeCloseTo(10, 10);
  });

  it('picks up day-of-week seasonality through the dow baseline', () => {
    // 28 days where the target weekday is 100 and every other day is 10.
    const targetDow = dowOfIso(shiftIso(ANCHOR, 7));
    const samples = series(ANCHOR, 28, () => 10).map((sample) =>
      dowOfIso(sample.date) === targetDow ? { ...sample, value: 100 } : sample,
    );

    const seasonalDay = pointForecast(samples, shiftIso(ANCHOR, 7))!;
    const ordinaryDay = pointForecast(samples, shiftIso(ANCHOR, 6))!;

    expect(seasonalDay).toBeGreaterThan(ordinaryDay + 30);
  });
});

describe('oneStepResiduals', () => {
  it('is honest: each residual only uses samples strictly before its day', () => {
    // Constant 10 except one 20 on the last day: only that day has a non-zero
    // residual, and it is exactly 20 - 10 because everything before it was 10.
    const samples = series(ANCHOR, 10, (index) => (index === 9 ? 20 : 10));

    const residuals = oneStepResiduals(samples, ANCHOR);

    expect(residuals).toHaveLength(7); // first MIN_RESIDUAL_PRIOR_SAMPLES days skipped
    expect(residuals.slice(0, 6)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(residuals[6]).toBeCloseTo(10, 10);
  });
});

describe('forecastSeries', () => {
  it('collapses the band onto the point forecast for a constant series', () => {
    const samples = series(ANCHOR, 30, () => 10);

    const points = forecastSeries(samples, ANCHOR, 3);

    expect(points).toHaveLength(3);
    expect(points.map((point) => point.date)).toEqual([
      shiftIso(ANCHOR, 1),
      shiftIso(ANCHOR, 2),
      shiftIso(ANCHOR, 3),
    ]);

    for (const point of points) {
      expect(point.q10).toBeCloseTo(10, 10);
      expect(point.q50).toBeCloseTo(10, 10);
      expect(point.q90).toBeCloseTo(10, 10);
    }
  });

  it('derives the band from known one-step residuals', () => {
    // Residuals are [0 x6, 10] (see the oneStepResiduals spec): q10 = 0,
    // q50 = 0, q90 = 4 (position 5.4 between the last 0 and the 10). The
    // next-day base is the pure EWMA — the target dow has < 2 observations
    // in 10 days — which after nine 10s and one 20 is 0.3*20 + 0.7*10 = 13.
    const samples = series(ANCHOR, 10, (index) => (index === 9 ? 20 : 10));

    const [point] = forecastSeries(samples, ANCHOR, 1);

    expect(point.q50).toBeCloseTo(13, 10);
    expect(point.q10).toBeCloseTo(13, 10);
    expect(point.q90).toBeCloseTo(17, 10);
  });

  it('always orders q10 <= q50 <= q90', () => {
    const samples = series(ANCHOR, 45, (index) => 10 + ((index * 7) % 13) - 6);

    for (const point of forecastSeries(samples, ANCHOR, 7)) {
      expect(point.q10).toBeLessThanOrEqual(point.q50);
      expect(point.q50).toBeLessThanOrEqual(point.q90);
    }
  });

  it('returns [] for an empty history', () => {
    expect(forecastSeries([], ANCHOR, 3)).toEqual([]);
  });
});
