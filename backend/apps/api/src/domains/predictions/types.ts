export interface ForecastBucket {
  bucket_index: number;
  start_time: string;
  l0_probs: Record<string, number>;
  l1_probs: Record<string, number>;
  l2_probs: Record<string, number> | null;
  q10: number;
  q50: number;
  q90: number;
}

export interface ForecastResponse {
  horizon: string;
  generated_at: string;
  system_status: string;
  buckets: ForecastBucket[];
}

/** One reliability-diagram bin as persisted in hbpe.prediction_score.reliability_json. */
export interface ReliabilityBinRow {
  bin: number;
  lower: number;
  upper: number;
  count: number;
  avg_confidence: number | null;
  accuracy: number | null;
}

/**
 * Raw row from hbpe.prediction_score (canonical DDL: dbmate migration
 * 20260707054821_hbpe_prediction_score.sql; written by the HBPE sidecar's
 * nightly scoring step — backend/apps/hbpe/src/ci/pipeline/scoring.py).
 */
export interface PredictionScoreRow {
  scored_at: Date | string;
  window_start: Date | string;
  window_end: Date | string;
  brier: number | null;
  l0_top1_acc: number | null;
  l1_top3_acc: number | null;
  ece: number | null;
  coverage: number | null;
  reliability_json: ReliabilityBinRow[] | string | null;
  drift_flag: boolean;
  n_buckets: number;
}
