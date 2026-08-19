/**
 * Pure pairwise / lagged association math over daily_metrics series.
 * Database-free so FDR, coverage gating, and "hypothesis not cause" can be
 * unit-tested without Nest. See docs/architecture/correlation-anomaly-suggestions.md.
 */

import { shiftIso } from '../dateUtil';
import { METRIC_KEYS, type DailyMetrics, type MetricKey } from '../types';

export const MIN_PAIR_N = 14;
export const MIN_PAIR_COVERAGE = 0.5;
export const FDR_Q = 0.1;
export const LAGS = [0, 1, 2, 7] as const;
export const WINDOWS = [30, 90, 180] as const;
/** Switch the reported p-value to Spearman when |ρ| exceeds |r| by this much. */
export const SPEARMAN_SWITCH = 0.15;
export const NOVELTY_DEFAULT = 1;
export const NOVELTY_FLOOR = 0.1;
export const NOVELTY_DISMISS_DECAY = 0.5;

export type LagDays = (typeof LAGS)[number];
export type WindowDays = (typeof WINDOWS)[number];

export interface PairPoint {
  date: string;
  a: number;
  b: number;
  coverageA: number;
  coverageB: number;
}

export interface Association {
  n: number;
  pearson: number;
  spearman: number;
  mutualInfo: number | null;
  pValue: number;
  /** Signed Pearson r — the ranking effect size. */
  effect: number;
  coverageMean: number;
}

export interface PairTest {
  metricA: MetricKey;
  metricB: MetricKey;
  lagDays: number;
  windowDays: number;
  association: Association;
  qValue: number;
  survives: boolean;
}

/**
 * Days that contribute to a pair: both values present and both coverages clear
 * the floor. Missing data is dropped, never zero-filled.
 */
export function pairDays(
  rows: DailyMetrics[],
  metricA: MetricKey,
  metricB: MetricKey,
  lagDays: number,
): PairPoint[] {
  const byDate = new Map(rows.map((row) => [row.date, row]));
  const points: PairPoint[] = [];

  for (const row of rows) {
    const laggedDate = lagDays === 0 ? row.date : shiftIso(row.date, lagDays);
    const later = byDate.get(laggedDate);
    if (!later) {
      continue;
    }

    const a = row.metrics[metricA];
    const b = later.metrics[metricB];
    const coverageA = row.coverage[metricA] ?? 0;
    const coverageB = later.coverage[metricB] ?? 0;

    if (a === null || b === null) {
      continue;
    }

    if (coverageA < MIN_PAIR_COVERAGE || coverageB < MIN_PAIR_COVERAGE) {
      continue;
    }

    points.push({ date: row.date, a, b, coverageA, coverageB });
  }

  return points;
}

/** Pearson / Spearman / optional MI on an already coverage-gated sample. */
export function associate(points: PairPoint[]): Association | null {
  if (points.length < MIN_PAIR_N) {
    return null;
  }

  const xs = points.map((point) => point.a);
  const ys = points.map((point) => point.b);
  const pearson = pearsonR(xs, ys);
  const spearman = pearsonR(rank(xs), rank(ys));
  const useSpearman = Math.abs(spearman) - Math.abs(pearson) > SPEARMAN_SWITCH;
  const reported = useSpearman ? spearman : pearson;
  const pValue = pearsonPValue(reported, points.length);
  const coverageMean =
    points.reduce((sum, point) => sum + (point.coverageA + point.coverageB) / 2, 0) / points.length;

  return {
    n: points.length,
    pearson,
    spearman,
    mutualInfo: histogramMutualInfo(xs, ys),
    pValue,
    effect: pearson,
    coverageMean,
  };
}

/**
 * Benjamini–Hochberg q-values, same order as `pValues`.
 * q_i = min_{k≥i} (p_(k) * m / k), capped at 1.
 */
export function bhFdr(pValues: number[]): number[] {
  const m = pValues.length;
  if (m === 0) {
    return [];
  }

  const indexed = pValues.map((p, index) => ({ p, index }));
  indexed.sort((left, right) => left.p - right.p);

  const qSorted = Array.from({ length: m }, () => 0);
  let minFromRight = 1;
  for (let rank = m; rank >= 1; rank--) {
    const q = Math.min(1, (indexed[rank - 1].p * m) / rank);
    minFromRight = Math.min(minFromRight, q);
    qSorted[rank - 1] = minFromRight;
  }

  const out = Array.from({ length: m }, () => 0);
  for (let i = 0; i < m; i++) {
    out[indexed[i].index] = qSorted[i];
  }

  return out;
}

export function rankScore(effect: number, robust: boolean, novelty: number, coverageMean: number): number {
  return Math.abs(effect) * (robust ? 1 : 0.4) * novelty * coverageMean;
}

export function decayNovelty(current: number): number {
  return Math.max(NOVELTY_FLOOR, current * NOVELTY_DISMISS_DECAY);
}

/** Lag 0 stores lexicographic a < b so the same pair is not inserted twice. */
export function canonicalPair(
  metricA: MetricKey,
  metricB: MetricKey,
  lagDays: number,
): { metricA: MetricKey; metricB: MetricKey; lagDays: number } {
  if (lagDays === 0 && metricA > metricB) {
    return { metricA: metricB, metricB: metricA, lagDays: 0 };
  }

  return { metricA, metricB, lagDays };
}

/**
 * Every (metric_a, metric_b, lag) test for one window. Lag 0 is unordered
 * (lexicographic a < b). Lag > 0 tests both directions so "a today, b tomorrow"
 * and the reverse are distinct hypotheses.
 */
export function scanWindow(rows: DailyMetrics[], windowDays: number): PairTest[] {
  const tests: Array<Omit<PairTest, 'qValue' | 'survives'>> = [];

  for (let i = 0; i < METRIC_KEYS.length; i++) {
    for (let j = 0; j < METRIC_KEYS.length; j++) {
      if (i === j) {
        continue;
      }

      const metricA = METRIC_KEYS[i];
      const metricB = METRIC_KEYS[j];

      for (const lagDays of LAGS) {
        if (lagDays === 0 && metricA >= metricB) {
          continue;
        }

        const points = pairDays(rows, metricA, metricB, lagDays);
        const association = associate(points);
        if (!association) {
          continue;
        }

        tests.push({ metricA, metricB, lagDays, windowDays, association });
      }
    }
  }

  const qValues = bhFdr(tests.map((test) => test.association.pValue));

  return tests.map((test, index) => ({
    ...test,
    qValue: qValues[index],
    survives: qValues[index] <= FDR_Q,
  }));
}

export function pearsonR(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n === 0) {
    return 0;
  }

  const meanX = mean(xs);
  const meanY = mean(ys);
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }

  const den = Math.sqrt(denX * denY);
  if (den === 0) {
    return 0;
  }

  const r = num / den;

  return clamp(r, -1, 1);
}

/** Average ranks, 1-based, ties share the mid-rank. */
export function rank(values: number[]): number[] {
  const indexed = values.map((value, index) => ({ value, index }));
  indexed.sort((left, right) => left.value - right.value || left.index - right.index);

  const ranks = Array.from({ length: values.length }, () => 0);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1].value === indexed[i].value) {
      j++;
    }

    const mid = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) {
      ranks[indexed[k].index] = mid;
    }

    i = j + 1;
  }

  return ranks;
}

function pearsonPValue(r: number, n: number): number {
  if (n <= 2) {
    return 1;
  }

  const r2 = r * r;
  if (r2 >= 1 - 1e-15) {
    return 0;
  }

  const df = n - 2;
  const t = (Math.abs(r) * Math.sqrt(df)) / Math.sqrt(1 - r2);

  return studentTTwoSidedP(t, df);
}

/**
 * Two-sided Student-t p-value = I_{df/(df+t²)}(df/2, 1/2).
 * Large-df falls back to a normal erfc so we don't need a stats library.
 */
export function studentTTwoSidedP(t: number, df: number): number {
  if (!Number.isFinite(t) || df <= 0) {
    return 1;
  }

  if (df > 120) {
    return Math.min(1, Math.max(0, erfc(Math.abs(t) / Math.SQRT2)));
  }

  const x = df / (df + t * t);

  return clamp(regularizedIncompleteBeta(x, df / 2, 0.5), 0, 1);
}

/** 2-D histogram MI in nats. Returns null when a margin is degenerate. */
export function histogramMutualInfo(xs: number[], ys: number[], bins = 6): number | null {
  if (xs.length < MIN_PAIR_N) {
    return null;
  }

  const xEdges = histogramEdges(xs, bins);
  const yEdges = histogramEdges(ys, bins);
  if (!xEdges || !yEdges) {
    return null;
  }

  const joint = Array.from({ length: bins }, () => Array.from({ length: bins }, () => 0));
  for (let i = 0; i < xs.length; i++) {
    const xi = binIndex(xs[i], xEdges);
    const yi = binIndex(ys[i], yEdges);
    joint[xi][yi] += 1;
  }

  const n = xs.length;
  const px = Array.from({ length: bins }, () => 0);
  const py = Array.from({ length: bins }, () => 0);
  for (let i = 0; i < bins; i++) {
    for (let j = 0; j < bins; j++) {
      px[i] += joint[i][j];
      py[j] += joint[i][j];
    }
  }

  let mi = 0;
  for (let i = 0; i < bins; i++) {
    for (let j = 0; j < bins; j++) {
      const pxy = joint[i][j] / n;
      if (pxy === 0) {
        continue;
      }

      mi += pxy * Math.log(pxy / ((px[i] / n) * (py[j] / n)));
    }
  }

  return mi < 0 ? 0 : mi;
}

function histogramEdges(values: number[], bins: number): number[] | null {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    return null;
  }

  const width = (max - min) / bins;
  const edges = [min];
  for (let i = 1; i < bins; i++) {
    edges.push(min + i * width);
  }

  edges.push(max);

  return edges;
}

function binIndex(value: number, edges: number[]): number {
  const last = edges.length - 2;
  for (let i = 0; i < last; i++) {
    if (value < edges[i + 1]) {
      return i;
    }
  }

  return last;
}

function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) {
    return 0;
  }

  if (x >= 1) {
    return 1;
  }

  const lnBeta = logGamma(a) + logGamma(b) - logGamma(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lnBeta);

  if (x < (a + 1) / (a + b + 2)) {
    return (front * betaContinuedFraction(x, a, b)) / a;
  }

  return 1 - (front * betaContinuedFraction(1 - x, b, a)) / b;
}

function betaContinuedFraction(x: number, a: number, b: number): number {
  const maxIter = 200;
  const eps = 1e-12;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < 1e-30) {
    d = 1e-30;
  }

  d = 1 / d;
  let h = d;

  for (let m = 1; m <= maxIter; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < 1e-30) {
      d = 1e-30;
    }

    c = 1 + aa / c;
    if (Math.abs(c) < 1e-30) {
      c = 1e-30;
    }

    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < 1e-30) {
      d = 1e-30;
    }

    c = 1 + aa / c;
    if (Math.abs(c) < 1e-30) {
      c = 1e-30;
    }

    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < eps) {
      break;
    }
  }

  return h;
}

function logGamma(z: number): number {
  /* eslint-disable no-loss-of-precision -- Lanczos g=5 coefficients */
  const cof = [
    76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.001208650973866179,
    -0.000005395239384953,
  ];
  const x = z;
  let y = z;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (const coefficient of cof) {
    y += 1;
    ser += coefficient / y;
  }

  return -tmp + Math.log((2.5066282746310005 * ser) / x);
  /* eslint-enable no-loss-of-precision */
}

function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const ans =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t *
                      (-0.18628806 +
                        t *
                          (0.27886807 +
                            t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    );

  return x >= 0 ? ans : 2 - ans;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}
