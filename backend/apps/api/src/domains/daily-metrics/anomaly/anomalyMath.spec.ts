import { shiftIso } from '../dateUtil';

import {
  cusumChangepoints,
  hbpeL0Divergence,
  mad,
  median,
  robustZAt,
  robustZSeries,
  type HbpeBucket,
  type SeriesPoint,
} from './anomalyMath';

const ANCHOR = '2026-07-06';

function series(count: number, valueAt: (index: number) => number, coverage = 1): SeriesPoint[] {
  return Array.from({ length: count }, (_, index) => ({
    date: shiftIso(ANCHOR, -(count - 1 - index)),
    value: valueAt(index),
    coverage,
  }));
}

describe('median / mad', () => {
  it('is the middle of a sorted odd sample', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(mad([1, 2, 3], 2)).toBe(1);
  });
});

describe('robustZAt', () => {
  it('flags a single +4σ outlier and not the quiet days around it', () => {
    // 40 days at 10, then a 40 on the last day. Prior MAD is 0 on a constant
    // series — no flag. Need jitter so MAD is real.
    const points = series(40, (index) => (index === 39 ? 40 : 10 + (index % 3) * 0.2));
    const last = points[points.length - 1].date;
    const finding = robustZAt(points, last);

    expect(finding).not.toBeNull();
    expect(finding!.detector).toBe('robust_z');
    expect(finding!.direction).toBe('high');
    expect(finding!.date).toBe(last);

    const quiet = robustZAt(points, points[20].date);
    expect(quiet).toBeNull();
  });

  it('never flags a coverage-0 day', () => {
    const points = series(30, (index) => (index === 29 ? 100 : 10));
    points[29].coverage = 0;

    expect(robustZAt(points, points[29].date)).toBeNull();
  });

  it('does not flag when MAD is 0 (constant prior)', () => {
    const points = series(20, () => 10);
    points.push({ date: shiftIso(ANCHOR, 1), value: 50, coverage: 1 });

    expect(robustZAt(points, shiftIso(ANCHOR, 1))).toBeNull();
  });
});

describe('cusumChangepoints', () => {
  it('detects a +4σ level shift once, not as a flag on every later day', () => {
    // 50 days N(10)-ish, then 40 days at 30.
    const points = series(90, (index) => (index < 50 ? 10 + (index % 5) * 0.3 : 30 + (index % 5) * 0.3));
    const findings = cusumChangepoints(points);

    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings.length).toBeLessThanOrEqual(3);
    expect(findings.every((finding) => finding.detector === 'cusum')).toBe(true);
    expect(findings.every((finding) => finding.direction === 'change')).toBe(true);
    // The first detection should land after the shift, not in the first 14 days.
    expect(findings[0].date >= points[50].date).toBe(true);
  });

  it('does not treat a single outlier as a changepoint', () => {
    const points = series(40, (index) => (index === 25 ? 40 : 10 + (index % 3) * 0.2));
    const cusum = cusumChangepoints(points);
    const z = robustZSeries(points);

    expect(z.some((finding) => finding.date === points[25].date)).toBe(true);
    expect(cusum.some((finding) => finding.date === points[25].date)).toBe(false);
  });
});

describe('hbpeL0Divergence', () => {
  function buckets(mismatched: number, total = 48): HbpeBucket[] {
    return Array.from({ length: total }, (_, index) => {
      const mismatch = index < mismatched;

      return {
        actualL0: mismatch ? 'TRANSIT' : 'WORK',
        l0Probs: mismatch ? { WORK: 0.8, TRANSIT: 0.1 } : { WORK: 0.8, TRANSIT: 0.1 },
      };
    });
  }

  it('emits one divergence when most buckets mismatch with high surprise', () => {
    const finding = hbpeL0Divergence('2026-07-06', buckets(30));
    expect(finding).not.toBeNull();
    expect(finding!.detector).toBe('hbpe_l0');
    expect(finding!.direction).toBe('divergence');
    expect(finding!.metadata.bucket_count).toBe(48);
  });

  it('stays quiet for two mismatched buckets', () => {
    expect(hbpeL0Divergence('2026-07-06', buckets(2))).toBeNull();
  });
});
