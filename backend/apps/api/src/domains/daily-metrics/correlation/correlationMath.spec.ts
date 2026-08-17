import { shiftIso } from '../dateUtil';
import {
  METRIC_KEYS,
  type DailyMetrics,
  type MetricCoverage,
  type MetricKey,
  type MetricValues,
} from '../types';

import {
  associate,
  bhFdr,
  decayNovelty,
  histogramMutualInfo,
  MIN_PAIR_N,
  pairDays,
  pearsonR,
  rank,
  rankScore,
  scanWindow,
  studentTTwoSidedP,
} from './correlationMath';

const USER = '00000000-0000-0000-0000-0000000000aa';
const ANCHOR = '2026-07-06';

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

function series(
  count: number,
  valueAt: (index: number) => Partial<Record<MetricKey, number>>,
  coverage = 1,
): DailyMetrics[] {
  return Array.from({ length: count }, (_, index) =>
    day(shiftIso(ANCHOR, -(count - 1 - index)), valueAt(index), coverage),
  );
}

/** Deterministic Gaussian via Box-Muller, seeded LCG. */
function rng(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    const u1 = (state + 1) / 4294967297;
    state = (1664525 * state + 1013904223) >>> 0;
    const u2 = (state + 1) / 4294967297;

    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };
}

describe('pearsonR / rank', () => {
  it('is 1 on a perfect line', () => {
    expect(pearsonR([1, 2, 3, 4, 5], [2, 4, 6, 8, 10])).toBeCloseTo(1, 10);
  });

  it('is -1 on a perfect inverse', () => {
    expect(pearsonR([1, 2, 3, 4, 5], [10, 8, 6, 4, 2])).toBeCloseTo(-1, 10);
  });

  it('ranks ties at the mid-rank', () => {
    expect(rank([10, 20, 20, 40])).toEqual([1, 2.5, 2.5, 4]);
  });
});

describe('studentTTwoSidedP', () => {
  it('is ~1 for t=0', () => {
    expect(studentTTwoSidedP(0, 20)).toBeCloseTo(1, 5);
  });

  it('is tiny for a large t', () => {
    expect(studentTTwoSidedP(8, 88)).toBeLessThan(1e-10);
  });
});

describe('associate', () => {
  it('recovers a planted r≈0.8 on n=90 and the p-value survives a large FDR family', () => {
    const gauss = rng(7);
    const points = Array.from({ length: 90 }, (_, index) => {
      const a = gauss();
      const b = 0.8 * a + Math.sqrt(1 - 0.64) * gauss();

      return { date: shiftIso(ANCHOR, -89 + index), a, b, coverageA: 1, coverageB: 1 };
    });

    const result = associate(points);
    expect(result).not.toBeNull();
    expect(result!.n).toBe(90);
    expect(result!.pearson).toBeGreaterThan(0.65);
    expect(result!.pearson).toBeLessThan(0.95);
    expect(result!.pValue).toBeLessThan(1e-8);

    const family = [result!.pValue, ...Array.from({ length: 500 }, () => 0.4)];
    const q = bhFdr(family);
    expect(q[0]).toBeLessThanOrEqual(0.1);
    expect(q[0]).toBeLessThan(q[1]);
  });

  it('returns null below MIN_PAIR_N', () => {
    const points = Array.from({ length: MIN_PAIR_N - 1 }, (_, index) => ({
      date: shiftIso(ANCHOR, -index),
      a: index,
      b: index,
      coverageA: 1,
      coverageB: 1,
    }));

    expect(associate(points)).toBeNull();
  });

  it('never puts "cause" in ranking — effect is signed r', () => {
    const points = Array.from({ length: 20 }, (_, index) => ({
      date: shiftIso(ANCHOR, -index),
      a: index,
      b: index,
      coverageA: 1,
      coverageB: 1,
    }));

    expect(associate(points)!.effect).toBeCloseTo(1, 8);
    expect(rankScore(0.8, true, 1, 1)).toBeCloseTo(0.8, 10);
    expect(rankScore(0.8, false, 1, 1)).toBeCloseTo(0.32, 10);
  });
});

describe('pairDays coverage gating', () => {
  it('drops nulls and matches a complete-case oracle', () => {
    const rows: DailyMetrics[] = [];
    for (let i = 0; i < 20; i++) {
      const date = shiftIso(ANCHOR, -19 + i);
      const a = i;
      const b = i * 2;
      // 40% of km_traveled missing
      rows.push(
        day(date, i % 5 === 0 ? { n_conversations: a } : { n_conversations: a, km_traveled: b }),
      );
    }

    const points = pairDays(rows, 'n_conversations', 'km_traveled', 0);
    expect(points).toHaveLength(16);

    const oracleA = points.map((point) => point.a);
    const oracleB = points.map((point) => point.b);
    expect(associate(points)!.pearson).toBeCloseTo(pearsonR(oracleA, oracleB), 10);
  });

  it('does not treat a week of null km_traveled as zeros correlated with sentiment', () => {
    const rows = series(21, (index) => {
      const sentiment = index < 14 ? 0.4 : -0.4;
      if (index >= 14) {
        return { avg_sentiment: sentiment };
      }

      return { avg_sentiment: sentiment, km_traveled: 5 };
    });

    const points = pairDays(rows, 'km_traveled', 'avg_sentiment', 0);
    // The last 7 days have no km — they must not appear as (0, -0.4) pairs.
    expect(points.every((point) => point.a !== 0 || point.b !== -0.4)).toBe(true);
    expect(points).toHaveLength(14);
  });

  it('drops days below the coverage floor', () => {
    const rows = series(20, (index) => ({ n_conversations: index, avg_sentiment: index }), 0.2);
    expect(pairDays(rows, 'n_conversations', 'avg_sentiment', 0)).toHaveLength(0);
  });

  it('aligns lag 1 as b[t+1] against a[t]', () => {
    const rows = series(16, (index) => ({ n_conversations: index, avg_sentiment: index + 1 }));
    const points = pairDays(rows, 'n_conversations', 'avg_sentiment', 1);

    expect(points).toHaveLength(15);
    expect(points[0].a).toBe(0);
    expect(points[0].b).toBe(2); // sentiment on the next day is index+1 = 1+1
  });
});

describe('bhFdr', () => {
  it('is monotone from the right and caps at 1', () => {
    const q = bhFdr([0.001, 0.2, 0.9, 0.04]);
    expect(q[0]).toBeLessThanOrEqual(q[3]);
    expect(Math.max(...q)).toBeLessThanOrEqual(1);
  });

  it('lets one tiny p-value survive a family of noise', () => {
    const p = [1e-10, ...Array.from({ length: 40 }, () => 0.5)];
    const q = bhFdr(p);
    expect(q[0]).toBeLessThanOrEqual(0.1);
    expect(q.slice(1).every((value) => value > 0.1)).toBe(true);
  });
});

describe('scanWindow', () => {
  it('does not invent survivors from independent noise (one seeded run)', () => {
    const gauss = rng(11);
    const rows = series(90, () => {
      const values: Partial<Record<MetricKey, number>> = {};
      for (const key of METRIC_KEYS) {
        values[key] = gauss();
      }

      return values;
    });

    const survivors = scanWindow(rows, 90).filter((test) => test.survives);
    expect(survivors.length).toBeLessThanOrEqual(5);
  });

  it('surfaces a planted contemporaneous association', () => {
    const gauss = rng(3);
    const rows = series(90, () => {
      const conversations = Math.abs(gauss()) * 4 + 4;
      const sentiment = 0.15 * conversations + gauss() * 0.05;

      return { n_conversations: conversations, avg_sentiment: sentiment };
    });

    const hits = scanWindow(rows, 90).filter(
      (test) =>
        test.survives &&
        test.lagDays === 0 &&
        ((test.metricA === 'n_conversations' && test.metricB === 'avg_sentiment') ||
          (test.metricA === 'avg_sentiment' && test.metricB === 'n_conversations')),
    );

    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].association.pearson).toBeGreaterThan(0.5);
  });
});

describe('histogramMutualInfo', () => {
  it('is higher for a dependent pair than an independent one', () => {
    const gauss = rng(5);
    const xs = Array.from({ length: 80 }, () => gauss());
    const dependent = xs.map((x) => x * 2);
    const independent = Array.from({ length: 80 }, () => gauss());

    expect(histogramMutualInfo(xs, dependent)!).toBeGreaterThan(histogramMutualInfo(xs, independent)!);
  });
});

describe('decayNovelty', () => {
  it('halves and floors at 0.1', () => {
    expect(decayNovelty(1)).toBeCloseTo(0.5);
    expect(decayNovelty(0.11)).toBeCloseTo(0.1);
  });
});
