/**
 * Pure threshold logic for the calibration panel's plain-language one-liner.
 * All metrics measure forecast self-consistency against pipeline-derived
 * labels (see the resolver's `basis` field), not ground-truth accuracy — the
 * wording stays about "the model's read", never "the truth".
 */

export interface CalibrationSnapshot {
  brier: number | null;
  l0Top1Acc: number | null;
  ece: number | null;
  coverage: number | null;
  driftFlag: boolean;
  nBuckets: number;
}

/** Fewer scored buckets than this (half a day) → no judgement yet. */
export const MIN_SCORED_BUCKETS = 24;
/** Coverage below this → most forecasts have no backfilled actual yet. */
export const SPARSE_COVERAGE = 0.4;

export const ONE_LINERS = {
  noData: 'Not enough scored forecasts yet — check back after a few days of predictions.',
  drift: 'Your recent rhythm looks different from what the model learned — recalibrating.',
  sparse: 'Predictions are flowing, but few have been checked against your actual days yet.',
  strongCalibrated: 'Knows your daily rhythm well — confidence and reality are tracking closely.',
  strong: 'Strong read on your day-to-day — confidence estimates are still settling.',
  building: 'Getting a read on your routine — accuracy is still building.',
  learning: 'Still learning your patterns — expect rough predictions for now.',
} as const;

/** Plain-language summary of the latest calibration run, derived client-side. */
export function calibrationOneLiner(latest: CalibrationSnapshot | null): string {
  if (!latest || latest.nBuckets < MIN_SCORED_BUCKETS || latest.l0Top1Acc == null) {
    return ONE_LINERS.noData;
  }

  if (latest.driftFlag) {
    return ONE_LINERS.drift;
  }

  if (latest.coverage != null && latest.coverage < SPARSE_COVERAGE) {
    return ONE_LINERS.sparse;
  }

  if (latest.l0Top1Acc >= 0.75) {
    return latest.ece != null && latest.ece <= 0.08 ? ONE_LINERS.strongCalibrated : ONE_LINERS.strong;
  }

  if (latest.l0Top1Acc >= 0.55) {
    return ONE_LINERS.building;
  }

  return ONE_LINERS.learning;
}
