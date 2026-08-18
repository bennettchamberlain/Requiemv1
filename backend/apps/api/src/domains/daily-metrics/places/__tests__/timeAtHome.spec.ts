import { DEFAULT_STAY_RADIUS_M } from '../stayPoints';
import { timeAtHomeFromFixes } from '../timeAtHome';

describe('timeAtHomeFromFixes', () => {
  const home = { lat: 37.5, lng: -122.3, radiusM: DEFAULT_STAY_RADIUS_M };
  const t0 = new Date('2026-07-06T08:00:00Z');

  function stayFixes(
    lat: number,
    lng: number,
    minutes: number,
  ): Array<{ time: Date; lat: number; lng: number }> {
    return [
      { time: t0, lat, lng },
      { time: new Date(t0.getTime() + minutes * 60_000), lat, lng },
    ];
  }

  it('is NULL with coverage 0 when home is unlabeled', () => {
    expect(timeAtHomeFromFixes(stayFixes(37.5, -122.3, 40), null)).toEqual({ minutes: null, coverage: 0 });
  });

  it('is NULL with coverage 0 when there are no stays', () => {
    expect(timeAtHomeFromFixes([], home)).toEqual({ minutes: null, coverage: 0 });
  });

  it('sums minutes of stays whose centroid is within the home radius', () => {
    const atHome = stayFixes(37.5, -122.3, 40);
    const elsewhere = stayFixes(37.6, -122.2, 20).map((fix) => ({
      ...fix,
      time: new Date(fix.time.getTime() + 2 * 60 * 60_000),
    }));

    const result = timeAtHomeFromFixes([...atHome, ...elsewhere], home);

    expect(result.minutes).toBeCloseTo(40, 5);
    expect(result.coverage).toBeCloseTo(40 / 60, 5);
  });

  it('uses the home cluster radius when it is larger than the stay default', () => {
    // ~200 m north of home: outside 150 m, inside a 400 m cluster.
    const nearby = stayFixes(37.5018, -122.3, 30);
    const defaultRadius = timeAtHomeFromFixes(nearby, home);
    const clusterRadius = timeAtHomeFromFixes(nearby, { ...home, radiusM: 400 });

    expect(defaultRadius.minutes).toBe(0);
    expect(clusterRadius.minutes).toBeCloseTo(30, 5);
  });
});
